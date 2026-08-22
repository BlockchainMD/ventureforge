#!/usr/bin/env bash
#
# Land Alpha on Google Cloud: Cloud Run in front of Cloud SQL for PostgreSQL.
#
#   PROJECT_ID=my-project ADMIN_EMAIL=me@example.com ./infra/gcp/deploy.sh
#
# Every step is idempotent. Re-running after a code change rebuilds and rolls
# out; re-running with nothing changed is close to a no-op. That matters more
# than it sounds: a deploy script you are afraid to re-run is one you will patch
# around by hand, and then the script stops describing the deployment.
#
# What this creates, and what it costs (verify current prices yourself — this
# is a standing monthly charge, not a free tier):
#
#   Cloud SQL, shared-core, zonal, 10GB SSD   ~$10/month, billed while it exists
#   Cloud Run service, scales to zero         ~$0 at this traffic
#   Artifact Registry, two images             cents
#   Secret Manager, three secrets             cents
#
# The Cloud SQL instance is the entire cost and it bills whether or not anyone
# uses it. `./infra/gcp/teardown.sh` removes everything.
#
# Deliberately NOT done here:
#   - No demo users. `pnpm db:seed` publishes its passwords in this repository;
#     the bootstrap job creates one administrator from ADMIN_PASSWORD instead.
#   - No parcels. Inventory comes from ingestion.
#   - PUBLIC_SITE_ENABLED=false. The listing site at /properties needs no login,
#     so it stays off until you turn it on deliberately.

set -euo pipefail

# ---- configuration ----------------------------------------------------------
PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
SQL_INSTANCE="${SQL_INSTANCE:-land-alpha-db}"
SQL_TIER="${SQL_TIER:-db-f1-micro}"
DB_NAME="${DB_NAME:-landalpha}"
DB_USER="${DB_USER:-landalpha}"
SERVICE="${SERVICE:-land-alpha}"
JOB_MIGRATE="${JOB_MIGRATE:-land-alpha-migrate}"
JOB_INGEST="${JOB_INGEST:-land-alpha-ingest}"
REPO="${REPO:-land-alpha}"
RUNTIME_SA="${RUNTIME_SA:-land-alpha-run}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_NAME="${ADMIN_NAME:-Administrator}"
# Cap the fan-out. Cloud Run bills per instance; without a ceiling a crawler or
# a loop can turn "scales to zero" into a bill worth arguing about.
MAX_INSTANCES="${MAX_INSTANCES:-2}"

AR_HOST="${REGION}-docker.pkg.dev"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

# `gcloud ... describe` is the idempotence primitive here: it is the only
# reliable way to ask "does this already exist" without parsing an error string.
exists() { gcloud "$@" --project="$PROJECT_ID" >/dev/null 2>&1; }

# ---- preflight --------------------------------------------------------------
say 'Preflight'

command -v gcloud >/dev/null 2>&1 || die \
  'gcloud is not installed. https://cloud.google.com/sdk/docs/install'

[ -n "$PROJECT_ID" ] || die 'PROJECT_ID is required.
  Create a project first, then:  PROJECT_ID=your-project ADMIN_EMAIL=you@example.com ./infra/gcp/deploy.sh'

[ -n "$ADMIN_EMAIL" ] || die 'ADMIN_EMAIL is required — it becomes the administrator login.'

ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
[ -n "$ACCOUNT" ] && [ "$ACCOUNT" != '(unset)' ] || die \
  'Not signed in. Run: gcloud auth login'
info "account             $ACCOUNT"

gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 || die \
  "Cannot see project '$PROJECT_ID'. Check the id, or that this account has access to it."
info "project             $PROJECT_ID"
info "region              $REGION"

# Billing is the failure that otherwise shows up four minutes later as an
# inscrutable API error, so it is worth one cheap check up front. Best-effort:
# the billing API is a separate permission and not everyone deploying has it.
if BILLING="$(gcloud beta billing projects describe "$PROJECT_ID" \
     --format='value(billingEnabled)' 2>/dev/null)"; then
  [ "$BILLING" = 'True' ] || die \
    "Billing is not enabled on '$PROJECT_ID'. Cloud SQL cannot be created without it.
  https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
  info 'billing             enabled'
else
  warn 'Could not verify billing (needs the billing API and permission). Continuing.'
fi

