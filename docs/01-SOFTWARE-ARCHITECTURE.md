# MAGIC — Software Architecture

**Version 1.0 · 2026-08-29**

---

## 1. Architectural Position

MAGIC is a **modular monolith with a separate worker fleet**, backed by PostgreSQL and Redis, fronted by a Next.js BFF.

It is not microservices. At T2 volume a single well-partitioned Postgres and a horizontally scaled worker pool handle the load with a fraction of the operational surface. The module boundaries below are drawn strictly enough that extraction to services is a mechanical exercise later — but paying distributed-systems cost now would buy nothing except latency and debugging difficulty in a system whose core property is *provable consistency*.

**Decision: modular monolith + worker fleet.** Revisit only when a single module's scaling profile diverges by more than 10× from the rest (realistically: ingestion, at T3+).

---

## 2. System Context

```
                         ┌──────────────────────┐
                         │   Stripe (Connect)   │
                         │  platform + N acct   │
                         └───┬──────────────┬───┘
                  webhooks   │              │  REST (canonical re-fetch,
                  (per-tenant│              │       sweeper, backfill)
                   opaque URL│              │
                             ▼              ▲
┌─────────┐   HTTPS   ┌──────────────────────────────┐
│ Browser │◄─────────►│      MAGIC Platform          │
│ (ops)   │           │                              │
└─────────┘           │  Next.js BFF  ──►  NestJS    │
                      │                    API       │
                      │        ┌───────────┴──────┐  │
                      │        │  Worker Fleet    │  │
                      │        └───────┬──────────┘  │
                      │   PostgreSQL 17│  Redis 7     │
                      └────────────────┼──────────────┘
                                       │
                              ┌────────▼─────────┐
                              │  Order Source    │
                              │  (Mock adapter   │
                              │   in v1)         │
                              └──────────────────┘
```

Trust boundaries:

- **Browser ↔ BFF** — session cookie, HttpOnly, SameSite=Lax, CSRF token on mutations.
- **BFF ↔ API** — service token, internal network only. The API is never exposed publicly.
- **Stripe → Ingest** — the only public unauthenticated surface. Signature-verified, tenant-scoped, rate-limited.
- **API/Workers ↔ Postgres** — non-owner role with `FORCE ROW LEVEL SECURITY`. No connection can bypass tenancy.

---

## 3. Container View

| Container | Runtime | Responsibility | Scaling |
|---|---|---|---|
| `web` | Next.js 16, Node 22 | SSR shell, session, BFF route handlers, CSRF | Horizontal, stateless |
| `api` | NestJS 11, Node 22 | REST v1, authz, query composition, command handling | Horizontal, stateless |
| `ingest` | NestJS (Fastify adapter) | Webhook endpoint only — verify, persist, enqueue | Horizontal, isolated from `api` |
| `worker-ingest` | BullMQ | Canonical re-fetch, projection upsert | Horizontal, high concurrency |
| `worker-recon` | BullMQ | Reconciliation runs, matching | Horizontal, low concurrency, CPU-bound |
| `worker-ops` | BullMQ | Sweeper, completeness checks, exports, notifications | Small fixed pool |
| `postgres` | PostgreSQL 17 | System of record | Vertical + read replica |
| `redis` | Redis 7 | Queues, rate-limit tokens, session store, short-TTL cache | Managed, single primary + replica |
| `object-store` | S3-compatible | Export artefacts, cold event archive | Managed |

**`ingest` is a separate deployable from `api` on purpose.** A traffic spike on the dashboard must never delay a webhook ack, and a webhook flood must never take down the UI. This is the single most valuable bulkhead in the system.

---

## 4. Module Boundaries

Dependencies flow strictly downward. A module never imports from a module above it.

```
┌───────────────────────────────────────────────────────────┐
│  interface        http/ · queue-consumers · schedulers     │
├───────────────────────────────────────────────────────────┤
│  application      exceptions · reconciliation · exports    │
│                   matching · reporting                     │
├───────────────────────────────────────────────────────────┤
│  domain           ledger (postings) · rules · settlement   │
│                   classification · money                   │
├───────────────────────────────────────────────────────────┤
│  integration      stripe-client · order-source adapters    │
├───────────────────────────────────────────────────────────┤
│  platform         tenancy · iam · audit · persistence ·    │
│                   queue · observability · config           │
└───────────────────────────────────────────────────────────┘
```

