# Production gaps

What is built, what is deliberately stubbed, and what a real deployment still needs. Written to be
read before a production decision rather than discovered after one.

An omission below is a decision, not an oversight. Where the architecture documents already name a
thing as out of scope, that is noted rather than re-argued.

---

## Built and verified

| Area | State |
|---|---|
| Tenant isolation | Postgres RLS with `FORCE`, non-owner application role, both `USING` and `WITH CHECK`. Proven by a deliberately unfiltered query in CI. Holds only while services connect as `magic_app`; handing them the owner connection string discards the least-privilege half of it, which is why `render.yaml` never does. |
| Webhook ingestion | Signature verification against the raw body, replay tolerance, per-tenant rate limit, 1 MB body cap, transactional outbox. Eight blocking tests. |
| Idempotency | Unique on `(tenant_id, stripe_event_id)`; outbox unique on `(tenant_id, queue, job_key)`; BullMQ `jobId` derived from both. |
| Charge-type unification | Three mappers, one comparator, one `settlements` projection. Nothing above the boundary branches on charge type. |
| Rule engine | Pure over a frozen snapshot. Determinism proven by a double-run byte-equality test across the whole corpus. |
| Exception identity | `sha256(rule_id|subject_id|scope_key)`. Re-running never duplicates a finding and never resurrects a resolved one unless the figures moved. |
| Authorisation | Three independent layers: service token, role capability, account scope — with row-level security underneath. Full matrix tested. |
| Audit log | Written by an interceptor, append-only by revoked grant rather than by convention. |
| Exports | Asynchronous, streamed, scope snapshotted at generation time, CSV formula injection neutralised. |
| Console | Every screen in the design system, both themes, three density modes, full keyboard flow. |

---

## Stubbed, with the seam already in place

### The order source is a mock

`packages/order-source` defines the contract and ships one conforming implementation. The contract
is the `orders` table, not the mock, so a Shopify adapter is a registration plus an implementation
with no change above it. **What a real deployment needs:** a second adapter, plus a sync worker
that walks its cursor.

### Stripe API access is off by default

`STRIPE_ENABLED=false` lets the whole fleet run against seeded data with no credentials. With it
on, the worker re-fetches canonical objects, the sweeper walks the Events API, and the
completeness check counts remote objects. **What a real deployment needs:** restricted read-only
keys per connection, and a secret manager — `SECRETS_PROVIDER=env` is a development convenience
and the interface for `aws-sm` and `vault` is defined but not implemented.

### Exports are written to a local volume

`generateExport` streams to a path under `EXPORT_DIR`, and the download route serves it with a
path-traversal check. **What a real deployment needs:** an S3-compatible target and a genuinely
signed URL. The fifteen-minute expiry is enforced today by the application rather than by the
storage layer, which means a leaked link is only as short-lived as the app's own check.

This is not merely a hardening gap. The worker writes the file and the console reads it, so the
feature works only where those two share a filesystem: one machine, the Docker Compose stack
which mounts a single volume into both, or a single container running the whole fleet. Split the
services across machines and exports stop working altogether — and it is the split, not the code,
that decides. `EXPORT_STORAGE_SHARED` says which situation a deployment is in, so the download
route can report the real reason rather than a 404 that reads as an expired file.

Where they do share a filesystem, the storage is still ephemeral: nothing is written to a disk,
so a generated file does not survive a restart. The fifteen-minute download window usually covers
that over, which is exactly the kind of thing that works until it does not.

Nothing else in the path is machine-local — the queue is Redis and the state is Postgres — so an
object store behind `EXPORT_BUCKET` is the whole remaining distance, and it is also what would
let the service scale past one instance.

### XLSX exports fall back to CSV

The format is accepted and recorded; the writer produces CSV. **What a real deployment needs:** a
streaming XLSX writer, which is the only reason this is not already done — buffering a workbook in
memory would reintroduce the failure the async export exists to avoid.

---

## Not built

| Item | Why | Where it would go |
|---|---|---|
| MFA | The PRD schedules TOTP for admins in v1.1 | `users.mfa_secret_ref` already exists |
| Notifications | Open question Q6 — nobody has said who owns resolution SLAs | `notify.dispatch` queue is registered and idle |
| Write-back to Stripe | ADR-019: a read-only posture removes the largest blast radius in v1 | Would need an approval workflow, not just an endpoint |
| Cross-currency reporting | Reconciliation happens within a settlement currency by design | A reporting layer above `settlements` |
| Cold storage tiering | Partitioning is in place; the archive job is not | `DETACH PARTITION` then Parquet, per the data architecture |
| Real-time streaming | 15-second polling is sufficient at this scale | SSE over the existing REST surface |
| OpenTelemetry traces | Prometheus metrics are exposed; distributed tracing is not wired | Trace id already propagates from webhook to job |

---

## Operational work a deployment still needs

1. **Partition maintenance must be scheduled.** `ensure_partitions(3)` runs at migration time and
   creates three months ahead. Nothing calls it again. A default partition catches anything that
   would otherwise fail an insert, so the failure mode is degraded performance rather than a
   rejected webhook — but it needs a cron.

2. **The completeness check needs Stripe enabled to mean anything.** With `STRIPE_ENABLED=false`
   it compares the local count to itself and always reports zero drift. That is honest in
   development and dangerous in production, because the tile would read green regardless.

3. **HPA on queue depth, not CPU.** The worker exposes `queue_depth` on `/metrics` for exactly
   this. CPU looks calm while a backlog builds.

4. **Backups need a restore drill.** PITR is a database setting; a restore that has never been
   performed is a hypothesis.

5. **Load test at Tier 2 before committing to it.** The schema, indexes and cursor pagination are
   designed for 50,000 charges a day, and the query plans are shaped for it, but the number is a
   design target rather than a measurement.

---

## Deliberate simplifications, with their ceiling

| Simplification | Ceiling | Upgrade path |
|---|---|---|
| Outbox relay polls every 200 ms | Adds up to 200 ms to ingest-to-projection lag | `LISTEN/NOTIFY` if the lag budget tightens |
| In-process webhook rate limit | Per-instance, so N instances allow N times the limit | Move the token bucket to Redis, as the Stripe limiter already is |
| Session store in a single Redis | Redis loss signs everybody out | Redis replica; events stay durable in Postgres regardless |
| Heuristic matching is amount plus email plus window | Misses split payments and partial captures | Additional signals behind the same tier interface |
| `settlements` is unpartitioned | Fine below roughly 100M rows | Partition by `charged_at`, as the data architecture describes |
