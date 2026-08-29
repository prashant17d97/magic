# MAGIC — Security Architecture

**Version 1.0 · 2026-08-29**

---

## 1. Security Posture

MAGIC holds read-only credentials to other companies' payment infrastructure and a complete record of their money movement. It does not hold cardholder data and does not move money. That shapes everything below.

| Property | Value | Consequence |
|---|---|---|
| Cardholder data | Never stored — `last4` + brand only | PCI DSS scope is minimal (SAQ-A territory); no CDE to segment |
| Money movement | Read-only in v1 | Compromise cannot directly cause funds transfer |
| Credentials held | Stripe restricted API keys, webhook signing secrets | These are the crown jewels |
| Data sensitivity | Transaction records, customer emails, merchant financials | GDPR-relevant personal data present |
| Blast radius of a tenant breach | Full financial history for that tenant | Tenant isolation is the top control |

**The two highest-value assets are Stripe credentials and tenant isolation.** Controls are weighted accordingly.

---

## 2. Threat Model (STRIDE)

| Threat | Vector | Control |
|---|---|---|
| **Spoofing** | Forged webhook impersonating Stripe | HMAC signature verification against raw body, before parse; timestamp tolerance window rejects replays |
| **Spoofing** | Session hijack | `HttpOnly` + `Secure` + `SameSite=Lax` cookie; rotation on privilege change; short idle timeout |
| **Tampering** | Modified event payload in transit | TLS 1.3 only; signature covers the payload |
| **Tampering** | Retroactive edit of a finding | `audit_log` and `stripe_events` are append-only, enforced by revoked `UPDATE`/`DELETE` grants |
| **Repudiation** | "I never resolved that" | Every transition records actor, IP, user agent, request ID, timestamp |
| **Info disclosure** | Cross-tenant data leak | Postgres RLS with `FORCE` + non-owner role; automated negative test in CI |
| **Info disclosure** | Credential exfiltration | Secrets stored in a manager, referenced by ID; never in the DB, env files, images, or logs |
| **Info disclosure** | Export link sharing | Signed URLs, 15-minute expiry, scope snapshotted at generation |
| **DoS** | Webhook flood | `ingest` isolated from `api`; per-tenant rate limit; queue absorbs the spike |
| **DoS** | Expensive query | Cursor pagination only; hard `LIMIT` caps; statement timeout |
| **Elevation** | Viewer performs a write | Permission guard + scope guard + RLS — three independent layers |
| **Elevation** | Scoped member acts outside scope | `account_scope` checked server-side against the resource, never from the request |

---

## 3. Authentication

### Session model

```
Browser ──HttpOnly session cookie──► Next.js BFF ──service token──► NestJS API
```

No JWT reaches the browser. There is no access token in `localStorage` because there is no access token in the browser at all — the single most effective XSS mitigation available, since it removes the asset rather than protecting it.

| Property | Value |
|---|---|
| Cookie flags | `HttpOnly; Secure; SameSite=Lax; Path=/` |
| Session store | Redis, server-side, with a rotating opaque identifier |
| Absolute lifetime | 12 hours |
| Idle timeout | 60 minutes |
| Rotation | On sign-in, on role change, on tenant switch |
| CSRF | Double-submit token required on all state-changing requests |
| MFA | TOTP required for `admin`; optional for others (v1.1) |

### Service-to-service

The NestJS API is bound to the internal network and never routable from the internet. The BFF authenticates with a service token, rotated on a schedule. Network policy denies all ingress to `api` except from `web`.

---

## 4. Authorization — Defence in Depth

Three independent layers. A bug in any one is contained by the others.

```
1. Permission guard    role → capability            → 403 with a clear reason
2. Scope guard         account_scope → resource     → 403
3. Postgres RLS        tenant_id → every row        → returns nothing
```