| Module | Owns | Must not |
|---|---|---|
| `platform/tenancy` | Tenant context resolution, RLS session binding | Know about payments |
| `platform/iam` | Users, memberships, role + account scope, permission checks | Contain business rules |
| `platform/audit` | Append-only action log | Be writable by application code directly (goes through an interceptor) |
| `integration/stripe` | Typed Stripe client, per-account rate limiting, retry/backoff | Write to the database |
| `domain/money` | `Money` value object (minor units + currency), arithmetic, rounding | Do I/O |
| `domain/ledger` | Posting graph, expected-posting derivation | Know about HTTP or queues |
| `domain/classification` | Charge-type inference from Stripe object shape | Persist |
| `domain/settlement` | `settlements` normalisation from charge + balance transactions | Branch on tenant |
| `domain/rules` | Rule registry, versioning, maturity windows, evaluation | Perform I/O — rules receive a snapshot |
| `application/reconciliation` | Run orchestration, snapshot assembly, exception emission | Contain rule logic |
| `application/matching` | Tiered payment↔order matching | Know charge types (reads `settlements`) |
| `application/exceptions` | Workflow state machine, assignment, notes | Re-evaluate rules |

**The critical invariant:** `domain/rules` is pure. It takes a snapshot struct and returns `(matches, exceptions)`. It cannot query, cannot enqueue, cannot log to an external sink. That purity is what makes determinism testable in CI rather than aspirational.

---

## 5. Ingestion Pipeline

```
Stripe ──POST /wh/stripe/{opaqueTenantKey}
             │
             ▼
   ┌──────────────────────────────────┐
   │ 1. Resolve tenant from path      │  ← never from body
   │ 2. Load signing secret (cached)  │
   │ 3. Verify signature (RAW body)   │  ← before any JSON parse
   │ 4. BEGIN                         │
   │    INSERT stripe_events          │  ← ON CONFLICT DO NOTHING
   │    INSERT outbox_jobs            │  ← same transaction
   │    COMMIT                        │
   │ 5. 200 OK                        │  target p99 ≤ 150 ms
   └──────────────┬───────────────────┘
                  │
      outbox relay (poll, 200 ms)
                  │
                  ▼
   ┌──────────────────────────────────┐
   │ queue: stripe.event.process      │
   │  jobId = stripe_event_id         │  ← idempotency for free
   │                                  │
   │  a. read event envelope          │
   │  b. re-fetch canonical object    │  ← Stripe-Account header
   │     from Stripe API              │
   │  c. upsert projection            │  ← last-write-wins on API `created`
   │  d. classify charge type         │
   │  e. recompute settlement row     │
   │  f. schedule recon if payout     │
   └──────────────────────────────────┘
```

### Why the outbox

Insert-then-enqueue as two separate operations has a window where the process dies after the commit and before the enqueue. The event is stored and never processed — a silent hole, which is exactly the failure mode MAGIC exists to prevent. A transactional outbox with a relay poller closes it. The relay is at-least-once; `jobId = stripe_event_id` makes the consumer idempotent.

### Why canonical re-fetch

Webhook payloads are point-in-time snapshots delivered out of order. `charge.refunded` can arrive before `charge.succeeded`. Trusting payloads means writing reconciliation logic that tolerates arbitrary ordering — complex and fragile. Re-fetching means every write reflects current truth, and ordering stops mattering entirely.

**Cost:** one API call per event. At T3 that is ~2.25M calls/day spread across thousands of connected accounts, each with its own rate limit budget. Mitigation: coalesce multiple events for the same object arriving within a short window into a single fetch (debounce by `object_id`, 2 s window).

### Gap closure

Three independent mechanisms, because a single one is a single point of failure:

| Mechanism | Cadence | Catches |
|---|---|---|
| Stripe native retry | Up to 3 days | Transient endpoint failures |
| Event sweeper | Every 15 min, per account, cursor-based | Endpoint down > retry window, misconfigured webhook |
| Completeness check | Daily, per account, per window | Everything else — counts remote vs local objects |

The completeness check is the one that turns "we believe we have everything" into "we verified we have everything."

---

## 6. Reconciliation Pipeline

```
   trigger: payout.paid  |  scheduled  |  manual re-run
                  │
                  ▼
   ┌───────────────────────────────────────────┐
   │  1. Acquire run lock                      │  advisory lock on (tenant, account, payout)
   │  2. Assemble immutable snapshot            │
   │     - balance_transactions in payout       │
   │     - charges/refunds/transfers/fees       │
   │     - settlements                          │
   │     - matched orders                       │
   │     - account state (payouts_enabled…)     │
   │  3. Load active rule_version               │
   │  4. Evaluate — PURE FUNCTION               │
   │       Layer 1: universal ledger integrity  │
   │       Layer 2: charge-type expected posts  │
   │       Layer 3: business / order matching   │
   │  5. Diff against prior run's exceptions    │
   │  6. Persist run + matches + exception diff │
   │  7. Release lock, emit metrics             │
   └───────────────────────────────────────────┘
```

### Payout as the reconciliation unit

A payout corresponds to an actual bank deposit and decomposes exactly into balance transactions. That gives a hard checksum:

