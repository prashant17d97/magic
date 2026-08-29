# MAGIC — Product Requirements Document

**Multi-Account Gateway Integrity Console**

| Field | Value |
|---|---|
| Version | 1.0 |
| Status | Draft for review |
| Date | 2026-08-29 |
| Codename | MAGIC (internal only — deployed product is client-branded) |
| Document owner | Engineering |

---

## 1. Problem Statement

A platform business operating Stripe Connect moves money across two ledgers simultaneously: its own platform balance and the balance of every connected account. Orders live in a separate system entirely. Nothing in that arrangement guarantees the three agree.

When they disagree, the failure is silent. A refund issued on the platform side without a corresponding transfer reversal loses real cash. A charge that never produced an application fee loses revenue. A webhook missed during a deploy leaves a permanent hole that no retry will fill after Stripe's retry window closes. Finance discovers these at month-end, by hand, in a spreadsheet, if at all.

**MAGIC exists to make disagreement between payments, transfers, payouts, and orders impossible to miss, and to explain every disagreement it finds.**

---

## 2. Product Principles

These are ranked. Where two conflict, the higher one wins.

1. **Completeness over freshness.** A system that is 30 seconds behind but provably complete beats a real-time system that silently drops events.
2. **Explainability over automation.** Every flag must show its inputs and the rule version that produced it. A finding nobody can verify is a finding nobody will action.
3. **Determinism over cleverness.** Same inputs, same rule version, same output. Always. Reconciliation is a pure function, not a mutation.
4. **Calm over delight.** This is a tool people open when money is missing. Visual restraint is a trust signal. No celebratory motion, no whimsy in the working surfaces.
5. **Density over whitespace.** Operators scan hundreds of rows. Hierarchy and grouping create clarity, not air.

---

## 3. Users & Roles

### Personas

**Finance Operator (primary).** Works the exception queue daily. Needs speed, keyboard navigation, saved filters, and enough evidence in one screen to make a resolve/escalate call without opening Stripe.

**Finance Lead.** Cares about aggregate exposure, trend, and closure rate. Needs the health view, exports for the close process, and confidence that the numbers tie to the bank.

**Engineer / Integrator.** Investigates ingestion problems, replays dead-lettered jobs, tunes rule parameters, verifies a new connected account is syncing.

**Auditor (read-only).** Needs immutable history: what was flagged, who resolved it, on what evidence, under which rule version.

### Roles & Permissions

Permission is `(role, account_scope)`. Scope is `all` or an explicit set of connected accounts.

| Capability | Admin | Member | Viewer |
|---|:---:|:---:|:---:|
| View exceptions, runs, settlements (within scope) | ✅ | ✅ | ✅ |
| Resolve / ignore / reassign exception | ✅ | ✅ | ❌ |
| Add investigation note | ✅ | ✅ | ❌ |
| Trigger reconciliation re-run | ✅ | ✅ | ❌ |
| Generate export | ✅ | ✅ | ✅ |
| Edit rule parameters | ✅ | ❌ | ❌ |
| Enable / disable a rule | ✅ | ❌ | ❌ |
| Manage members, roles, scopes | ✅ | ❌ | ❌ |
| Manage Stripe / order-source connections | ✅ | ❌ | ❌ |
| Replay dead-lettered jobs | ✅ | ❌ | ❌ |
| View audit log | ✅ | ❌ | ✅ |

Rule *authoring* (new rule types) is a code-level deployment, not a runtime permission. Rule *parameters* (thresholds, maturity windows, enabled/disabled) are runtime and Admin-gated.

---

## 4. Scope

### 4.1 In Scope — v1