| Layer | If it fails alone |
|---|---|
| Permission guard missing | A Viewer could resolve an exception — bad, contained within tenant |
| Scope guard missing | A scoped member sees accounts outside their remit — bad, contained within tenant |
| RLS missing | **Cross-tenant breach** — catastrophic |

RLS is the last line and must never be the only one. The application layers produce precise, useful 403s; RLS guarantees that a mistake in those layers is a bug rather than a breach.

### RLS hardening

```sql
-- The application role must NOT own the tables. Owners bypass RLS
-- unless FORCE is set, and superusers bypass it unconditionally.
ALTER TABLE <every_tenant_table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <every_tenant_table> FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON <table>
  USING      (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
```

Both `USING` and `WITH CHECK` are declared on every policy. `USING` alone filters reads but permits a write that lands in another tenant's partition of the table.

Context binding uses `SET LOCAL` inside an explicit transaction. A session-level `SET` survives the connection's return to the pool and leaks into the next request — the exact failure RLS was adopted to prevent.

### CI enforcement

```
Test: seed tenants A and B with overlapping data
      bind session to A
      SELECT * FROM settlements     (deliberately unfiltered)
      assert zero rows belong to B
```

This test is the proof of the isolation claim. Without it, isolation is documentation.

---

## 5. Secrets Management

| Secret | Storage | Rotation | Access |
|---|---|---|---|
| Stripe restricted API key (per connection) | Secret manager | Manual, tracked | `worker`, `api` |
| Webhook signing secret (per connection) | Secret manager | Supports overlap window | `ingest` only |
| Session signing key | Secret manager | 90 days, dual-key overlap | `web` |
| Service token (BFF → API) | Secret manager | 30 days | `web`, `api` |
| Database credentials | Secret manager / IAM auth | Managed | All |
| Export signing key | Secret manager | 90 days | `worker-ops`, `web` |

The database stores only `*_ref` pointers. A full dump of the Postgres instance yields **no usable credential** — an important property given that the database is the largest and most frequently copied artefact in the system.

### Rotation with overlap

Webhook signing secrets rotate with both old and new active for a window, because Stripe cannot atomically switch secrets. Verification tries the current secret first, then the previous one if it is within its overlap window.

### Least-privilege Stripe keys

Restricted keys with read-only scopes on exactly the resources MAGIC reads: charges, payment intents, refunds, disputes, transfers, reversals, application fees, payouts, balance transactions, accounts, events. **No write scopes in v1.** A compromised MAGIC key cannot move money.

---

## 6. The Webhook Endpoint

The only public unauthenticated surface, and therefore the most carefully specified.

```ts
// apps/ingest — the order of these steps is the security property
export async function handleWebhook(req: FastifyRequest) {
  // 1. Tenant from the URL path. NEVER from the body — the body is
  //    untrusted until step 3, and reading it first is the whole attack.
  const key = req.params.webhookPathKey;
  const conn = await connectionCache.byPathKey(key);      // 5-min TTL
  if (!conn) return reply.code(404).send();               // no oracle

  // 2. Raw body. Any JSON parse before verification breaks the signature
  //    and is the single most common Stripe integration bug.
  const raw = req.rawBody;
  const sig = req.headers['stripe-signature'];

  // 3. Verify. Constant-time comparison; timestamp tolerance rejects replay.
  let event: Stripe.Event;
  try {
    const secret = await secrets.webhookSecret(conn.id);
    event = stripe.webhooks.constructEvent(raw, sig, secret, TOLERANCE_SECONDS);
  } catch {
    metrics.signatureFailures.inc({ tenantId: conn.tenantId });
    return reply.code(400).send();                        // no detail leaked
  }

  // 4. Persist + enqueue in ONE transaction (outbox).
  await withTenant(db, conn.tenantId, async (tx) => {
    await tx.insert(stripeEvents).values(toRow(event, conn)).onConflictDoNothing();
    await tx.insert(outboxJobs).values(toJob(event, conn)).onConflictDoNothing();
  });

  return reply.code(200).send();
}
```

