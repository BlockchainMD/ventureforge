# 16. Hosting on Cloud Run and Cloud SQL, and never seeding a deployment

Date: 2026-08-22

## Status

Accepted.

## Context

Until now the product only ever ran on a developer's machine or inside an
ephemeral agent container. Both are reclaimed, and with them the database. Every
session therefore began by re-ingesting the same counties — St. Louis alone
publishes over 14,000 parcels — before any work could start.

That cost is not only time. The parts of the system that are supposed to improve
with age cannot: calibration compares predictions against realised outcomes, and
the change feed exists to notice price cuts and reappearances between runs. Both
are meaningless against a database that is hours old. A system whose memory is
erased nightly cannot learn, and learning is where the profit was supposed to
come from.

The request was for the cheapest thing that ends this.

## Decision

Cloud Run in front of Cloud SQL for PostgreSQL, provisioned by
`infra/gcp/deploy.sh`.

### Why not the genuinely free options

Three were considered.

**Neon's free tier** ($0, PostGIS, scales to zero) caps at roughly 0.5 GB. The
database is 134 MB across four counties, and `Evidence` — 62 MB of it — grows on
every pipeline run because retaining the evidence trail is the point. The
ceiling would arrive during ordinary use, and a storage migration under pressure
is a worse outcome than the bill.

**A GCE `e2-micro` under the Always Free tier** ($0, running PostGIS in Docker)
works, and was rejected for what it costs elsewhere: backups, patching and
uptime become a person's job. The entire reason for hosting is that state
survives without anyone tending it. An arrangement that requires tending defeats
it. Its 1 GB egress allowance is also a poor fit for a workload whose whole
pattern is agents pulling result sets out of the database.

**Keeping the status quo** was rejected on the reasoning above.

### Why Cloud SQL specifically

Roughly $10/month buys automated backups, point-in-time recovery, patching and
an instance nobody has to think about. That is the product being purchased —
not CPU, which is nearly free, but the absence of an operational obligation.

The cost is a standing charge that bills whether or not anyone uses it, so
`teardown.sh` exists and is documented next to the deploy, and the runbook leads
with `--activation-policy=NEVER` as the way to stop paying without losing data.
A resource that can only be created is a trap.

### Shape

- **Two images from one Dockerfile.** `web` is the `runtime` stage; `jobs` is the
  `build` stage, which keeps the whole workspace because the Prisma CLI and
  `tsx` need it.
- **Migrations run as a Cloud Run Job**, once per release. Running them from the
  serving image runs them once per instance that happens to start.
- **The instance keeps a public IP with no authorised networks.** Access is IAM
  through the Cloud SQL connector, so there is no firewall list to maintain and
  a stolen laptop grants nothing.
- **`--max-instances=2`.** "Scales to zero" describes the floor. Without a
  ceiling, a crawler turns it into a bill worth arguing about.

## A deployment is not a seeded database

`pnpm db:seed` creates three accounts whose password is `landalpha-dev` — a
literal in this repository, which anyone can read. One of them is an `ADMIN`.

That is correct for a local database and indefensible on a public URL. The
temptation was real: the seed already exists, it has a `--minimal` flag that
skips fixture parcels, and it has an `ALLOW_PRODUCTION_SEED` escape hatch. Using
it would have published an administrator account with a known password.

So the deployment does not seed. `scripts/bootstrap-admin.ts` provisions exactly
what a real deployment needs and nothing more:

- one administrator, password generated into Secret Manager and shown once,
- an active scoring config, without which nothing can be ranked,
- the source registry, without which there is nothing to ingest from.

No parcels. Inventory comes from ingestion.

The bootstrap also **refuses to complete** if any account in the database still
verifies against `landalpha-dev`. It refuses rather than deleting: removing a
user cascades into their saved searches, watchlists and deal-room membership,
and the script cannot tell a leftover demo login from something an operator
made. Refusing is recoverable. Guessing is not.

This is the same principle as ADR 0013 — an unknown must not resolve favourably
— applied to credentials instead of valuations. A deployment that *might* have a
public admin password is treated as one that does.

## The public listing site ships disabled

`/properties` renders without a login. On a laptop that is a convenience; on an
internet-reachable URL it is a publishing decision, and it is not one a deploy
script gets to make. `PUBLIC_SITE_ENABLED=false` is set explicitly, and the
runbook gives the one command that turns it on.

Cloud Run ingress is unauthenticated, because a URL that needs a `gcloud` token
is not a URL you can open on a phone. Everything except the listing routes is
gated by the application's own session auth.

## The switch did not work when it was first written

`PUBLIC_SITE_ENABLED=false` was set in the deploy script from the beginning, and
for the whole of that time it did nothing. `z.coerce.boolean()` is
`Boolean(value)`, so the string `'false'` parsed as `true` and the listing site
would have been public on the deployed URL despite the flag that says otherwise.
`INGEST_OFFLINE=false` on the ingestion job had the same defect in the opposite
direction: it read as `true`, so the job would have served fixtures and never
fetched a single real parcel.

Neither was visible in review. The deploy script says `false`, the schema says
`.default(true)`, and the two lines look like a working control. It surfaced
only from curling `/properties` in the built image and getting `200`.

Fixed in `packages/shared/src/env.ts`, with the rule that an uninterpretable
value is a configuration error rather than a default — see ADR 0013. The wider
consequence is a verification standard: a safety switch is verified by
exercising it in both positions against the real artefact, not by reading the
code that implements it.

## Consequences

- A standing ~$10/month charge exists and must be remembered. Teardown and pause
  are documented at the top of the runbook, not in a footnote.
- Calibration and the change feed become meaningful for the first time, because
  there is now a database old enough to have a history.
- `infra/gcp/connect.sh` lets an agent container drive the hosted database over
  an IAM-authenticated tunnel, which is what makes cloud-only development work.
- `.env.cloud` holds a live database password. `.gitignore` gained a `.env.*`
  rule, keeping `.env.example`, so it cannot be committed by accident.
- `NEXT_PUBLIC_SITE_URL` is inlined at build time but only knowable after the
  first deploy. Server-rendered canonical URLs are correct; the browser bundle
  carries the build-time default until the next build. Noted rather than solved,
  because solving it means a second build purely to bake in a constant.
