# MAGIC — Documentation Set

**Multi-Account Gateway Integrity Console**

A reconciliation platform for Stripe Connect: ingests payment events across a platform account and its connected accounts, normalises three different charge types into one settlement model, reconciles against orders and payouts, and surfaces every discrepancy with the evidence behind it.

Codename only — the deployed product is client-branded.

---

## Read in this order

| # | Document | What it answers |
|---|---|---|
| [00](00-PRD.md) | **Product Requirements** | What is being built, for whom, what is out of scope, how success is measured |
| [01](01-SOFTWARE-ARCHITECTURE.md) | **Software Architecture** | System shape, module boundaries, ingestion and reconciliation pipelines, failure modes, observability |
| [02](02-DATA-ARCHITECTURE.md) | **Data Architecture** | Full DDL, RLS policies, partitioning, indexes, query patterns, migration discipline |
| [03](03-BACKEND-ARCHITECTURE.md) | **Backend Architecture** | NestJS structure, queue topology, rule engine, API design, testing strategy |
| [04](04-FRONTEND-ARCHITECTURE.md) | **Frontend Architecture** | Next.js structure, state ownership, data fetching, table performance, accessibility |
| [05](05-DESIGN-SYSTEM.md) | **UI/UX & Design System** | Tokens (light + dark), typography, components, screens, motion, a11y |
| [06](06-SECURITY-ARCHITECTURE.md) | **Security Architecture** | Threat model, authz layers, secrets, webhook hardening, compliance |
| [07](07-ADR.md) | **Architecture Decision Records** | The twenty load-bearing decisions and what each one costs |

If you read only one: **ADR** tells you which choices were reasoned and which were incidental.

---

## The five claims

MAGIC is a set of assertions with proofs attached. Everything in these documents exists to support one of them.

| Claim | Proof | Doc |
|---|---|---|
| No event is ever dropped | Chaos test — 10% dropped, 10% duplicated, out-of-order, worker killed mid-job → zero completeness drift | 01 §5, 03 §10 |
| Reconciliation is deterministic and replayable | Double-run byte-equality per fixture scenario, in CI | 01 §6, 03 §7 |
| All three Connect charge types are handled | One comparator, one `settlements` projection, three mappers | 01 §7, 02 §7 |
| Every flag is explainable | Exception carries inputs, expected vs actual, rule ID and version, maturity window | 02 §9, 05 §7 |
| Tenants cannot see each other's data | Unfiltered query under tenant A returns zero tenant-B rows — blocking CI test | 02 §10, 06 §4 |

---

## Stack summary

```
Frontend    Next.js 16 (App Router) · React 19.2 · TypeScript 5 strict
            Tailwind 4 · shadcn/ui on Base UI · TanStack Query 5 + Table 8
            Zustand 5 (UI state) · nuqs (URL state)

Backend     NestJS 11 · Node 22 LTS · Fastify (ingest)
            Drizzle 0.45.x · BullMQ 5 · Zod 4 · stripe-node

Data        PostgreSQL 17 (partitioned, RLS) · Redis 7 · S3-compatible object store

Platform    Turborepo + pnpm · OpenTelemetry + Prometheus
            Vitest + Testcontainers + MSW 2 + Playwright · Terraform
```

Versions verified against current releases as of August 2026. Next.js 16.x has had a heavy security-advisory cadence — pin to the current Active LTS patch and treat patch releases as security releases.

---

## Architecture in one diagram

```
  Stripe Connect                             Order Source
  platform + N connected accounts            (mock adapter in v1)
        │  webhooks          ▲ canonical           │
        ▼                    │ re-fetch            ▼
  ┌──────────┐         ┌───────────┐        ┌──────────────┐
  │  ingest  │────────►│  outbox   │        │   adapter    │
  │ (Fastify)│         └─────┬─────┘        └──────┬───────┘
  └──────────┘               │                     │
                             ▼                     ▼
                    ┌────────────────────────────────────┐
                    │  RAW      stripe_events (immutable)│
                    ├────────────────────────────────────┤
                    │  PROJ     charges · transfers ·     │
                    │           payouts · balance_txns    │
                    │           ▼                         │
                    │        settlements  ◄── the         │
                    │                         boundary    │
                    ├────────────────────────────────────┤
                    │  DERIVED  runs · matches ·          │
                    │           exceptions · audit        │
                    └────────────────┬───────────────────┘
                                     │
                      ┌──────────────▼──────────────┐
                      │  rule engine (pure)          │
                      │   L1 ledger integrity        │
                      │   L2 expected postings ◄─────┼── only layer that
                      │   L3 business / orders       │   forks on charge type
                      └──────────────┬──────────────┘
                                     ▼
                         Next.js BFF ──► operator console
```

---

## Build sequence

| Phase | Contents | Exit gate |
|---|---|---|
| P0 | Repo, CI, tenancy + RLS, auth, design tokens | Isolation test green |
| P1 | Webhook pipeline, sweeper, completeness check, DLQ | Chaos test → zero drift |
| P2 | Projections, classifier, `settlements`, account state | All three charge types correct from fixtures |
| P3 | Rule engine, L1 + L2, payout checksum, maturity windows | Determinism test green |
| P4 | Order adapter, matching, L3, exception queue + detail | Operator works a queue end to end |
| P5 | Health dashboard, exports, saved views, rules UI | WCAG AA audit passes |
| P6 | Partitioning, T2 load test, runbooks | NFR targets met under load |

Layer 1 rules plus the classifier ship first. They are useful immediately, they prove the ledger model, and the **discovery report** they produce — "here is your actual charge-type mix, here is what we can't classify" — is a deliverable a client values before any dashboard exists.

---

## What is deliberately not here

Documented so nobody mistakes an omission for an oversight.

| Omitted | Why | Where it would go |
|---|---|---|
| Connect onboarding / KYC | Accounts already exist; MAGIC ingests state only | New module behind the same adapter pattern |
| Write-back to Stripe (reversals, refunds) | Read-only keys remove the largest risk in v1 | v2, with an approval workflow — ADR-019 |
| Real-time streaming to the browser | 15-second polling is sufficient | SSE on the existing REST surface |
| Per-tenant custom rule authoring | Versioned global rules + per-tenant parameters covers v1 | Rule DSL, versioned like code |
| Cross-currency FX normalisation | Reconcile within settlement currency | Reporting-currency layer above `settlements` |
| Multi-region data residency | Single region in v1 | Per-tenant region pinning — architecturally possible, not built |
| Second payment gateway | Nothing forbids it; the posting abstraction is gateway-agnostic | New integration module + mapper set |

---

## Open questions blocking full estimation

| # | Question | What it changes |
|---|---|---|
| Q1 | Actual charge-type mix in the client's account | Rule prioritisation and P3 scope |
| Q2 | Real order source (Shopify / Woo / custom / files) | Adapter #2 |
| Q3 | Historical backfill depth | Backfill sizing, partition retention |
| Q4 | Compliance regime (SOC 2, PCI scope, residency) | Infra region, audit retention, vendor selection |
| Q5 | Resolution SLAs and external notification needs | Notification sink design |

Q1 is answerable without the client: the classifier plus a discovery report resolves it from their own data. That is the strongest opening deliverable — it de-risks the estimate and demonstrates competence before any UI exists.
