# Deploying MAGIC to Render

`render.yaml` at the repository root describes the deployment. This file covers what a blueprint
cannot express: the one value that must be set by hand, and the consequences of running the fleet
as a single service.

The result is one paid web service plus Key Value and Postgres. It runs on seeded demo data with
no Stripe credentials.

## The shape

One container runs all four processes. `infra/start-all.mjs` starts the console, the API, the
webhook endpoint and the worker, and takes the container down if any of them stops — a
reconciliation product that looks healthy while nothing reconciles is worse than one that is
plainly down.

Only the console is bound to a public interface. The API, the webhook endpoint and the worker's
metrics server listen on loopback, which keeps them unreachable from outside and stops Render's
port discovery from routing the public URL to the wrong one.

```
Render :10000 ──> console
        loopback ──> api :4000 · ingest :4001 · worker metrics :4002
```

This is a proof-of-concept shape, not the architecture. The four are separate deployables because
a webhook flood must not stall the console and a worker must not compete with request handling.
None of that stops being true here; it is simply not being paid for yet. Splitting them back out
is a change to `render.yaml` — one service block each, same image, different `dockerCommand` —
with no application code change.

## Before the first deploy

Render builds from a Git branch, so the tree has to be pushed. Nothing deploys from a working
copy.

## First deploy

1. **Create the blueprint.** Point Render at the repository; it reads `render.yaml`.

2. **Expect the first deploy to fail, and let it.** The pre-deploy step runs migrations, which
   need only the owner connection string, so the schema and the `magic_app` role are created. The
   service then fails to start because `DATABASE_URL` is not set yet — it cannot be, because the
   role it names did not exist until a moment ago.

3. **Compose the application connection string.** Copy `DATABASE_URL_OWNER`, reveal the generated
   `MAGIC_APP_PASSWORD`, and build:

   ```
   postgresql://magic_app:<MAGIC_APP_PASSWORD>@<host>/<database>
   ```

   keeping the host and database from the owner string and replacing only user and password. Set
   it as `DATABASE_URL` on the service.

4. **Redeploy.** All four processes should come up; `[fleet] started ...` appears in the logs.

5. **Seed the demo tenant.** From the service shell:

   ```
   node packages/fixtures/dist/cli/seed.js
   ```

   It reads `DATABASE_URL_OWNER`, which the service already has. Sign in as
   `admin@northwind.test` with `magic-dev-password`, and change that password.

   Never run `packages/db/dist/cli/reset.js` — it drops the schema. It refuses when
   `NODE_ENV=production`, which is set here, but the safest thing is not to type it.

## Why the database has three roles

`magic_owner` owns the schema and is used by exactly one thing: the pre-deploy migration step. It
is never given to a running process.

`magic_app` is what the services connect as. It owns nothing, so row-level security applies to it
without exception, and the append-only grants on `audit_log`, `exception_events` and
`stripe_events` are real rather than advisory. Using the owner string instead would leave tenant
isolation resting on `FORCE ROW LEVEL SECURITY` alone and quietly discard the rest.

`magic_definer` owns the seven `SECURITY DEFINER` functions that resolve a tenant before one is
known — sign-in, the webhook path key, the outbox relay, the sweep scheduler. It cannot log in, so
no connection string can ever authenticate as it. It exists because those functions otherwise
return nothing at all on managed Postgres: the tables carry `FORCE ROW LEVEL SECURITY`, which
applies to their owner too, and Render's database user is not a superuser. The failure is silent —
empty results, no error — presenting as "nobody can sign in and every webhook 404s". Migration
`0012` is the fix; `packages/db/src/rls.test.ts` is what keeps it honest.

## What this shape costs

**The webhook endpoint is not reachable from Stripe.** Only the console is public. That is
survivable while `STRIPE_ENABLED=false` and the data is seeded, and it is the first thing to fix
when it is not — either by giving `ingest` its own service, or by putting a path router on the
public port that streams `/wh/stripe/*` to loopback with the body untouched, since signature
verification is over the raw bytes.

**Any process exiting restarts all of them.** Deliberate. The alternative hides a crash-looping
worker behind a console that still serves.

**It cannot scale past one instance.** Exports rely on the worker and the console sharing a
filesystem, and a second instance would break that — and the outbox relay, while correct across
instances, is not what makes this single-instance.

**Generated exports are ephemeral.** There is no disk, so a file does not survive a restart. The
download window is fifteen minutes, so this rarely shows, but it is why `EXPORT_BUCKET` still
wants an object store. See `PRODUCTION_GAPS.md`.

**Stripe is off.** Turning it on needs restricted read-only keys, a webhook signing secret, and a
publicly reachable ingest endpoint — the first item above.
