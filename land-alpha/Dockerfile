# Land Alpha — the analyst terminal, as a container.
#
# Multi-stage so the runtime image carries the built server and nothing else:
# no pnpm store, no TypeScript, no dev dependencies. The same image runs
# locally under docker compose and on any container host.

# ---- deps -------------------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable

# Copy only what pnpm needs to resolve the workspace, so a source-only change
# does not invalidate the install layer.
COPY infra/npmrc.docker .npmrc
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/ packages/

# Optional: build behind a TLS-inspecting proxy. Pass the proxy's CA with
#   docker build --secret id=ca_bundle,src=/path/to/ca.crt ...
# and it is trusted for this layer only — never copied into any image. Without
# the secret this is an ordinary install.
RUN --mount=type=secret,id=ca_bundle \
    if [ -s /run/secrets/ca_bundle ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle; \
    fi; \
    pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
# Prisma's query engine links against OpenSSL and warns (then guesses) without
# it. This stage also runs migrations and the seed for the local stack.
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

# The whole installed tree, not just the root: pnpm puts a node_modules in every
# workspace package, and picking two of them leaves the rest unresolvable.
# Source is copied on top afterwards — .dockerignore keeps node_modules out of
# the build context, so the installed modules survive the overlay.
COPY --from=deps /app /app
COPY . .

# Prisma generates into node_modules, so it has to run before the Next build.
RUN pnpm db:generate

# next build reads the environment. Nothing here is a secret and nothing is
# baked into the image: DATABASE_URL is supplied at run time and this value
# exists only so module-level env validation passes during the build.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV NODE_ENV=production
# AUTH_SECRET is set for this command only, not as a stage ENV. Env validation
# requires a session secret in production and runs at module load, so the build
# needs one present to collect page data; it never reaches the runtime image,
# which takes the real value from its environment.
RUN AUTH_SECRET="build-time-placeholder-not-used-at-runtime-0000" \
    pnpm --filter @land-alpha/web build

# ---- runtime ----------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The standalone trace, plus the static assets it deliberately omits. There is
# no public/ directory in this app; add a COPY for it if one is ever added.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

# Schema migrations are deliberately not run from here. This image carries the
# server and nothing else, and lifting the Prisma CLI out of a pnpm store into
# it leaves the CLI without its own dependencies. Migrations run as a separate
# step from the `build` stage image, which has the whole workspace:
#
#   docker compose --profile app up          runs it as the `seed` service
#   docker run --rm -e DATABASE_URL=... land-alpha-seed pnpm db:migrate
#
# Running them as their own job is also what a container host wants: one
# migration per release, not one per instance that happens to start.

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