| Control | Purpose |
|---|---|
| Opaque path key | An attacker cannot enumerate tenants or guess an endpoint |
| 404 on unknown key | No existence oracle for valid tenants |
| Raw body verification | Correctness *and* security — parsing first invalidates the signature |
| Timestamp tolerance | Replay protection |
| Generic 400 on failure | No information about why verification failed |
| Per-tenant rate limit | One tenant's flood cannot starve another |
| Body size cap (1 MB) | Memory exhaustion protection |
| Separate deployable | A flood here cannot take down the dashboard |

Signature failures above ~10/minute for one tenant raise a warning — usually a misconfigured endpoint after a rotation, occasionally a probe. Either is worth knowing about.

---

## 7. Application Security

### Input handling

Every boundary validates with Zod: HTTP request bodies and query params, job payloads, Stripe API responses (shape-checked, not trusted), order-adapter output, and environment configuration at boot.

Stripe responses are validated too. A silent API-version shift that changes a field's type should fail loudly at the boundary rather than propagate a wrong number into a settlement row.

### Output handling

| Risk | Control |
|---|---|
| XSS | React escapes by default; `dangerouslySetInnerHTML` is banned by ESLint with no exceptions in v1 |
| CSP | `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'` |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Referrer leakage | `Referrer-Policy: strict-origin-when-cross-origin` |
| HSTS | `max-age=31536000; includeSubDomains; preload` |
| CSV injection in exports | Cells beginning `= + - @ TAB CR` are prefixed with `'` |

CSV injection deserves the mention. Exports land in Excel on a finance machine, and a merchant-controlled field containing `=cmd|...` is a real path from a marketplace seller to a finance workstation.

### SQL injection

Parameterised queries only, via Drizzle. Raw SQL is permitted for a small set of reviewed analytical queries and must use `sql` template binding — string concatenation into a query fails the lint rule and the review.

### Dependency and supply chain

| Control | Tool |
|---|---|
| Vulnerability scanning | `pnpm audit` + Dependabot, CI-blocking on high/critical |
| Lockfile integrity | `pnpm install --frozen-lockfile` in CI |
| SAST | CodeQL on every PR |
| Container scanning | Trivy on every image build |
| SBOM | Generated per release |
| Next.js advisories | Subscribed. The 16.x line has had a heavy advisory cadence; patch releases are treated as security releases, not optional upgrades |

---

## 8. Data Protection

### Classification

| Class | Examples | Handling |
|---|---|---|
| **Restricted** | API keys, signing secrets, session keys | Secret manager only; never logged; never in the DB |
| **Confidential** | Transaction amounts, payouts, merchant financials, customer emails | Encrypted at rest and in transit; RLS-scoped; access audited |
| **Internal** | Rule definitions, run metadata, queue metrics | Standard controls |
| **Public** | Marketing surfaces | None |

### Encryption

- **In transit:** TLS 1.3, HSTS preloaded. Internal service traffic over a private network; mTLS in v1.1.
- **At rest:** Volume encryption on the database and object store. Field-level encryption is deliberately *not* used for amounts — it would break the indexes and aggregations the product depends on, and offers little against a threat model where volume encryption already applies.

### PII inventory and minimisation

| Field | Purpose | Retention |
|---|---|---|
| `customer_email` | Heuristic matching only | Purgeable on request |
| `payment_method_last4`, brand | Human identification of a charge | With the charge record |
| User email, name | Authentication and attribution | Account lifetime |
| IP, user agent (audit) | Repudiation defence | 7 years |

MAGIC does not store customer names, addresses, or phone numbers even when Stripe returns them. If a field is not needed for matching or attribution, it is dropped at projection time rather than stored "just in case."

### GDPR posture