# ADMIN_PASSWORD is generated once and kept in Secret Manager. Generating it
# here rather than asking for one means the password is never in a shell
# history, and re-running the deploy does not silently rotate it.
ADMIN_SECRET='land-alpha-admin-password'
DB_SECRET='land-alpha-database-url'
AUTH_SECRET_NAME='land-alpha-auth-secret'

# ---- APIs -------------------------------------------------------------------
say 'Enabling APIs'
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project="$PROJECT_ID"
info 'run, sqladmin, secretmanager, artifactregistry, cloudbuild'

# ---- artifact registry ------------------------------------------------------
say 'Artifact Registry'
if exists artifacts repositories describe "$REPO" --location="$REGION"; then
  info "repository          $REPO (exists)"
else
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker --location="$REGION" \
    --description='Land Alpha container images' --project="$PROJECT_ID"
  info "repository          $REPO (created)"
fi

# ---- secrets ----------------------------------------------------------------
# Created empty here; values are written once, below, only if absent. A secret
# that already has a version is never overwritten by a re-run — rotating a
# credential must be a deliberate act, not a side effect of deploying.
ensure_secret() {
  local name="$1"
  if ! exists secrets describe "$name"; then
    gcloud secrets create "$name" --replication-policy=automatic --project="$PROJECT_ID" >/dev/null
  fi
}

has_version() {
  [ -n "$(gcloud secrets versions list "$1" --project="$PROJECT_ID" \
      --filter='state:ENABLED' --format='value(name)' --limit=1 2>/dev/null)" ]
}

add_version() {
  printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- --project="$PROJECT_ID" >/dev/null
}

# URL-safe alphabet only. The password ends up inside a DSN, and a `/` or `@`
# in it produces a connection string that parses as something else entirely.
random_token() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-40}"
}

say 'Secrets'
ensure_secret "$ADMIN_SECRET"
ensure_secret "$DB_SECRET"
ensure_secret "$AUTH_SECRET_NAME"

if has_version "$AUTH_SECRET_NAME"; then
  info "$AUTH_SECRET_NAME  (exists, kept)"
else
  add_version "$AUTH_SECRET_NAME" "$(random_token 48)"
  info "$AUTH_SECRET_NAME  (generated)"
fi

NEW_ADMIN_PASSWORD=''
if has_version "$ADMIN_SECRET"; then
  info "$ADMIN_SECRET (exists, kept)"
else
  NEW_ADMIN_PASSWORD="$(random_token 28)"
  add_version "$ADMIN_SECRET" "$NEW_ADMIN_PASSWORD"
  info "$ADMIN_SECRET (generated — printed at the end)"
fi

# ---- cloud sql --------------------------------------------------------------
say 'Cloud SQL'
if exists sql instances describe "$SQL_INSTANCE"; then
  info "instance            $SQL_INSTANCE (exists)"
else
  warn "Creating $SQL_INSTANCE. This takes several minutes and starts billing."
  gcloud sql instances create "$SQL_INSTANCE" \
    --project="$PROJECT_ID" \
    --database-version=POSTGRES_16 \
    --edition=enterprise \
    --tier="$SQL_TIER" \
    --region="$REGION" \
    --storage-size=10GB \
    --storage-type=SSD \
    --storage-auto-increase \
    --availability-type=zonal \
    --backup-start-time=07:00 \
    --retained-backups-count=7 \
    --maintenance-window-day=SUN \
    --maintenance-window-hour=8 \
    --deletion-protection
  info "instance            $SQL_INSTANCE (created)"
fi

CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" \
  --project="$PROJECT_ID" --format='value(connectionName)')"
info "connection          $CONNECTION_NAME"

# The instance keeps a public IP with no authorised networks: nothing can reach
# it directly, and the Cloud SQL connector authenticates over IAM rather than by
# source address. Refusing unencrypted connections on top of that is applied
# best-effort, because the flag spelling has changed across gcloud releases and
# a rename must not fail a deploy.
gcloud sql instances patch "$SQL_INSTANCE" --project="$PROJECT_ID" \
  --ssl-mode=ENCRYPTED_ONLY --quiet >/dev/null 2>&1 \
  || warn 'Could not set --ssl-mode=ENCRYPTED_ONLY (older gcloud?). Connections still use the IAM connector.'

if exists sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE"; then
  info "database            $DB_NAME (exists)"