| # | Capability | Description |
|---|---|---|
| F1 | Stripe Connect ingestion | Per-tenant webhook endpoints, signature verification, immutable raw event log, canonical re-fetch |
| F2 | Gap sweeper | Cursor-based Events API walk + per-object backfill; provable completeness |
| F3 | Charge-type classifier | Derives direct / destination / separate-charges-and-transfers per charge, with confidence |
| F4 | Settlement normalisation | `settlements` projection: gross, fee, platform revenue, merchant net — charge-type agnostic |
| F5 | Order source adapter | Normalised order contract; mock adapter is the v1 reference implementation |
| F6 | Matching engine | Tiered matching (exact / strong / heuristic / unmatched) with tier recorded |
| F7 | Reconciliation engine | Payout-scoped runs, versioned rules, deterministic and re-runnable |
| F8 | Exception queue | Work queue with severity, assignment, states, bulk actions, saved views |
| F9 | Exception detail | Full evidence, rule trace, linked Stripe objects, resolution history |
| F10 | Health dashboard | Completeness, ingestion lag, queue depth, open exposure by severity |
| F11 | Exports | Async CSV / XLSX generation, signed expiring download |
| F12 | RBAC + tenancy | Shared-schema multi-tenancy with Postgres RLS; role + account scope |
| F13 | Audit log | Append-only record of every state-changing action |
| F14 | Scenario generator | Deterministic fixture corpus producing known-correct exception sets |

### 4.2 Explicitly Out of Scope — v1

| Item | Rationale |
|---|---|
| Connect onboarding / KYC flows | Client already has connected accounts; ingest state only |
| Writing back to Stripe (issuing reversals, refunds) | Read-only posture removes an entire blast radius; revisit in v2 |
| Real-time streaming to the browser | Polling with a 15s interval is sufficient; SSE deferred |
| Per-tenant custom rule authoring | Global versioned rules with per-tenant parameters covers v1 |
| Multi-currency FX normalisation into a single reporting currency | Reconcile within settlement currency; cross-currency roll-up is v2 |
| Mobile app | Responsive web down to tablet; phone is view-only |
| Non-Stripe gateways | Architecture must not forbid it; v1 does not build it |

---

## 5. Functional Requirements

### 5.1 Ingestion (F1, F2)

- **FR-1.1** Each tenant receives a unique opaque webhook URL. Tenant identity is resolved from the URL path, never from the request body.
- **FR-1.2** Signature verification runs against the raw request body before any parsing. Failures are logged and rejected with 400; they never enter the event log.
- **FR-1.3** Verified events are written to an append-only log with a uniqueness constraint on `stripe_event_id`. Duplicate delivery is a no-op.
- **FR-1.4** The endpoint returns 200 within a p99 of 150 ms. All processing is asynchronous.
- **FR-1.5** Event payloads are treated as change notifications. Workers re-fetch the canonical object from the Stripe API using the correct `Stripe-Account` context before writing any projection.
- **FR-1.6** A scheduled sweeper walks the Events API per connected account from a stored cursor and ingests anything missing.
- **FR-1.7** A daily completeness check compares remote object counts to local counts per account per window and raises an operational alert on drift.
- **FR-1.8** Events that fail processing after all retries land in a dead-letter queue with full context and are replayable from the UI.

### 5.2 Classification & Settlement (F3, F4)

- **FR-2.1** Every charge is classified as `direct`, `destination`, `separate`, or `unclassified`, with a confidence value and the signals used.
- **FR-2.2** `unclassified` raises an exception rather than failing silently.
- **FR-2.3** Each charge produces a `settlements` row with `customer_gross`, `processing_fee`, `platform_revenue`, `merchant_net`, `funds_holder_account_id`, `merchant_account_id`, `settlement_status`.
- **FR-2.4** Everything above the settlement layer — matching, rules, UI, exports — reads `settlements` and does not branch on charge type.

### 5.3 Matching (F6)

- **FR-3.1** Matching is tiered and the tier is persisted:

  | Tier | Signal | Confidence |
  |---|---|---|
  | `exact` | `metadata.order_id` on PaymentIntent | 1.00 |
  | `strong` | `payment_intent_id` stored on the order | 0.95 |
  | `heuristic` | amount + customer email + time window | 0.60–0.85 |
  | `unmatched` | no candidate above threshold | — |

