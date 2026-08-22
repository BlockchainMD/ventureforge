# Land Alpha on Google Cloud

Cloud Run in front of Cloud SQL for PostgreSQL. One command to stand it up, one
to tear it down, and a tunnel script so a laptop or an agent container can drive
the hosted database directly.

The whole point is that state survives without anyone tending it: the parcels,
the evidence trail and the calibration history stay put between sessions instead
of being re-ingested from scratch every time.

## Cost

| Resource | Cost | Notes |
| --- | --- | --- |
| Cloud SQL — shared-core, zonal, 10 GB SSD | **~$10/month** | Bills continuously, used or not. This is the entire cost. |
| Cloud Run service | ~$0 | Scales to zero. Capped at 2 instances. |
| Cloud Run jobs | ~$0 | Bills only while a job runs. |
| Artifact Registry | cents | Two images. |
| Secret Manager | cents | Three secrets. |
| Cloud Build | ~$0 | Default pool; builds are minutes. |

**Verify current prices yourself before enabling billing.** These are estimates
from a moving price list, not a quote.

To stop paying without destroying data, stop the instance — storage still bills,
compute does not:

```bash
gcloud sql instances patch land-alpha-db --activation-policy=NEVER
gcloud sql instances patch land-alpha-db --activation-policy=ALWAYS   # resume
```

## Prerequisites

Yours to do — a script cannot create a billing relationship on your behalf:

1. A GCP project. `gcloud projects create land-alpha-prod` or the console.
2. Billing linked to it. Cloud SQL will not create without it.
3. `gcloud` installed and signed in: `gcloud auth login`.

Nothing else. The deploy script enables every API it needs.

## Deploy

```bash
PROJECT_ID=your-project ADMIN_EMAIL=you@example.com ./infra/gcp/deploy.sh
```

Roughly ten minutes on a cold project, most of it waiting for Cloud SQL. It
prints the service URL and a generated administrator password at the end. The
password is shown **once**; afterwards read it from Secret Manager:

```bash
gcloud secrets versions access latest --secret=land-alpha-admin-password
```

Re-running is safe and is the normal way to ship a change. It rebuilds, runs
migrations, and rolls out. Existing secrets are never overwritten by a re-run —
rotating a credential has to be a deliberate act, not a side effect of deploying.

### Useful overrides

| Variable | Default | |
| --- | --- | --- |
| `REGION` | `us-central1` | |
| `SQL_TIER` | `db-f1-micro` | `db-g1-small` if the pipeline is memory-starved |
| `MAX_INSTANCES` | `2` | The runaway-bill ceiling |
| `ADMIN_NAME` | `Administrator` | |

## Loading inventory

A fresh deployment has **no parcels**, by design — inventory comes from
ingestion, which is the product. Load a county:

```bash
gcloud run jobs execute land-alpha-ingest --region=us-central1 --wait \
  --args='^|^-c|pnpm ingest fl-orange-lands-available && pnpm pipeline --state FL'
```

List every registered source key by running the job with its default args:

```bash
gcloud run jobs execute land-alpha-ingest --region=us-central1 --wait
```

The ingestion job runs with `ENRICHMENT_MODE=live`, so it calls the real FEMA,
USGS, USFWS and EPA services. The adapters honour `robots.txt`, the per-host
delay and the per-run request ceiling — that politeness is not optional and
should not be tuned away to make a run finish sooner.

`mn-st-louis-tax-forfeited` publishes over 14,000 parcels. Give it the full hour
the job allows, or pass `--limit`.

## Working against the hosted database

```bash
PROJECT_ID=your-project ./infra/gcp/connect.sh
```

Starts a Cloud SQL Auth Proxy on `127.0.0.1:5433` and writes `.env.cloud`. In
another shell:

```bash
set -a && . ./.env.cloud && set +a
pnpm pipeline --state FL
psql "$DATABASE_URL"
```

Port 5433 rather than 5432 on purpose: a local `docker compose up` usually holds
5432, and a proxy that quietly loses that race leaves you querying the wrong
database while everything looks fine.