else
  gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE" --project="$PROJECT_ID"
  info "database            $DB_NAME (created)"
fi

# The database user's password lives only inside the DATABASE_URL secret. If
# that secret has a version we must not rotate the user, or the stored URL stops
# matching the account it describes.
if has_version "$DB_SECRET"; then
  info "user                $DB_USER (exists, password kept)"
else
  DB_PASSWORD="$(random_token 40)"
  if exists sql users describe "$DB_USER" --instance="$SQL_INSTANCE"; then
    gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" \
      --password="$DB_PASSWORD" --project="$PROJECT_ID" --quiet
    info "user                $DB_USER (password reset to match new secret)"
  else
    gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" \
      --password="$DB_PASSWORD" --project="$PROJECT_ID"
    info "user                $DB_USER (created)"
  fi
  # Cloud Run reaches Cloud SQL over a unix socket the connector mounts at
  # /cloudsql/<connection name>; `localhost` in the DSN is a placeholder the
  # driver ignores once `host=` names a socket directory.
  add_version "$DB_SECRET" \
    "postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CONNECTION_NAME}&schema=public"
  info "$DB_SECRET   (written)"
fi

# ---- service account --------------------------------------------------------
say 'Runtime service account'
SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
if exists iam service-accounts describe "$SA_EMAIL"; then
  info "account             $SA_EMAIL (exists)"
else
  gcloud iam service-accounts create "$RUNTIME_SA" \
    --display-name='Land Alpha runtime' --project="$PROJECT_ID"
  info "account             $SA_EMAIL (created)"
fi

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role='roles/cloudsql.client' \
  --condition=None --quiet >/dev/null
info 'granted             roles/cloudsql.client'

# Secret access is granted per secret rather than project-wide: this identity
# has no reason to read a secret nobody has told it about.
for secret in "$DB_SECRET" "$AUTH_SECRET_NAME" "$ADMIN_SECRET"; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${SA_EMAIL}" --role='roles/secretmanager.secretAccessor' \
    --project="$PROJECT_ID" --quiet >/dev/null
done
info 'granted             secretAccessor on 3 secrets'

# ---- build ------------------------------------------------------------------
say 'Build'
TAG="$(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo manual)"
info "tag                 $TAG"
( cd "$REPO_ROOT" && gcloud builds submit \
    --project="$PROJECT_ID" \
    --config=infra/gcp/cloudbuild.yaml \
    --substitutions="_AR_HOST=${AR_HOST},_REPO=${REPO},_TAG=${TAG}" \
    . )

WEB_IMAGE="${AR_HOST}/${PROJECT_ID}/${REPO}/web:${TAG}"
JOBS_IMAGE="${AR_HOST}/${PROJECT_ID}/${REPO}/jobs:${TAG}"

# ---- migrate + bootstrap ----------------------------------------------------
# One job, run to completion before the service rolls out. Migrations belong to
# a release, not to an instance start.
say 'Migrate and bootstrap'
JOB_ARGS=(
  --image="$JOBS_IMAGE"
  --region="$REGION"
  --project="$PROJECT_ID"
  --service-account="$SA_EMAIL"
  --set-cloudsql-instances="$CONNECTION_NAME"
  --set-secrets="DATABASE_URL=${DB_SECRET}:latest,ADMIN_PASSWORD=${ADMIN_SECRET}:latest"
  --set-env-vars="NODE_ENV=production,ADMIN_EMAIL=${ADMIN_EMAIL},ADMIN_NAME=${ADMIN_NAME}"
  --max-retries=0
  --task-timeout=900s
  --command=sh
  # `^|^` sets | as the list separator so the shell snippet can contain commas.
  --args='^|^-c|pnpm db:migrate && pnpm bootstrap:admin'
)
if exists run jobs describe "$JOB_MIGRATE" --region="$REGION"; then
  gcloud run jobs update "$JOB_MIGRATE" "${JOB_ARGS[@]}" --quiet >/dev/null
  info "job                 $JOB_MIGRATE (updated)"
else
  gcloud run jobs create "$JOB_MIGRATE" "${JOB_ARGS[@]}" --quiet >/dev/null
  info "job                 $JOB_MIGRATE (created)"
fi

info 'running migrations...'
gcloud run jobs execute "$JOB_MIGRATE" --region="$REGION" --project="$PROJECT_ID" --wait