```
Σ(balance_transactions in payout).net  ==  payout.amount
```

Daily windows give no such closure and drown in timezone edge cases. Payout-scoped runs give a number that ties to the bank statement — which is the thing finance actually needs.

### Layered rules

| Layer | Charge-type aware | Examples |
|---|:---:|---|
| **L1 — Ledger integrity** | No | Payout checksum, no duplicate object IDs, refund ≤ charge, every dispute has a charge, no orphan balance transaction |
| **L2 — Expected postings** | **Yes** | Direct: application fee present and matches take rate. Destination: transfer exists, amount matches split. Separate: transfers reconcile in aggregate for the window |
| **L3 — Business** | No (reads `settlements`) | Payment without order, order without payment, amount mismatch, shipped-then-refunded, duplicate payment for one order |

Only L2 forks on charge type, and it forks by dispatching to a mapper that emits `expected_postings`. The comparator that checks expected vs actual is shared.

### Maturity windows

Every rule declares `not_before`. Transfers and payouts lag charges by days; evaluating immediately produces a queue that is 90% noise. Indicative defaults:

| Rule class | `not_before` |
|---|---|
| Payout checksum | 0 (payout is terminal) |
| Missing transfer (destination) | 2 h |
| Missing transfer (separate) | 72 h |
| Application fee absent | 1 h |
| Order without payment | 24 h |
| Refund without transfer reversal | 24 h |

These are tenant-tunable parameters, not constants.

### Determinism

Enforced, not assumed. CI runs every fixture scenario twice against the same rule version and asserts byte-identical exception sets. A rule that reads the clock, generates a UUID, or iterates an unordered map fails this test.

---

## 7. Data Flow: Charge Type Unification

```
    Stripe objects (heterogeneous)
              │
              ▼
      ┌───────────────┐
      │  classifier   │  → direct | destination | separate | unclassified
      └───────┬───────┘
              ▼
   ┌──────────────────────────┐
   │  posting mapper registry │
   │   ├── DirectMapper       │
   │   ├── DestinationMapper  │   each emits expected_postings[]
   │   └── SeparateMapper     │
   └──────────┬───────────────┘
              ▼
      ┌───────────────┐
      │  settlements  │  ← ONE normalised shape
      └───────┬───────┘
              ▼
   matching · L3 rules · UI · exports · analytics
        (never learn charge type exists)
```

This boundary is the highest-leverage decision in the system. Get it right and supporting all three charge types costs three mappers plus a test matrix. Get it wrong and charge type leaks into every query, every component, and every export.

---

## 8. Failure Modes

| Component | Failure | Behaviour | Mitigation |
|---|---|---|---|
| `ingest` | Down | Stripe retries up to 3 days | Multi-AZ, minimal dependencies (Postgres + Redis only) |
| Postgres | Primary down | Ingest returns 500 → Stripe retries | Managed failover; sweeper backfills the gap on recovery |
| Redis | Down | Outbox relay stalls; events persist safely | Events are durable in Postgres — nothing is lost, only delayed |
| Stripe API | Rate limited / 5xx | Job retries with exponential backoff | Per-account token bucket; jitter; DLQ after 6 attempts |
| Worker | Killed mid-job | Job returns to queue | Idempotent consumers; `jobId = stripe_event_id` |
| Reconciliation | Crashes mid-run | Run marked `failed`; no partial exceptions committed | Single transaction commit; advisory lock auto-released |
| Clock skew | Ordering confusion | Irrelevant | Ordering is never trusted — canonical re-fetch |
| Export | Times out | Job fails, retried | Streaming writer to object store, never buffered in memory |

**The system-wide property:** every failure mode degrades to *delay*, never to *data loss*. That property is the product.

---

## 9. Observability

### The completeness metric

The one that matters most, exposed as a first-class dashboard tile:

```
completeness_drift{tenant, account, window}
  = stripe_object_count_remote - stripe_object_count_local
```

Any non-zero value is a page. This is the numerical form of the core product claim.

### RED + saturation

| Signal | Metric |
|---|---|
| Rate | `webhook_received_total`, `events_processed_total`, `recon_runs_total` |
| Errors | `webhook_signature_failures_total`, `job_failures_total{queue}`, `dlq_depth{queue}` |
| Duration | `webhook_ack_seconds`, `ingest_lag_seconds`, `recon_run_seconds` |
| Saturation | `queue_depth{queue}`, `stripe_rate_limit_remaining{account}`, `db_connections_active` |

### Alerts

| Alert | Condition | Severity |
|---|---|---|
| Completeness drift | `!= 0` for any account | **Page** |
| DLQ non-empty | `dlq_depth > 0` for 10 min | **Page** |
| Ingest lag | p95 > 300 s for 5 min | **Page** |
| Webhook ack latency | p99 > 500 ms for 5 min | Warn |
| Signature failures | > 10/min for one tenant | Warn (possible misconfiguration or probe) |
| Recon run failures | > 3 consecutive for one account | Warn |

