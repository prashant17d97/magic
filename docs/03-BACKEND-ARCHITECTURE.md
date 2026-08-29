# MAGIC — Backend Architecture

**NestJS 11 · Node 22 LTS · TypeScript 5 strict · Version 1.0**

---

## 1. Stack

Versions verified against current releases as of August 2026.

| Concern | Choice | Version | Why this and not the alternative |
|---|---|---|---|
| Runtime | Node.js | 22 LTS | Bun is faster but the Stripe SDK, BullMQ, and pg tooling all target Node; boring wins here |
| Framework | NestJS | 11 | DI and module boundaries are the point — they make the layering in §2 enforceable rather than aspirational. Express alone would leave structure to convention |
| HTTP adapter (`ingest`) | Fastify | 5 | The webhook endpoint is throughput-critical and needs raw-body access; Fastify's lower overhead matters on the one hot path |
| Language | TypeScript | 5.x strict | `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` on |
| DB | PostgreSQL | 17 | Partitioning, RLS, `FOR UPDATE SKIP LOCKED`, generated columns — all used |
| ORM | Drizzle | 0.45.x | SQL-shaped, plain readable migrations, no client generation step, no runtime proxy. Prisma's abstraction fights RLS session binding and partitioned tables |
| Queue | BullMQ | 5.x | Redis-backed, per-queue concurrency, groups, repeatable jobs, first-class DLQ |
| Cache / broker | Redis | 7 | Queues, rate-limit token buckets, session store |
| Payments SDK | `stripe-node` | latest | Pin the API version explicitly in code, not by account default |
| Validation | Zod | 4.x | Runtime boundary validation; `drizzle-zod` derives schemas from tables |
| Observability | OpenTelemetry + Prometheus | — | Trace propagation webhook → job → run |
| Testing | Vitest + Testcontainers | — | Real Postgres in integration tests; RLS cannot be meaningfully mocked |
| Monorepo | Turborepo + pnpm | — | Shared types between API and web without publishing |

**On Drizzle over Prisma.** Two concrete reasons beyond taste: MAGIC binds `SET LOCAL app.tenant_id` per transaction, which needs direct control of the connection lifecycle; and it queries partitioned tables where the generated SQL matters. Drizzle's migrations are plain SQL a DBA can read during an incident — a real operational advantage for a financial system.

---

## 2. Repository Layout

```
magic/
├── apps/
│   ├── api/                    # NestJS REST API (internal only)
│   ├── ingest/                 # NestJS + Fastify, webhook endpoint ONLY
│   ├── worker/                 # BullMQ processors (one image, role via env)
│   └── web/                    # Next.js 16 (see 04-FRONTEND-ARCHITECTURE.md)
│
├── packages/
│   ├── db/                     # Drizzle schema, migrations, RLS helpers
│   │   ├── schema/
│   │   ├── migrations/         # plain .sql
│   │   ├── rls.ts
│   │   └── tenant-context.ts
│   ├── domain/                 # PURE. No I/O. No framework imports.
│   │   ├── money/
│   │   ├── ledger/             # posting graph, expected-posting types
│   │   ├── classification/     # charge-type inference
│   │   ├── settlement/         # normalisation
│   │   └── rules/
│   │       ├── registry.ts
│   │       ├── layer1/         # ledger integrity
│   │       ├── layer2/         # per-charge-type mappers
│   │       └── layer3/         # business rules
│   ├── stripe-client/          # typed wrapper, per-account rate limiting
│   ├── order-source/           # adapter interface + mock implementation
│   ├── contracts/              # Zod schemas + inferred DTOs, shared with web
│   └── fixtures/               # scenario generator + golden expectations
│
└── tooling/                    # eslint, tsconfig, vitest presets
```

### The dependency rule

```
apps/*  →  packages/{db, stripe-client, order-source}  →  packages/domain
                                                              ↑
                                              packages/contracts (types only)
```

`packages/domain` imports nothing from `apps/`, nothing from `db`, nothing from NestJS. It is a library of pure functions over plain data. This is enforced by an ESLint `no-restricted-imports` rule and checked in CI — not left to discipline.

---

## 3. NestJS Module Graph