- **FR-3.2** Heuristic matches above the auto-accept threshold are applied but flagged as low-confidence and are filterable.
- **FR-3.3** A payment matching more than one order candidate produces an ambiguity exception rather than an arbitrary pick.

### 5.4 Reconciliation (F7)

- **FR-4.1** A run is scoped to `(tenant, stripe_account, payout)`. Platform-level runs reconcile application fees and transfers.
- **FR-4.2** Every run records `rule_version`, input snapshot bounds, start/end, and outcome counts.
- **FR-4.3** Re-running the same scope with the same rule version produces an identical exception set.
- **FR-4.4** Every rule declares a **maturity window** (`not_before` offset). A rule does not evaluate an object until the window has elapsed, preventing false positives on money still in flight.
- **FR-4.5** Rules run in three layers: universal (ledger integrity) → charge-type-specific (expected postings) → business (order matching). Layer failures short-circuit downstream layers for that object.
- **FR-4.6** Exception suppression is driven by account state: an account with `payouts_enabled = false` does not generate missing-payout exceptions.
- **FR-4.7** Both **transactional** and **aggregate** reconciliation modes are supported. Aggregate mode is required where transfers lack `source_transaction`.

### 5.5 Exception Workflow (F8, F9)

- **FR-5.1** Exception states: `open` → `investigating` → (`resolved` | `ignored`). Reopening is permitted and recorded.
- **FR-5.2** Every transition records actor, timestamp, and required note (for `ignored` and `resolved`).
- **FR-5.3** Bulk actions are supported for `ignore` and `assign` only. Bulk resolve is deliberately not offered.
- **FR-5.4** Exception detail shows: rule identity and version, the exact inputs evaluated, the expected vs actual postings, linked Stripe object IDs, the matched order, and the full transition history.
- **FR-5.5** Saved views persist filter + sort + column + density configuration per user, and are optionally shareable to the tenant.
- **FR-5.6** Re-running reconciliation does not resurrect a resolved exception unless the underlying facts changed; identity is `(rule_id, subject_id, scope)`.

### 5.6 Exports (F11)

- **FR-6.1** Exports are always asynchronous. No synchronous endpoint returns a full dataset.
- **FR-6.2** Completed exports produce a signed URL expiring in 15 minutes; regeneration requires re-authorisation.
- **FR-6.3** Export rows are constrained to the requester's account scope at generation time, not at request time.

---

## 6. Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Webhook ack latency | p99 ≤ 150 ms |
| NFR-2 | Ingest-to-projection lag | p95 ≤ 60 s under normal load |
| NFR-3 | Exception queue first paint | p95 ≤ 800 ms (server-rendered shell) |
| NFR-4 | Table filter/sort response | p95 ≤ 400 ms at 10M settlement rows |
| NFR-5 | Event completeness | 100% — zero tolerance, verified daily |
| NFR-6 | Reconciliation determinism | 100% — enforced by CI double-run test |
| NFR-7 | API availability | 99.9% monthly |
| NFR-8 | RPO / RTO | RPO 5 min (PITR), RTO 1 hour |
| NFR-9 | Accessibility | WCAG 2.1 AA across all working surfaces |
| NFR-10 | Cross-tenant isolation | Database-enforced; verified by an automated test that omits the tenant filter |
| NFR-11 | Audit retention | 7 years, immutable |
| NFR-12 | Browser support | Last 2 versions of Chrome, Edge, Safari, Firefox |

---

## 7. Capacity Assumptions

Volume is unknown, so the design targets three tiers. Tier 2 is the sizing baseline; Tier 3 must be reachable without re-architecture.