Tracing: OpenTelemetry, trace ID propagated from the webhook request through the outbox job into reconciliation, so a single exception can be traced back to the HTTP request that started it.

---

## 10. Deployment

- **Environments:** dev → staging → production. Staging runs against Stripe test mode with the full fixture corpus replayed nightly.
- **Strategy:** rolling for `web`/`api`; workers drain gracefully (`SIGTERM` → finish in-flight job → exit) with a 60 s grace period.
- **Migrations:** expand → deploy → backfill → contract. Never a destructive migration in the same release as the code that depends on it.
- **Rollback:** application rollback is instant (previous image). Schema is forward-compatible for one release, so a rollback never requires a down-migration.
- **Secrets:** external secret manager, mounted at runtime. Webhook signing secrets and Connect tokens are never in environment files or images.
- **IaC:** Terraform, GitOps-applied. Kubernetes with resource limits, HPA on queue depth for workers (not CPU — queue depth is the real signal), PodDisruptionBudgets on `ingest`.

---

## 11. Key Trade-offs

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Service topology | Modular monolith + workers | Microservices | Distributed transactions in a system whose value is consistency is a bad trade at this scale |
| Event trust model | Canonical re-fetch | Trust payload | Eliminates out-of-order handling entirely; cost is API calls, mitigated by debounce |
| Enqueue reliability | Transactional outbox | Direct enqueue | Closes the commit-then-crash hole; the whole product claim rests on it |
| Reconciliation unit | Payout | Daily window | Payout ties to the bank; gives a hard checksum |
| Multi-tenancy | Shared schema + RLS | Schema/DB per tenant | Lowest ops overhead; RLS gives DB-enforced isolation. Industry default for B2B SaaS in 2026 |
| Charge-type handling | Mapper registry → `settlements` | Branch per type in each rule | Contains the fork to one layer |
| Rule execution | Pure function over snapshot | Query-during-evaluation | Makes determinism testable |
| Frontend data | Server Components + cursor pagination | Client-side fetch + offset | Offset pagination is a table scan at page 4000 |
| Transport | REST + cursor pagination | GraphQL | Predictable query cost matters more than client flexibility for a fixed operator UI |

---

## 12. Evolution Path

**Phase 1 — v1 (this document).** Single region, single Postgres, T1–T2 volume.

**Phase 2 — Growth.** Read replica for the reporting/export workload. Partition `stripe_events` and `balance_transactions` monthly. Split `worker-ingest` scaling policy from `worker-recon`.

**Phase 3 — Scale.** Cold tier: events older than 90 days exported to Parquet in object storage, queried via an external engine for long-range exports. Extract `ingest` to its own service if its scaling profile diverges. Consider Citus or logical sharding by `tenant_id` if a single primary saturates.

**Phase 4 — Breadth.** Second gateway adapter behind the same posting abstraction. Write-back actions (issue transfer reversal from the exception detail) with a full approval workflow. Streaming updates via SSE.

Nothing in Phase 1 forbids any of these. That is the test a baseline architecture has to pass.

---

## 13. Architecture Checklist

| Item | Status |
|---|---|
| Single points of failure | `ingest` isolated and multi-AZ; Postgres managed failover; Redis loss degrades to delay only |
| Consistency model | Strong within Postgres; eventual between Stripe and projections, bounded and measured by `ingest_lag_seconds` |
| Failure modes enumerated | §8 — all degrade to delay, none to loss |
| Capacity estimated | PRD §7 — three tiers, T2 baseline |
| Caching strategy | Signing secrets (5 min TTL), account metadata (60 s), rule definitions (per-run load). No caching of financial figures |
| Auth/authz boundaries | §2 trust boundaries; RLS + application-layer scope checks |
| API versioning | URI-versioned `/v1`, additive-only within a major |
| Observability | §9 — RED + completeness + trace propagation |
| Deployment + rollback | §10 — rolling, expand/contract migrations, forward-compatible schema |
| RPO / RTO | 5 min / 1 hour via PITR |
| Compliance | No PAN stored (last4 + brand only), so PCI scope is minimal. SOC 2 posture pending Q5 |
| Testing strategy | Fixture corpus, determinism double-run, chaos ingest test, isolation negative test, load test at T2 |
| Security posture | §2 + `06-SECURITY.md` |
| Distributed transactions | None — outbox pattern only; no cross-service saga needed in a monolith |
| Async processing | BullMQ, per-queue concurrency and retry policy, DLQ with UI replay |
| Data migration | Expand-contract, forward-compatible for one release |