```
AppModule
├── PlatformModule                  (global)
│   ├── ConfigModule                typed env via Zod, fails fast at boot
│   ├── DatabaseModule              Drizzle provider + TenantContext (ALS)
│   ├── QueueModule                 BullMQ registration
│   ├── ObservabilityModule         OTel, Prometheus, structured logging
│   ├── AuditModule                 interceptor-driven append-only log
│   └── SecretsModule               secret-manager client, cached with TTL
│
├── TenancyModule                   tenant resolution, RLS binding guard
├── IamModule                       users, memberships, permission evaluation
│
├── IntegrationModule
│   ├── StripeModule                client factory, rate limiter, backoff
│   └── OrderSourceModule           adapter registry (mock, future: shopify)
│
├── IngestModule                    webhook controller, outbox writer
├── ProjectionModule                canonical re-fetch, upsert, classify
├── SettlementModule                settlement normalisation
├── MatchingModule                  tiered matching
├── ReconciliationModule            run orchestration, snapshot assembly
├── ExceptionModule                 workflow state machine
├── ExportModule                    async generation, signed URLs
├── SweeperModule                   gap scan, completeness check
└── ReportingModule                 health metrics, aggregates
```

`apps/ingest` boots only `PlatformModule + TenancyModule + IngestModule`. Its dependency surface is deliberately tiny: Postgres and the secret cache. Fewer moving parts on the one endpoint that must never be down.

---

## 4. Tenant Context Binding

Every database interaction runs inside a transaction with the tenant GUC set. This is centralised so no repository can forget it.

```ts
// packages/db/tenant-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export const tenantALS = new AsyncLocalStorage<{ tenantId: string }>();

export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return tenantALS.run({ tenantId }, () =>
    db.transaction(async (tx) => {
      // SET LOCAL — scoped to this transaction, cannot leak into the
      // next request that reuses this pooled connection.
      await tx.execute(sql`SET LOCAL app.tenant_id = ${tenantId}`);
      return fn(tx);
    }),
  );
}
```

A NestJS interceptor wraps every request handler in `withTenant`. A base repository class asserts that `tenantALS.getStore()` is populated and throws otherwise — so a query issued outside tenant context fails loudly in development rather than silently returning nothing in production.

Workers do the same: every job payload carries `tenantId`, and the processor wrapper opens the transaction before the handler runs.

---

## 5. Queue Topology

One Redis, several queues with deliberately different policies. Sharing one queue for all work means a slow export starves webhook processing.

| Queue | Concurrency | Attempts | Backoff | Notes |
|---|---:|---:|---|---|
| `stripe.event.process` | 50/worker | 6 | exp, 2s base, ±20% jitter | `jobId = stripe_event_id` |
| `stripe.object.fetch` | 20/worker | 5 | exp, 1s base | Grouped by `stripe_account_id` for per-account rate limiting |
| `settlement.compute` | 20/worker | 3 | exp | Triggered by projection change |
| `recon.run` | 4/worker | 2 | fixed 30s | CPU-bound; low concurrency on purpose |
| `match.resolve` | 10/worker | 3 | exp | |
| `export.generate` | 2/worker | 2 | fixed 60s | Long-running; streams to object store |
| `sweep.events` | 5/worker | 3 | exp | Repeatable, every 15 min per account |
| `sweep.completeness` | 2/worker | 2 | fixed | Repeatable, daily |
| `notify.dispatch` | 10/worker | 5 | exp | |

Worker roles are selected by env var so one image serves all three deployables:

```
WORKER_ROLE=ingest  → stripe.event.process, stripe.object.fetch, settlement.compute
WORKER_ROLE=recon   → recon.run, match.resolve
WORKER_ROLE=ops     → export.generate, sweep.*, notify.dispatch
```

HPA scales on **queue depth**, not CPU. CPU is a lagging, misleading signal for queue workers; depth is the thing that actually indicates the system is behind.

### Dead letter handling

```ts
// A failed-past-retry job is not dropped. It is preserved with full context.
worker.on('failed', async (job, err) => {
  if (job.attemptsMade < job.opts.attempts) return;
  await dlq.add('dead', {
    originalQueue: job.queueName,
    jobId: job.id,
    data: job.data,
    error: { message: err.message, stack: err.stack },
    failedAt: new Date().toISOString(),
  });
  metrics.dlqDepth.inc({ queue: job.queueName });
});
```

`dlq_depth > 0` for ten minutes is a page. In a financial system a permanently failed job is unacceptable, and it needs a human path back in — hence the replay UI, which re-enqueues onto the original queue with the original `jobId`.

---

## 6. Stripe Client