# ---- ingestion job ----------------------------------------------------------
# Without this the deployment can only ever hold the parcels it was bootstrapped
# with, which is none. Args are overridden per execution because each run
# targets one source — see the runbook.
say 'Ingestion job'
INGEST_ARGS=(
  --image="$JOBS_IMAGE"
  --region="$REGION"
  --project="$PROJECT_ID"
  --service-account="$SA_EMAIL"
  --set-cloudsql-instances="$CONNECTION_NAME"
  --set-secrets="DATABASE_URL=${DB_SECRET}:latest"
  # Live enrichment is the whole reason to host this rather than run fixtures
  # locally. The adapters honour robots.txt, the per-host delay and the
  # per-run request ceiling, so "live" is polite by construction.
  --set-env-vars="NODE_ENV=production,ENRICHMENT_MODE=live,INGEST_OFFLINE=false"
  --max-retries=0
  # Long, because a full county refresh plus enrichment is measured in tens of
  # minutes and a timeout mid-run leaves a half-enriched dataset.
  --task-timeout=3600s
  --memory=2Gi
  --command=sh
  --args='^|^-c|pnpm ingest'
)
if exists run jobs describe "$JOB_INGEST" --region="$REGION"; then
  gcloud run jobs update "$JOB_INGEST" "${INGEST_ARGS[@]}" --quiet >/dev/null
  info "job                 $JOB_INGEST (updated)"
else
  gcloud run jobs create "$JOB_INGEST" "${INGEST_ARGS[@]}" --quiet >/dev/null
  info "job                 $JOB_INGEST (created)"
fi

# ---- service ----------------------------------------------------------------
say 'Cloud Run service'
gcloud run deploy "$SERVICE" \
  --image="$WEB_IMAGE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --service-account="$SA_EMAIL" \
  --add-cloudsql-instances="$CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=${DB_SECRET}:latest,AUTH_SECRET=${AUTH_SECRET_NAME}:latest" \
  --set-env-vars="NODE_ENV=production,PUBLIC_SITE_ENABLED=false" \
  --min-instances=0 \
  --max-instances="$MAX_INSTANCES" \
  --cpu=1 \
  --memory=1Gi \
  --timeout=120s \
  --allow-unauthenticated \
  --quiet >/dev/null

URL="$(gcloud run services describe "$SERVICE" --region="$REGION" \
  --project="$PROJECT_ID" --format='value(status.url)')"

# The canonical origin is only knowable after the first deploy, so it is set on
# a second pass. Server-rendered URLs (sitemap, canonical tags) pick this up;
# anything inlined into the client bundle was fixed at build time.
gcloud run services update "$SERVICE" --region="$REGION" --project="$PROJECT_ID" \
  --update-env-vars="NEXT_PUBLIC_SITE_URL=${URL}" --quiet >/dev/null

# ---- done -------------------------------------------------------------------
say 'Deployed'
info "url                 $URL"
info "sign in as          $ADMIN_EMAIL"
if [ -n "$NEW_ADMIN_PASSWORD" ]; then
  printf '\n  \033[1mAdministrator password (shown once):\033[0m %s\n' "$NEW_ADMIN_PASSWORD"
  printf '  Stored at: Secret Manager / %s\n' "$ADMIN_SECRET"
else
  printf '\n  Password unchanged. Read it with:\n'
  printf '    gcloud secrets versions access latest --secret=%s --project=%s\n' "$ADMIN_SECRET" "$PROJECT_ID"
fi
cat <<EOF

  The database is empty of parcels — that is expected. Load a county with:
    gcloud run jobs execute $JOB_INGEST --region=$REGION --project=$PROJECT_ID --wait \\
      --args='^|^-c|pnpm ingest fl-orange-lands-available && pnpm pipeline --state FL'

  Run it with no source key to list every registered source:
    gcloud run jobs execute $JOB_INGEST --region=$REGION --project=$PROJECT_ID --wait

  The public listing site (/properties, no login) is OFF. Enable deliberately:
    gcloud run services update $SERVICE --region=$REGION --project=$PROJECT_ID \\
      --update-env-vars=PUBLIC_SITE_ENABLED=true

  Cloud SQL bills continuously. To stop all charges:
    ./infra/gcp/teardown.sh

EOF
