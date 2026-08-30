# Deploying MAGIC to Railway

Railway builds one service per `railway.json`, so the four deployables are four Railway services
pointing at the same repository and the same `infra/Dockerfile`. They differ only in start
command and environment, which is the same arrangement the Docker Compose file describes.

## Services

| Service | Start command | Public | Notes |
|---|---|---|---|
| `web` | `node apps/web/server.js` | yes | The console. Set `PORT` from Railway's injected variable. |
| `ingest` | `node apps/ingest/dist/main.js` | yes | The Stripe webhook endpoint. Give it its own domain. |
| `api` | `node apps/api/dist/main.js` | **no** | Private. Reachable only on the internal network. |
| `worker-ingest` | `node apps/worker/dist/main.js` | no | `WORKER_ROLE=ingest` |
| `worker-recon` | `node apps/worker/dist/main.js` | no | `WORKER_ROLE=recon` |
| `worker-ops` | `node apps/worker/dist/main.js` | no | `WORKER_ROLE=ops` |

Add Railway's Postgres 17 and Redis 7 plugins. Run migrations once from any service shell with
`node packages/db/dist/cli/migrate.js`, using the owner connection string.

## Variables

Shared by every service:

```
DATABASE_URL         ${{Postgres.DATABASE_URL}}
REDIS_URL            ${{Redis.REDIS_URL}}
SERVICE_TOKEN        a 32+ character random string, identical on web and api
SESSION_SECRET       a 64 character random hex string, web only
SECRETS_PROVIDER     env
STRIPE_API_VERSION   2026-06-30
```

`api` additionally needs nothing public: leave its networking private and point the console at it
with `API_INTERNAL_URL=http://api.railway.internal:4000`.

## The one thing to get right

`api` must not be exposed. It trusts the tenant, role and account scope on its request headers,
because the only thing that can set them is the console's server side, which reads them from a
server-held session. Give `api` a public domain and those headers become client-supplied, which
turns a header edit into a tenant switch. Row-level security would still contain the blast radius
to whatever tenant was named, but the application-layer checks above it would be gone.
