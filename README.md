# MAGIC

**Multi-Account Gateway Integrity Console** — a reconciliation platform for Stripe Connect.

It ingests payment events across a platform account and its connected accounts, normalises three
different Connect charge types into one settlement model, reconciles against orders and payouts,
and surfaces every discrepancy with the evidence behind it.

The architecture, data model, security posture and design system are specified in [`docs/`](docs/).
This README covers how to run what those documents describe.

---

## Running it

```bash
pnpm install
pnpm db:up          # postgres 17, redis 7 and minio in docker
pnpm db:migrate
pnpm fixtures:seed  # a populated workspace, not an empty database
pnpm dev            # web, api, ingest and worker together
```

The console is at **http://localhost:3000**. Sign in with any of:

| Email | Role | What it demonstrates |
|---|---|---|
| `admin@northwind.test` | admin | Rule tuning, member management, dead-letter replay |
| `operator@northwind.test` | member | Working the exception queue |
| `scoped@northwind.test` | member | Account scope — sees only Acme Studio |
| `auditor@northwind.test` | viewer | Read-only, with the audit log |

Password for every seeded account: `magic-dev-password`.

`pnpm fixtures:seed` is the important one. A developer's first minute in this codebase should end
with a populated exception queue containing known-broken scenarios, not an empty database and a
README explaining what the product would do if it had data.

---

## What is running

| Service | Port | Why it is separate |
|---|---|---|
| `web` | 3000 | The console, and the only path to the API. Holds the session; the browser never holds a token. |
| `api` | 4000 | REST v1. **Never routable from the internet** — the console reaches it with a service token. |
| `ingest` | 4001 | The Stripe webhook endpoint, and nothing else. |
| `worker` | 4002 | BullMQ processors. `WORKER_ROLE` selects ingest, recon or ops. |

`ingest` is its own deployable on purpose. A traffic spike on the dashboard must never delay a
webhook acknowledgement, and a webhook flood must never take down the console. It is the single
most valuable bulkhead in the system.

---

## Verifying the claims

The product makes five assertions. Each one is a test, and each one blocks CI.

```bash
pnpm test                 # everything
pnpm test:determinism     # every fixture, run twice, byte-identical findings
pnpm test:chaos           # dropped, duplicated, reordered, worker killed mid-job
pnpm --filter @magic/db test        # cross-tenant isolation, unfiltered query
pnpm --filter @magic/ingest test    # bad signature, replay, tampered body
pnpm --filter @magic/api test       # every role against every capability
```

| Claim | How it is proven |
|---|---|
| No event is ever dropped | `chaos.test.ts` — the log ends holding exactly what Stripe sent |
| Reconciliation is deterministic | `determinism.test.ts` — same snapshot checksum, same exception payloads |
| All three charge types are handled | `corpus.test.ts` — one comparator, three mappers, fourteen scenarios |
| Every flag is explainable | Each exception carries inputs, expected against actual, rule id and version |
| Tenants cannot see each other | `rls.test.ts` — a deliberately unfiltered query returns zero foreign rows |

---

## The shape of the code

```
apps/
  web/         Next.js 16 console and BFF. The only thing the browser talks to.
  api/         NestJS 11 REST API. Internal network only.
  ingest/      Fastify webhook endpoint. Postgres and a secret cache, nothing else.
  worker/      BullMQ processors, outbox relay, sweeper, exports.

packages/
  domain/      PURE. Money, classifier, settlement normalisation, the rule engine.
  contracts/   Zod schemas shared by the API and the console.
  db/          Drizzle schema, plain SQL migrations, RLS helpers, cursor pagination.
  recon/       Snapshot assembly, run orchestration, matching. The application layer.
  security/    Password hashing, session tokens, log redaction, CSV escaping.
  stripe-client/  Typed client, per-account rate limiting, webhook verification.
  order-source/   The adapter contract, and a mock that conforms to it.
  fixtures/    The scenario corpus and the demo seeder.
```

`packages/domain` imports nothing from `apps/`, nothing from the database, and no framework. It is
a library of pure functions over plain data, and an ESLint rule fails the build if that changes.
That purity is what makes the determinism test a check rather than an aspiration.

---

## How reconciliation works

```
webhook ─► verify signature against the RAW body
        ─► INSERT event + INSERT outbox job   (one transaction)
        ─► 200 OK

relay   ─► claim with FOR UPDATE SKIP LOCKED ─► enqueue, jobId = event id

worker  ─► re-fetch the canonical object from Stripe
        ─► upsert the projection, guarded by source_version
        ─► classify the charge, recompute its settlement

run     ─► advisory lock on the scope
        ─► assemble an immutable, checksummed snapshot
        ─► evaluate: L1 ledger ─► L2 postings ─► L3 business
        ─► diff against the previous run, commit once
```

Three details carry most of the weight:

- **The webhook payload is a notification, not data.** The worker re-fetches the object, so a
  refund arriving before its charge still produces the correct state. Ordering stops mattering.
- **Persist and enqueue share a transaction.** Two statements would leave a window where a crash
  stores an event nobody ever processes — the silent hole this product exists to prevent.
- **Rules are pure functions over a frozen snapshot.** No clock, no randomness, no I/O. That is
  what makes a double-run byte-equality test possible.

---

## Deploying

Both targets build the same two images from `infra/Dockerfile`.

```bash
# locally, the full production topology
SERVICE_TOKEN=$(openssl rand -hex 24) SESSION_SECRET=$(openssl rand -hex 32) \
  docker compose -f infra/docker-compose.yml up --build
```

- **Render** — `render.yaml` at the repository root describes every service. `api` is declared as
  a private service (`type: pserv`) and has no public address.
- **Railway** — see [`infra/railway.md`](infra/railway.md).

The one thing to get right on either platform: **`api` must not be publicly reachable.** It trusts
the tenant, role and account scope on its request headers, because the only thing that can set
them is the console's server side reading a server-held session. Expose it and a header edit
becomes a tenant switch — row-level security would still contain the damage to the named tenant,
but every application-layer check above it would be gone.

---

## Configuration

Copy `.env.example` to `.env`. The values that have no safe default and fail the process at boot:

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | all | Connects as `magic_app`, a **non-owner** role. Owners bypass RLS. |
| `DATABASE_URL_OWNER` | migrations | Only migrations use this. |
| `SERVICE_TOKEN` | web, api | Must match on both. No default. |
| `SESSION_SECRET` | web | 32 characters minimum. |
| `REDIS_URL` | all | Queues, rate-limit buckets, session store. |
| `STRIPE_ENABLED` | worker | Off by default, so the fleet runs against seeded data with no credentials. |

Secrets are stored as `*_ref` pointers in the database, never as values. A full dump of Postgres —
the largest and most frequently copied artefact in the system — yields no usable credential.

---

## Known gaps

[`PRODUCTION_GAPS.md`](PRODUCTION_GAPS.md) lists what is built, what is stubbed, and what a real
deployment still needs. It is written to be read before a production decision, not after one.
