# MAGIC — one image, four entrypoints.
#
# The four deployables share a monorepo and almost all of their dependencies, so they share a
# build. Which one runs is decided by the command, not by a separate image, which keeps their
# dependency trees provably identical and halves the surface a vulnerability scan has to cover.

FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# ── dependencies ────────────────────────────────────────────────────────────
# Manifests are copied before sources so a code change does not invalidate the install layer.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/ingest/package.json ./apps/ingest/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/domain/package.json ./packages/domain/
COPY packages/db/package.json ./packages/db/
COPY packages/security/package.json ./packages/security/
COPY packages/stripe-client/package.json ./packages/stripe-client/
COPY packages/order-source/package.json ./packages/order-source/
COPY packages/recon/package.json ./packages/recon/
COPY packages/fixtures/package.json ./packages/fixtures/
RUN pnpm install --frozen-lockfile

# ── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm -r --filter './packages/*' build \
 && pnpm --filter @magic/api build \
 && pnpm --filter @magic/ingest build \
 && pnpm --filter @magic/worker build \
 && pnpm --filter @magic/web build

# ── runtime dependencies ────────────────────────────────────────────────────
# Production-only dependencies. Nothing in this image needs to write to its own filesystem
# beyond the export scratch directory.
FROM base AS service-deps
COPY --from=build /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json /app/.npmrc ./
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/ingest/package.json ./apps/ingest/
COPY --from=build /app/apps/worker/package.json ./apps/worker/
COPY --from=build /app/packages ./packages
RUN pnpm install --frozen-lockfile --prod --filter @magic/api --filter @magic/ingest --filter @magic/worker

# ── runtime ─────────────────────────────────────────────────────────────────
# One stage carrying every entrypoint, selected by the command rather than by a build target.
#
# This is not only the design the header describes, it is the only shape some platforms can
# build: Render's blueprints have no field for a Dockerfile target, so whatever stage happens to
# be last is what every service gets. Splitting the runtimes into two stages there would silently
# hand the API the console's image.
#
# Next's standalone output already carries the exact server dependencies it needs, so the web
# payload installs nothing of its own. The migration files and the fixture seeder come along
# because the deploy runs them from this same image.
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=service-deps /app/node_modules ./node_modules
COPY --from=service-deps /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/ingest/dist ./apps/ingest/dist
COPY --from=build /app/apps/ingest/node_modules ./apps/ingest/node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/packages/db/migrations ./packages/db/migrations

# The console lands in its own directory rather than merging into the root. Next traces a
# self-contained `node_modules` of real files, and unpacking that over pnpm's symlink farm would
# leave module resolution to the order of two COPY layers.
COPY --from=build /app/apps/web/.next/standalone ./web/
COPY --from=build /app/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=build /app/apps/web/public ./web/apps/web/public

# Runs all four at once, for deployments that pay for one service rather than four.
COPY infra/start-all.mjs ./infra/start-all.mjs

RUN addgroup -S magic && adduser -S magic -G magic \
 && mkdir -p /tmp/magic-exports && chown -R magic:magic /tmp/magic-exports /app
USER magic

EXPOSE 3000 4000 4001 4002
CMD ["node", "infra/start-all.mjs"]