| Tier | Charges/day | Events/day (≈4.5×) | Connected accounts | Raw event growth |
|---|---|---|---|---|
| T1 | 5,000 | ~22,500 | < 100 | ~1.4 GB/mo |
| T2 | 50,000 | ~225,000 | 100–2,000 | ~14 GB/mo |
| T3 | 500,000 | ~2,250,000 | 2,000–20,000 | ~140 GB/mo |

Webhook bursts are assumed spiky: design the endpoint for 10× sustained rate for 60-second windows.

---

## 8. Success Metrics

| Metric | Definition | Target |
|---|---|---|
| Completeness drift | Remote count − local count, per account per day | 0 |
| Detection lag | Time from money movement to exception raised | < 1 maturity window + 15 min |
| False positive rate | Exceptions closed as `ignored: not a real issue` | < 5% after week 4 |
| Queue closure rate | Exceptions resolved ÷ raised, weekly | > 95% |
| Unexplained exposure | Sum of open critical exception value | Trending to 0 |
| Time to verdict | Median time from opening an exception to a state change | < 90 s |

The false-positive target is the one that decides adoption. A queue that cries wolf gets abandoned in week three.

---

## 9. Release Plan

| Phase | Contents | Exit criteria |
|---|---|---|
| **P0 — Foundations** | Repo, CI, tenancy + RLS, auth, design tokens, scenario generator skeleton | Cross-tenant isolation test green |
| **P1 — Ingest** | Webhook pipeline, raw log, canonical re-fetch, sweeper, completeness check, DLQ + replay | Chaos test passes: 10% dropped, 10% duplicated, out-of-order, worker killed → zero drift |
| **P2 — Ledger** | Projections, classifier, `settlements`, account state sync | All three charge types produce correct settlement rows from fixtures |
| **P3 — Reconciliation** | Rule engine, Layer 1 + 2 rules, payout checksum, runs, maturity windows | Double-run determinism test green; fixture corpus produces expected exception sets |
| **P4 — Workflow** | Order adapter, matching, Layer 3 rules, exception queue + detail, audit log | Operator can work a queue end-to-end without leaving the app |
| **P5 — Surface** | Health dashboard, exports, saved views, rule settings, member management | WCAG AA audit passes; export of 1M rows completes |
| **P6 — Hardening** | Partitioning, load test at T2, runbooks, `PRODUCTION_GAPS.md` closure | Load test sustains T2 with NFR targets met |

---

## 10. Open Questions

| # | Question | Blocks | Owner |
|---|---|---|---|
| Q1 | Which charge types does the client actually use, and in what mix? | Rule prioritisation | Discovery report (P2) |
| Q2 | Real order source — Shopify, Woo, custom, or file drop? | Adapter #2 | Client |
| Q3 | Historical backfill depth required? | Backfill sizing, partition retention | Client |
| Q4 | Does the client operate more than one Stripe platform account? | Confirmed supported; affects onboarding UX | Client |
| Q5 | Compliance regime — SOC 2, PCI scope, data residency? | Infra region, audit retention, vendor choice | Client |
| Q6 | Who owns resolution SLAs, and do exceptions need to notify externally? | Notification sink design | Client |

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Exception queue is too noisy at launch and loses trust | High | High | Maturity windows from day one; tune thresholds against fixture corpus before real data; launch with Layer 1 only |
| Separate-charges-and-transfers has no linkable `source_transaction` | High | Medium | Aggregate reconciliation mode built as a first-class feature, not a fallback |
| Backfill saturates Stripe rate limits across thousands of accounts | Medium | High | Per-account concurrency caps, resumable cursors, dedicated low-priority queue |
| Mock order data diverges from real client data shape | High | Medium | Adapter contract with schema validation; mock is a conforming implementation, not a special case |
| Volume lands at T3 unexpectedly | Medium | High | Partition from day one; cursor pagination everywhere; no offset queries |
| Tenant isolation bug | Low | Critical | RLS with `FORCE`, non-owner app role, automated negative test in CI |