| Right | Mechanism |
|---|---|
| Access | Export of all records associated with a data subject |
| Erasure | Pseudonymise `customer_email` in projections and orders. Financial records are retained under the legal-obligation basis; the identifier is removed, the amounts stay |
| Rectification | Source of truth is Stripe; corrections flow from re-fetch |
| Portability | Standard export formats |

Erasure is a pseudonymisation, not a deletion, and that is defensible: a reconciliation ledger cannot delete a transaction without destroying the audit trail it exists to provide.

---

## 9. Audit Logging

Append-only, enforced at the grant level rather than by convention:

```sql
REVOKE UPDATE, DELETE ON audit_log FROM magic_app;
```

Logged: authentication events, all exception transitions, rule changes, member and role changes, connection changes, export generation and download, DLQ replays, tenant switches, and permission denials.

Not logged: request bodies containing secrets, full Stripe payloads (they live in `stripe_events`), or session tokens.

### Log hygiene

A redaction serialiser strips `authorization`, `stripe-signature`, `cookie`, `set-cookie`, `sk_*`, `whsec_*`, `rk_*`, and any field whose key matches `/secret|token|password|key/i`. Applied at the logger, not at call sites, so a new log statement cannot leak by omission.

---

## 10. Operational Security

| Control | Implementation |
|---|---|
| Least privilege | `magic_app` role holds `SELECT/INSERT/UPDATE` only; no `DROP`, no `CREATE`, no `DELETE` on append-only tables |
| Network segmentation | `ingest` in a public subnet; `api`, `worker`, DB, Redis private. Egress restricted to Stripe and the secret manager |
| Statement timeout | 30 s on the API pool, 5 min on the worker pool |
| Connection limits | Per-role caps prevent one runaway service exhausting the DB |
| Backups | Automated daily + PITR (RPO 5 min); restore drilled quarterly |
| Backup encryption | Separate key from the primary volume key |
| Incident response | Runbooks for: credential compromise, cross-tenant exposure, ingestion outage, DLQ backlog |

### Credential compromise runbook

```
1. Revoke the affected Stripe key in the Stripe dashboard (client action)
2. Mark the connection 'paused' — halts all fetch and sweep jobs
3. Rotate the webhook signing secret with overlap
4. Audit: every API call made with the compromised key, from the audit log
5. Re-enable, re-sweep from the last verified cursor
6. Run a completeness check across the full affected window
```

Step 6 matters. After any credential incident, the answer to "did we miss anything?" must be a measured number, not a reassurance.

---

## 11. Compliance Alignment

| Framework | Position |
|---|---|
| **PCI DSS** | Minimal scope — no PAN, no CVV, no cardholder data. Stripe is the CDE |
| **SOC 2 Type II** | Controls designed toward it: audit logging, access review, change management, encryption, incident response. Formal attestation pending client requirement (PRD Q5) |
| **GDPR** | Lawful basis: legitimate interest (reconciliation) and legal obligation (financial record retention). DPA required with the client |
| **Data residency** | Single-region in v1. Multi-region requires per-tenant region pinning — architecturally possible, not built |

---

## 12. Security Testing

| Test | Frequency | Gate |
|---|---|---|
| Cross-tenant isolation (unfiltered query) | Every CI run | **Blocking** |
| Webhook signature rejection (bad sig, replay, tampered body) | Every CI run | **Blocking** |
| Permission matrix (every role × every endpoint) | Every CI run | **Blocking** |
| Scope enforcement (member acting outside `account_scope`) | Every CI run | **Blocking** |
| Secret leak scan (logs, responses, error bodies) | Every CI run | **Blocking** |
| Dependency audit | Every CI run | Blocking on high/critical |
| SAST (CodeQL) | Every PR | Blocking on high |
| Container scan | Every build | Blocking on critical |
| Penetration test | Annual + before a major release | Findings tracked to closure |

The first four are blocking on purpose. They encode the security claims the product makes, and a claim that isn't tested on every commit will eventually stop being true.