```ts
// packages/stripe-client/client.ts
export class StripeClientFactory {
  // Pin the API version in code. Relying on the account's default means a
  // dashboard toggle can silently change the shape of every response.
  private static readonly API_VERSION = '2026-06-30' as const;

  async forAccount(tenantId: string, connectionId: string, connectedAccountId?: string) {
    const secret = await this.secrets.getApiKey(tenantId, connectionId);
    const client = new Stripe(secret, {
      apiVersion: StripeClientFactory.API_VERSION,
      maxNetworkRetries: 0,   // we own retry policy; the SDK's would fight BullMQ's
      timeout: 20_000,
    });
    return connectedAccountId
      ? withAccountContext(client, connectedAccountId)  // Stripe-Account header
      : client;
  }
}
```

### Rate limiting

Per-account token buckets in Redis. Stripe's limits are enforced per account, so a token bucket keyed by `stripe_account_id` distributes budget correctly and prevents one busy merchant from starving the rest.

```ts
const allowed = await limiter.tryAcquire(`stripe:${accountId}`, {
  capacity: 80,       // conservative headroom below the documented ceiling
  refillPerSecond: 80,
});
if (!allowed) throw new RateLimitedError({ retryAfterMs: 1_000 });
// BullMQ catches this and reschedules with backoff — no busy-waiting.
```

### Fetch debounce

At T3 a naive re-fetch-per-event is ~2.25M API calls a day. Multiple events for the same object frequently arrive within seconds of each other, so coalesce: a 2-second debounce window keyed on `object_id` collapses those into one fetch. Typical reduction is 30–40% of calls at no correctness cost, because the fetch always returns current state anyway.

---

## 7. Rule Engine

The engine is pure. This is what makes determinism testable rather than hoped for.

```ts
// packages/domain/rules/types.ts
export interface Rule {
  readonly id: string;                    // 'L2.DEST.TRANSFER_MISSING'
  readonly layer: 1 | 2 | 3;
  readonly chargeTypes?: ChargeType[];    // L2 only
  readonly severity: Severity;
  readonly maturitySeconds: number;
  readonly mode: 'transactional' | 'aggregate' | 'both';

  evaluate(snapshot: ReconSnapshot, params: RuleParams): Finding[];
}

export interface ReconSnapshot {
  readonly asOf: string;                  // frozen; rules never read the clock
  readonly tenantId: string;
  readonly stripeAccountId: string;
  readonly accountState: AccountState;    // drives suppression
  readonly payout?: PayoutSnapshot;
  readonly balanceTransactions: readonly BalanceTxn[];
  readonly charges: readonly ChargeSnapshot[];
  readonly refunds: readonly RefundSnapshot[];
  readonly transfers: readonly TransferSnapshot[];
  readonly reversals: readonly ReversalSnapshot[];
  readonly applicationFees: readonly AppFeeSnapshot[];
  readonly settlements: readonly SettlementSnapshot[];
  readonly orders: readonly OrderSnapshot[];
  readonly checksum: string;              // sha256 of a canonical serialisation
}
```

Constraints enforced by lint rules and code review:

- No `Date.now()`, no `new Date()` — use `snapshot.asOf`
- No `Math.random()`, no `crypto.randomUUID()`
- No iteration over `Map`/`Set` without an explicit sort
- No I/O of any kind
- No mutation of the snapshot

### Layer 1 example — the payout checksum

```ts
export const PayoutChecksumRule: Rule = {
  id: 'L1.PAYOUT.CHECKSUM',
  layer: 1,
  severity: 'critical',
  maturitySeconds: 0,
  mode: 'both',

  evaluate(s) {
    if (!s.payout) return [];
    const reconstructed = s.balanceTransactions
      .filter(b => b.payoutId === s.payout!.id)
      .reduce((acc, b) => acc + b.netMinor, 0n);

    const delta = reconstructed - s.payout.amountMinor;
    if (delta === 0n) return [];

    return [{
      ruleId: 'L1.PAYOUT.CHECKSUM',
      subjectType: 'payout',
      subjectId: s.payout.id,
      severity: 'critical',
      exposureMinor: abs(delta),
      currency: s.payout.currency,
      expected: { amountMinor: s.payout.amountMinor.toString() },
      actual:   { reconstructedMinor: reconstructed.toString(),
                  transactionCount: s.balanceTransactions.length },
      evidence: { payoutId: s.payout.id,
                  balanceTransactionIds: s.balanceTransactions.map(b => b.id) },
      narrative: `Payout ${s.payout.id} does not equal the sum of its balance `
               + `transactions. Difference: ${fmt(delta, s.payout.currency)}.`,
    }];
  },
};
```

