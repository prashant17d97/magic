# MAGIC — Architecture Decision Records

Each record captures a load-bearing choice, why it was made, and what it costs. The purpose is that a future maintainer can tell which decisions were reasoned and which were incidental — without that distinction they either preserve everything or discard everything, and both are wrong.

**Status key:** `Accepted` · `Superseded` · `Deprecated` · `Proposed`

| # | Decision | Status |
|---|---|---|
| [001](#adr-001) | Modular monolith with a separate worker fleet | Accepted |
| [002](#adr-002) | Treat webhooks as change notifications; re-fetch canonical state | Accepted |
| [003](#adr-003) | Transactional outbox between persist and enqueue | Accepted |
| [004](#adr-004) | Reconcile per payout, not per time window | Accepted |
| [005](#adr-005) | Model charge types as posting mappers behind a settlement projection | Accepted |
| [006](#adr-006) | Rules are pure functions over an immutable snapshot | Accepted |
| [007](#adr-007) | Every rule declares a maturity window | Accepted |
| [008](#adr-008) | Shared schema multi-tenancy with Postgres RLS | Accepted |
| [009](#adr-009) | Money as `BIGINT` minor units plus a currency code | Accepted |
| [010](#adr-010) | Drizzle over Prisma | Accepted |
| [011](#adr-011) | Next.js as a BFF; no token in the browser | Accepted |
| [012](#adr-012) | REST with cursor pagination, not GraphQL | Accepted |
| [013](#adr-013) | Stable exception fingerprints | Accepted |
| [014](#adr-014) | Order sources behind an adapter; mock is a conforming implementation | Accepted |
| [015](#adr-015) | Split the ingest endpoint into its own deployable | Accepted |
| [016](#adr-016) | Time-partition high-volume tables from day one | Accepted |
| [017](#adr-017) | Sora for display only; Inter for body and tables | Accepted |
| [018](#adr-018) | No optimistic UI on financial mutations | Accepted |
| [019](#adr-019) | Read-only Stripe posture in v1 | Accepted |
| [020](#adr-020) | Permission as `(role, account_scope)` | Accepted |

---

<a id="adr-001"></a>
## ADR-001 — Modular monolith with a separate worker fleet

**Context.** MAGIC has workloads with different profiles: a latency-critical webhook endpoint, high-throughput ingestion, CPU-bound reconciliation, and a read-heavy dashboard. The instinct is microservices.

**Decision.** One codebase with strictly enforced module boundaries, deployed as four artefacts (`web`, `api`, `ingest`, `worker`) sharing a database.

**Consequences.**
- No distributed transactions, no cross-service saga, no eventual consistency between our own components — valuable in a system whose core property is provable consistency.
- Module boundaries are enforced by lint rules, so extraction later is mechanical.
- One database is a scaling ceiling. Accepted: T2 fits comfortably, T3 needs partitioning (ADR-016), and beyond that a read replica and possibly logical sharding.

**Alternatives rejected.** Microservices — pays distributed-systems cost for organisational benefits a small team does not need. Single process including workers — a slow export would delay webhook processing.

---

<a id="adr-002"></a>
## ADR-002 — Treat webhooks as change notifications; re-fetch canonical state

**Context.** Stripe webhooks are at-least-once and arrive out of order. `charge.refunded` can precede `charge.succeeded`. Trusting payload contents means every writer must tolerate arbitrary ordering.

**Decision.** A webhook means "object X changed." The worker re-fetches X from the Stripe API using the correct `Stripe-Account` context and writes current state.

**Consequences.**
- Ordering stops mattering entirely. No vector clocks, no reordering buffer, no conditional merge logic.
- One API call per event: ~2.25M/day at T3. Mitigated by a 2-second debounce keyed on `object_id`, cutting 30–40% of calls, and by the fact that Stripe rate limits are per account, so the load distributes naturally across thousands of connected accounts.
- Adds ingestion latency (a round trip). Acceptable — PRD principle 1 ranks completeness above freshness.
- A Stripe outage stalls processing. Events are already durable in Postgres; processing resumes on recovery.

**Alternatives rejected.** Trust the payload with `created`-based last-write-wins — simpler, but a payload is a point-in-time snapshot and reconstructing derived fields from partial snapshots is subtly wrong in ways that surface as incorrect financial findings.

---

<a id="adr-003"></a>
## ADR-003 — Transactional outbox between persist and enqueue

**Context.** Insert-then-enqueue as two operations has a window where the process dies after commit and before enqueue. The event is stored and never processed — a permanent silent hole, which is precisely the failure MAGIC exists to prevent.

**Decision.** The webhook handler writes the event and an `outbox_jobs` row in one transaction. A relay polls every 200 ms with `FOR UPDATE SKIP LOCKED` and publishes to BullMQ.

**Consequences.**
- No lost jobs. The product's central claim rests on this.
- Adds up to 200 ms of latency before processing begins. Irrelevant against a 60-second lag target.
- One more moving part (the relay). It is small, stateless, and horizontally scalable.
- At-least-once delivery to the queue; `jobId = stripe_event_id` makes the consumer idempotent.

**Alternatives rejected.** Enqueue inside the transaction — Redis is not transactional with Postgres, so this just moves the window. Reconcile missing jobs from `process_status` on a timer — works, but adds a slow detection path for a problem the outbox eliminates.

---

<a id="adr-004"></a>
## ADR-004 — Reconcile per payout, not per time window

**Context.** Reconciliation needs a scope. The obvious choice is a daily window.

**Decision.** The unit is the payout. Runs are scoped to `(tenant, stripe_account, payout)`. Platform-level runs reconcile application fees and transfers.

**Consequences.**
- Gives a hard checksum: `Σ(balance_transactions).net == payout.amount`. That number ties to an actual bank deposit, which is what finance needs.
- Eliminates timezone edge cases — a payout has no ambiguous boundary.
- Objects not yet assigned to a payout need a supplementary window-scoped run. Handled by `scope_type = 'window'`.
- Reconciliation is naturally event-driven (`payout.paid`) rather than scheduled.

**Alternatives rejected.** Daily windows — no closure property, timezone-dependent, and produces a number that reconciles to nothing external.

---

<a id="adr-005"></a>
## ADR-005 — Model charge types as posting mappers behind a settlement projection

**Context.** Stripe Connect has three charge types with materially different money flows. All three must be supported, and the client's mix is unknown.

**Decision.** A classifier derives charge type. A per-type mapper emits `expected_postings`. One shared comparator checks expected against actual. All results normalise into a `settlements` table. Everything above that layer — matching, business rules, UI, exports — reads `settlements` and never branches on charge type.

**Consequences.**
- Supporting all three costs three mappers plus a test matrix, not three engines.
- One boundary to get right. If it leaks, it leaks into everything.
- The `settlements` invariant (`gross = fee + platform + net + refunded`) becomes a testable correctness property of the mappers.
- Charge type stays available as a filter and detail field; it just never structures a query.

**Alternatives rejected.** Branch per charge type inside each rule — triples rule count and makes every future rule three times as expensive. Support only one type initially — the mix is unknown, and retrofitting the abstraction after building around one type is a rewrite.

---

<a id="adr-006"></a>
## ADR-006 — Rules are pure functions over an immutable snapshot

**Context.** Determinism is a product claim: same inputs, same rule version, same findings. A rule that queries during evaluation cannot guarantee it.

**Decision.** `evaluate(snapshot, params) → Finding[]`. No I/O, no clock, no randomness, no unordered iteration. The snapshot is assembled once, checksummed, and frozen.

**Consequences.**
- Determinism is testable in CI: run every fixture twice, assert byte-identical output.
- Rules are trivially unit-testable — no database, no mocks.
- Snapshot assembly must be exhaustive up front, which costs memory on large payouts. Bounded by payout size, and payouts are naturally bounded.
- Rules cannot fetch extra data mid-evaluation. If a rule needs something, it goes in the snapshot contract. This is a feature: it makes the data dependency explicit.

**Alternatives rejected.** Rules with repository access — convenient, and it makes determinism unprovable, which forfeits the product claim.

---

<a id="adr-007"></a>
## ADR-007 — Every rule declares a maturity window

**Context.** Transfers and payouts lag charges by hours or days. Evaluating "missing transfer" immediately flags every in-flight payment.

**Decision.** Each rule declares `not_before`. An object is not evaluated by that rule until the window has elapsed. Windows are tenant-tunable.

**Consequences.**
- Prevents the failure mode that kills reconciliation tools: a queue that is 90% noise on day one, abandoned by week three.
- Detection is intentionally delayed. Stated in the PRD as detection lag = one maturity window + 15 minutes, not hidden.
- Windows need tuning against real data. Made routine by surfacing per-rule ignore rate in the settings UI.

**Alternatives rejected.** Global grace period — different rules have genuinely different physics; a 72-hour global window would delay payout checksums that are correct immediately.

---

<a id="adr-008"></a>
## ADR-008 — Shared schema multi-tenancy with Postgres RLS

**Context.** Three models: database-per-tenant, schema-per-tenant, shared schema with `tenant_id`.

**Decision.** Shared schema, `tenant_id` on every table leading every composite index, RLS with `FORCE` on every tenant-scoped table, application connecting as a non-owner role.

**Consequences.**
- Lowest operational overhead: one migration path, one connection pool, one backup.
- Database-enforced isolation. A forgotten `WHERE` returns nothing rather than another tenant's data.
- Weakest physical blast-radius isolation. Mitigated by RLS plus a blocking CI test.
- Requires `SET LOCAL` inside a transaction — session-level `SET` leaks across pooled connections. Centralised in `withTenant` so no repository can get it wrong.
- Policy expressions must be index-usable. Simple equality on an indexed leading column; verified with `EXPLAIN` in CI.

**Alternatives rejected.** Database-per-tenant — best isolation, but migration and connection management across thousands of tenants is a full-time job. Schema-per-tenant — same migration problem with worse tooling.

**Note.** This matches the 2026 industry default for B2B SaaS on Postgres.

---

<a id="adr-009"></a>
## ADR-009 — Money as `BIGINT` minor units plus a currency code

**Context.** Financial amounts in floating point produce rounding errors. In a system whose purpose is detecting discrepancies, a rounding error is indistinguishable from a real finding.

**Decision.** Every amount is `BIGINT` in the currency's minor unit, always paired with a `CHAR(3)` currency column. `BigInt` in TypeScript. Amounts cross the API as **strings**.

**Consequences.**
- Exact arithmetic. No floating-point class of bug exists.
- Currency travels with every amount — a bare number is a bug by construction.
- API responses use strings because `BIGINT` exceeds `Number.MAX_SAFE_INTEGER` and JSON numbers are IEEE 754 doubles. Parsing to `Number` in the client is silent corruption.
- Formatting must handle currency exponents (JPY 0, KWD 3), not assume 2.
- Slightly more verbose than a decimal type. Worth it.

**Alternatives rejected.** `NUMERIC(19,4)` — exact, but invites implicit float conversion in the application layer and does not carry currency. Floats — never.

---

<a id="adr-010"></a>
## ADR-010 — Drizzle over Prisma

**Context.** Both are mature TypeScript ORMs.

**Decision.** Drizzle.

**Consequences.**
- Direct control over the connection lifecycle, needed for `SET LOCAL app.tenant_id` per transaction.
- Generated SQL is predictable, which matters when querying partitioned tables and verifying RLS plans with `EXPLAIN`.
- Migrations are plain readable SQL — a DBA can read and fix them during an incident without learning our toolchain. A real operational advantage for a financial system.
- No client generation step in CI.
- Less mature ecosystem than Prisma; fewer ready-made integrations. Accepted.

**Alternatives rejected.** Prisma — excellent DX, but its abstraction fights RLS session binding and partitioned-table queries, which are two of our load-bearing mechanisms.

---

<a id="adr-011"></a>
## ADR-011 — Next.js as a BFF; no token in the browser

**Context.** The dashboard needs authenticated API access. The usual pattern puts a JWT in the browser.

**Decision.** The NestJS API is internal-only. Next.js route handlers are the sole entry point. The browser holds an opaque `HttpOnly` session cookie.

**Consequences.**
- No token exists in the browser, so XSS cannot steal one. This removes the asset rather than protecting it.
- Server Components can query directly — the exception queue's first page renders with no client waterfall.
- Tenant and account scope are attached server-side from the session and cannot be influenced by the client.
- One more network hop. Negligible on an internal network.
- Next.js becomes a hard dependency for API access. Accepted; there is no third-party API consumer in v1.

**Alternatives rejected.** JWT in memory with a refresh cookie — workable and standard, but strictly more attack surface for no benefit here.

---

<a id="adr-012"></a>
## ADR-012 — REST with cursor pagination, not GraphQL

**Context.** The frontend needs flexible filtering across several large tables.

**Decision.** REST, URI-versioned `/v1`, cursor pagination, explicit filter parameters.

**Consequences.**
- Predictable server-side cost per endpoint. An unbounded GraphQL query against a 10M-row table is a production incident waiting to happen.
- Cursor pagination scales; `OFFSET 200000` is a scan of 200,000 rows nobody sees.
- Explicit filters mean the index coverage is knowable and testable.
- Less client flexibility. Acceptable — the operator UI has a fixed, well-known query set.
- Some over-fetching. Mitigated by field-set parameters on the two heaviest endpoints.

**Alternatives rejected.** GraphQL — flexibility we do not need, at a cost (query complexity limits, N+1 protection, depth limiting) we would have to build and maintain.

---

<a id="adr-013"></a>
## ADR-013 — Stable exception fingerprints

**Context.** Reconciliation re-runs. Without stable identity, each run creates duplicate findings and resurrects resolved ones.

**Decision.** `fingerprint = sha256(rule_id | subject_id | scope_key)`, unique per tenant. A re-run updates `last_seen_*` on the existing row rather than inserting.

**Consequences.**
- Re-running is safe and idempotent — a prerequisite for treating reconciliation as a pure function.
- Resolved exceptions stay resolved. They reopen only when `expected`/`actual` change, which means the facts changed.
- Changing a rule's identity is a breaking change; rule IDs are permanent once released.
- Deliberately excludes `rule_version` from the fingerprint: a rule version bump should update an existing finding, not fork it.

**Alternatives rejected.** New row per run — loses workflow state and makes the queue meaningless. Fingerprint including rule version — duplicates every finding on every rule release.

---

<a id="adr-014"></a>
## ADR-014 — Order sources behind an adapter; mock is a conforming implementation

**Context.** v1 uses mock order data. The real source is unknown.

**Decision.** Define the normalised `orders`/`shipments` schema and an `OrderSource` interface now. The mock adapter implements that interface exactly like a future Shopify adapter will.

**Consequences.**
- Adding a real source later is a new adapter, not a migration.
- The mock is not a special case, so it cannot drift into a shape a real source could not produce.
- Enables the scenario generator: deterministic broken data producing known-correct exception sets — simultaneously the test suite, the demo, and the spec for the next implementation.
- Forces the order contract to be designed before its consumer exists. That is the point.

**Alternatives rejected.** Seed script writing directly to tables — faster, and it leaves the contract undefined until the first real integration, at which point it is discovered rather than designed.

---

<a id="adr-015"></a>
## ADR-015 — Split the ingest endpoint into its own deployable

**Context.** The webhook endpoint and the dashboard API have opposite characteristics: one is latency-critical, spiky, and unauthenticated; the other is authenticated, query-heavy, and human-paced.

**Decision.** `apps/ingest` is a separate deployable running Fastify, booting only `Platform`, `Tenancy`, and `Ingest` modules.

**Consequences.**
- A webhook flood cannot degrade the dashboard, and dashboard traffic cannot delay a webhook ack. The most valuable bulkhead in the system.
- Independent scaling and independent failure domains.
- Minimal dependency surface (Postgres + secret cache) on the endpoint that must never be down.
- Two deployables to operate. Shared code keeps the duplication near zero.

**Alternatives rejected.** One API serving both — simpler to operate, and it couples the availability of the thing that must never drop data to the thing users click on all day.

---

<a id="adr-016"></a>
## ADR-016 — Time-partition high-volume tables from day one

**Context.** At T3, `stripe_events` grows ~140 GB/month. Volume is unknown at design time.

**Decision.** `stripe_events` and `balance_transactions` are `RANGE` partitioned monthly on `stripe_created_at` from the first migration.

**Consequences.**
- Retention is `DETACH` + archive + `DROP`, not a bulk `DELETE` that fights autovacuum and bloats the heap.
- Queries with a time predicate prune partitions.
- Composite primary keys must include the partition key — accepted, and reflected in the schema.
- Partitions must be pre-created; a scheduled job maintains three months ahead.
- Slight added complexity at T1 volume where it is unnecessary. Cheap insurance: retrofitting partitioning onto a 500M-row table is a migration nobody wants to run.

**Alternatives rejected.** Partition later — the correct time to partition is before there is data.

---

<a id="adr-017"></a>
## ADR-017 — Sora for display only; Inter for body and tables

**Context.** The brand direction specifies Sora. The primary surface is a dense financial data grid.

**Decision.** Sora for display, headings, wordmark, and KPI figures. Inter for body, tables, labels, and chrome. JetBrains Mono for Stripe object IDs and checksums.

**Consequences.**
- Sora carries brand identity where it is strongest — 20px and above, and in the all-caps wordmark.
- Inter provides genuine tabular figures at 13px, which is the difference between an aligned column of amounts and a jittering one.
- Mono for IDs disambiguates `0/O` and `1/l/I`, which matters when operators copy `ch_3PxK2mLkdIwHu7ix1a2b3c4d`.
- Three font families to load. Subset and self-hosted; total cost is modest.
- Deviates from a single-family brand direction. Documented, with the reasoning above.

**Alternatives rejected.** Sora throughout — costs legibility at the size where 90% of reading happens, for a brand expression nobody perceives at 13px.

---

<a id="adr-018"></a>
## ADR-018 — No optimistic UI on financial mutations

**Context.** Optimistic updates are standard practice for responsive interfaces.

**Decision.** Mutations that change financial state — resolve, ignore, assign, trigger re-run — show a pending state and wait for the server.

**Consequences.**
- The UI never displays a state that turns out to be false.
- Slightly slower perceived interaction. Acceptable at ~200 ms.
- No rollback logic, no reconciliation of divergent client state.
- In a product whose entire premise is accuracy, showing a resolve as complete before it is complete would undermine the thing being sold.

**Alternatives rejected.** Optimistic with rollback — correct for a "like" button, wrong when the user is about to tell their manager the discrepancy is closed.

---

<a id="adr-019"></a>
## ADR-019 — Read-only Stripe posture in v1

**Context.** Some exceptions have obvious remediations — issue a transfer reversal, refund an application fee. Automating them is tempting.

**Decision.** v1 uses restricted read-only Stripe keys. No write scopes.

**Consequences.**
- A MAGIC compromise cannot move money. Given that MAGIC holds credentials for potentially thousands of connected accounts, this is the single largest risk reduction available.
- Simplifies the compliance posture and the incident response story.
- Operators must act in Stripe. Mitigated by deep links from the exception detail directly to the relevant Stripe object.
- Write-back is deferred to v2 with a full approval workflow, and the architecture does not forbid it.

**Alternatives rejected.** Write scopes behind a feature flag — a flag is one config change away from being on, and the key still carries the scope regardless of whether the feature is enabled.

---

<a id="adr-020"></a>
## ADR-020 — Permission as `(role, account_scope)`

**Context.** The brief specified three roles: Admin, Member, Viewer. Under Connect, a marketplace ops person is often responsible for a subset of sellers.

**Decision.** Permission is a pair. `role` grants capabilities; `account_scope` (null = all, or an explicit array) restricts which connected accounts those capabilities apply to.

**Consequences.**
- Costs one column and one guard now.
- Retrofitting a scope dimension later means auditing every query and every endpoint — a rewrite in practice.
- Enables a common enterprise requirement (regional or segment-based ops teams) without a new role type.
- Exports snapshot the scope at generation time, so a scope change does not retroactively alter a delivered file.

**Alternatives rejected.** Roles only — matches the brief literally, and the first customer with regional ops teams forces the change anyway.