The instance has a public IP with **no authorised networks**, so nothing on the
internet can open a socket to it. Access is IAM-based through the proxy, which
is why there is no firewall rule to maintain and why a lost laptop does not
expose the database. The proxy needs application-default credentials:

```bash
gcloud auth application-default login
```

## What is deliberately switched off

**No demo users.** `pnpm db:seed` creates `admin@landalpha.local` with the
password `landalpha-dev`, which is a literal in this repository. That is correct
for a local database and catastrophic on a public URL. The deployment runs
`pnpm bootstrap:admin` instead: one administrator, password from Secret Manager.
The bootstrap also **fails the deploy** if it finds any account still carrying
the development password.

**The public listing site is off.** `/properties` serves without a login, so
`PUBLIC_SITE_ENABLED=false` until you decide otherwise:

```bash
gcloud run services update land-alpha --region=us-central1 \
  --update-env-vars=PUBLIC_SITE_ENABLED=true
```

Everything else behind `/login` is gated by the app's own session auth. Cloud Run
itself allows unauthenticated ingress because that is what makes the URL work
from a phone.

**No AI provider.** `AI_PROVIDER` defaults to `fixture`, so investment memos are
generated deterministically and no key is needed. To use a real model, put the
key in Secret Manager and reference it — never in an environment variable
literal, and never in the repository:

```bash
printf '%s' "$ANTHROPIC_API_KEY" | gcloud secrets create land-alpha-anthropic-key --data-file=-
gcloud secrets add-iam-policy-binding land-alpha-anthropic-key \
  --member=serviceAccount:land-alpha-run@PROJECT.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
gcloud run services update land-alpha --region=us-central1 \
  --update-secrets=ANTHROPIC_API_KEY=land-alpha-anthropic-key:latest \
  --update-env-vars=AI_PROVIDER=anthropic
```

## Teardown

```bash
PROJECT_ID=your-project ./infra/gcp/teardown.sh
```

Requires typing the project id to confirm, then deletes every billable resource
including the database and all its data. Export first if any of it matters:

```bash
gcloud sql export sql land-alpha-db gs://your-bucket/final.sql.gz --database=landalpha
```

Pass `KEEP_SECRETS=1` to leave Secret Manager alone.

## How the pieces fit

```
Cloud Build ──> Artifact Registry ──┬─> web  image ──> Cloud Run service ──┐
                                    │                                      │
                                    └─> jobs image ──> Cloud Run jobs ─────┤
                                                       (migrate, ingest)   │
                                                                           v
                                        Secret Manager ────────>  Cloud SQL (PostGIS)
                                     (DATABASE_URL, AUTH_SECRET,   unix socket via the
                                      ADMIN_PASSWORD)              Cloud SQL connector
```

Two images from one `Dockerfile`. `web` is the `runtime` stage — the standalone
server and nothing else. `jobs` is the `build` stage, which keeps the full
workspace because the Prisma CLI and `tsx` need it.

Migrations run as a **job**, once per release. Running them from the serving
image would run them once per instance that happens to start, which is a
different and much worse thing.

## Troubleshooting

**`Cloud SQL instance does not exist`, right after creating it.** Creation
returns before the instance is fully ready. Wait and re-run; the script is
idempotent.

**The migrate job fails on `CREATE EXTENSION postgis`.** The first migration
enables PostGIS. Cloud SQL supports it, but the database user needs
`cloudsqlsuperuser`, which the user created here has. If you supplied your own
`DB_USER`, check its grants.

**The build runs out of memory.** The Next build is the heavy step. Raise the
Cloud Build machine type in `cloudbuild.yaml` — note that leaves the free
build-minute pool.

**`NEXT_PUBLIC_SITE_URL` looks wrong in the client bundle.** `NEXT_PUBLIC_*`
values are inlined at build time. The deploy sets it after the first rollout, so
server-rendered canonical URLs and the sitemap are correct, but anything read
from the browser bundle carries the build-time default until the next build.