### Layer 2 — mapper registry

```ts
export const postingMappers: Record<ChargeType, PostingMapper> = {
  direct:      new DirectChargeMapper(),
  destination: new DestinationChargeMapper(),
  separate:    new SeparateChargeMapper(),
  unclassified: new NullMapper(),   // raises L1.CLASSIFY.UNKNOWN instead
};

// Each returns expected postings. ONE shared comparator checks them
// against actual balance transactions — the charge-type fork stops here.
interface PostingMapper {
  derive(charge: ChargeSnapshot, ctx: LedgerContext): ExpectedPosting[];
}
```

### Aggregate mode

Required when transfers lack `source_transaction` — per-transaction matching is structurally impossible, so the rule reconciles totals over a window instead:

```ts
export const SeparateTransferAggregateRule: Rule = {
  id: 'L2.SEP.TRANSFER_AGGREGATE',
  layer: 2,
  chargeTypes: ['separate'],
  severity: 'high',
  maturitySeconds: 259_200,        // 72h — transfers lag badly in this model
  mode: 'aggregate',

  evaluate(s, params) {
    const expected = s.settlements
      .filter(x => x.chargeType === 'separate')
      .reduce((a, x) => a + x.merchantNetMinor, 0n);
    const actual = s.transfers.reduce((a, t) => a + (t.amountMinor - t.reversedMinor), 0n);

    const delta = expected - actual;
    const tolerance = BigInt(params.toleranceMinor ?? 0);
    if (abs(delta) <= tolerance) return [];
    return [ /* aggregate finding with both totals and the window bounds */ ];
  },
};
```

---

## 8. API Design

REST, URI-versioned, cursor-paginated. GraphQL was considered and rejected: the operator UI has a fixed, well-known set of queries, and predictable server-side cost matters more here than client flexibility. An unbounded GraphQL query against a 10M-row table is a production incident waiting to happen.

### Conventions

- Base: `/v1`
- Errors: RFC 9457 `application/problem+json`
- Pagination: `?cursor=<opaque>&limit=50`, response carries `next_cursor`
- Idempotency: `Idempotency-Key` header required on all POST mutations
- Filtering: explicit query params only — no arbitrary filter DSL
- All money in responses: `{ "amount_minor": "12345", "currency": "USD" }` as a **string**, because `BIGINT` exceeds `Number.MAX_SAFE_INTEGER` and JSON numbers are IEEE 754 doubles

### Endpoints

```
GET    /v1/health/summary                  completeness, lag, queue depth, exposure
GET    /v1/exceptions                      filter: status, severity, rule, account,
                                                   assignee, currency, date range
GET    /v1/exceptions/:id                  full evidence + rule trace + history
POST   /v1/exceptions/:id/transitions      { to: 'resolved', note }
POST   /v1/exceptions/bulk/ignore          { ids[], note }        (bulk resolve absent by design)
POST   /v1/exceptions/bulk/assign          { ids[], assigneeId }

GET    /v1/runs                            reconciliation run history
GET    /v1/runs/:id                        checksum delta, counts, snapshot digest
POST   /v1/runs                            { accountId, payoutId? } manual re-run

GET    /v1/settlements                     normalised payment explorer
GET    /v1/settlements/:chargeId           settlement + postings + linked objects

GET    /v1/accounts                        connected accounts + state + open counts
GET    /v1/accounts/:id/completeness       drift history

GET    /v1/rules                           registry + tenant overrides
PATCH  /v1/rules/:ruleId                   { enabled, severity, maturitySeconds, params }

POST   /v1/exports                         { kind, format, filters } → 202 + id
GET    /v1/exports/:id                     status; signed URL when ready

GET    /v1/audit                           filter by resource, actor, date

POST   /v1/ops/dlq/:jobId/replay           Admin only
GET    /v1/ops/dlq                         Admin only
```

### Error shape

```json
{
  "type": "https://magic.dev/problems/exception-transition-invalid",
  "title": "Invalid exception transition",
  "status": 409,
  "detail": "Cannot transition from 'resolved' to 'investigating' without reopening.",
  "instance": "/v1/exceptions/6f2c…/transitions",
  "trace_id": "0af7651916cd43dd8448eb211c80319c"
}
```

`trace_id` is the OTel trace ID, so a user-reported error maps directly to the trace.

---

## 9. Authorization

Two independent enforcement layers. Neither is trusted alone.

```ts
@Controller('v1/exceptions')
export class ExceptionController {
  @Post(':id/transitions')
  @RequirePermission('exception:transition')   // 1. role check
  @ScopedToAccount('exception', 'id')          // 2. account_scope check
  async transition(...) { /* 3. RLS enforces tenant at the DB */ }
}
```

| Layer | Enforces | Failure mode if the layer is missing |
|---|---|---|
| Permission guard | Role capability | A Viewer could resolve exceptions |
| Scope guard | `account_scope` membership | A scoped member could act on another region's accounts |
| Postgres RLS | Tenant boundary | Cross-tenant data exposure |

RLS is the last line, not the only one. The application layers give precise 403s with useful messages; RLS guarantees that a bug in those layers is a bug, not a breach.

---

## 10. Testing Strategy

| Level | Tooling | Covers | Gate |
|---|---|---|---|
| Unit — domain | Vitest | Rules, mappers, classifier, money arithmetic | 95% on `packages/domain` |
| Unit — services | Vitest + mocks | Orchestration logic | 85% |
| Integration | Vitest + Testcontainers (real Postgres) | Repositories, RLS, migrations, partition routing | All repository methods |
| Contract | Zod schema round-trip | API DTOs shared with `web` | Compile-time + runtime |
| Fixture / golden | Scenario generator | End-to-end: events in → exceptions out | Every scenario has an expected set |
| Determinism | Vitest | Double-run byte equality per scenario | Must pass |
| Chaos | Custom harness | Dropped / duplicated / reordered events, worker kill | Zero drift |
| Isolation | Integration | Unfiltered query under tenant A returns no tenant-B rows | Must pass |
| Load | k6 | T2 sustained + 10× burst on `ingest` | NFR-1, NFR-2 met |

### The fixture corpus

The most reusable artefact the project produces. Each fixture is `(event sequence) → (expected exception set)`.

| Scenario | Exercises |
|---|---|
| `refund-before-charge` | Out-of-order tolerance via canonical re-fetch |
| `duplicate-event-delivery` | Idempotency on `stripe_event_id` |
| `transfer-no-source-transaction` | Aggregate reconciliation mode |
| `app-fee-refunded-transfer-not-reversed` | The highest-value real-world finding |
| `payout-during-open-dispute` | Maturity windows and suppression interplay |
| `connected-account-negative-balance` | Platform liability detection |
| `restricted-account-payouts-paused` | Suppression correctness — must produce **no** exception |
| `rounding-drift-percentage-split` | Tolerance parameters |
| `partial-refund-exceeds-remaining` | `CHECK` constraint + L1 rule |
| `unclassifiable-charge-shape` | Classifier fallback path |
| `duplicate-payment-one-order` | L3 business rule |
| `order-never-paid` | L3 + maturity window |

Because these are deterministic, they double as the demo script: the system catches twelve classes of error before touching any client data.

---

## 11. Configuration

Typed, validated at boot, fails fast.

```ts
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(100).default(20),
  REDIS_URL: z.string().url(),
  SECRETS_PROVIDER: z.enum(['aws-sm', 'vault', 'env']),
  STRIPE_API_VERSION: z.string(),
  WORKER_ROLE: z.enum(['ingest', 'recon', 'ops']).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  EXPORT_BUCKET: z.string(),
  EXPORT_URL_TTL_SECONDS: z.coerce.number().default(900),
});
```

A process that cannot construct valid config exits non-zero at startup. It never starts in a degraded state and never discovers a missing variable on the first webhook.

---

## 12. Local Development

```bash
pnpm install
pnpm db:up                    # docker: postgres 17 + redis 7
pnpm db:migrate
pnpm fixtures:seed            # scenario generator → deterministic broken data
pnpm dev                      # turbo: api, ingest, worker, web

pnpm stripe:listen            # stripe CLI → localhost ingest endpoint
pnpm test                     # unit + integration
pnpm test:determinism         # double-run equality
pnpm test:chaos               # drop/duplicate/reorder/kill
pnpm test:coverage
```

`pnpm fixtures:seed` is the important one. A developer's first minute in the codebase should end with a populated exception queue containing twelve known-broken scenarios — not an empty database and a README explaining what the product would do if it had data.
