#!/usr/bin/env bash
#
# Remove everything deploy.sh created, and stop the bill.
#
#   PROJECT_ID=my-project ./infra/gcp/teardown.sh
#
# The Cloud SQL instance is the only resource here that costs real money, and it
# costs it continuously. Everything else is cents or scales to zero. If you want
# to stop paying without losing the data, don't run this — read "Pausing" below.
#
# Pausing instead of destroying:
#
#   gcloud sql instances patch land-alpha-db --activation-policy=NEVER
#
# A stopped instance bills for its storage only (roughly a fifth of the cost)
# and starts again with `--activation-policy=ALWAYS`. That is almost always what
# you actually want. This script is for when you are finished.
#
# Deletion is irreversible: the parcels, the evidence trail, the scoring
# snapshots and every calibration outcome go with it. Take a final export first
# if any of it matters:
#
#   gcloud sql export sql land-alpha-db gs://<bucket>/land-alpha-final.sql.gz --database=landalpha

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
SQL_INSTANCE="${SQL_INSTANCE:-land-alpha-db}"
SERVICE="${SERVICE:-land-alpha}"
JOB_MIGRATE="${JOB_MIGRATE:-land-alpha-migrate}"
JOB_INGEST="${JOB_INGEST:-land-alpha-ingest}"
REPO="${REPO:-land-alpha}"
RUNTIME_SA="${RUNTIME_SA:-land-alpha-run}"
KEEP_SECRETS="${KEEP_SECRETS:-0}"

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
gone() { printf '  \033[90m· %s (not present)\033[0m\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

exists() { gcloud "$@" --project="$PROJECT_ID" >/dev/null 2>&1; }

[ -n "$PROJECT_ID" ] || die 'PROJECT_ID is required.'
command -v gcloud >/dev/null 2>&1 || die 'gcloud is not installed.'
gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 \
  || die "Cannot see project '$PROJECT_ID'."

# One typed confirmation. Everything below this line destroys data, and a
# y/N prompt is too easy to answer by reflex.
cat <<EOF

  This permanently deletes, in project ${PROJECT_ID}:

    Cloud SQL instance   ${SQL_INSTANCE}   — including all parcel data
    Cloud Run service    ${SERVICE}
    Cloud Run jobs       ${JOB_MIGRATE}, ${JOB_INGEST}
    Artifact Registry    ${REPO}           — including all images
    Service account      ${RUNTIME_SA}
$( [ "$KEEP_SECRETS" = '1' ] && echo '    Secrets              kept (KEEP_SECRETS=1)' \
                             || echo '    Secrets              land-alpha-database-url, -auth-secret, -admin-password' )

  To stop billing without losing data, cancel and run instead:
    gcloud sql instances patch ${SQL_INSTANCE} --activation-policy=NEVER --project=${PROJECT_ID}

EOF
printf '  Type the project id to confirm: '
read -r CONFIRM
[ "$CONFIRM" = "$PROJECT_ID" ] || die 'Cancelled.'

# Compute before storage: nothing should be mid-write when the database goes.
say 'Cloud Run'
if exists run services describe "$SERVICE" --region="$REGION"; then
  gcloud run services delete "$SERVICE" --region="$REGION" --project="$PROJECT_ID" --quiet
  info "deleted service     $SERVICE"
else
  gone "service $SERVICE"
fi

for job in "$JOB_MIGRATE" "$JOB_INGEST"; do
  if exists run jobs describe "$job" --region="$REGION"; then
    gcloud run jobs delete "$job" --region="$REGION" --project="$PROJECT_ID" --quiet
    info "deleted job         $job"
  else
    gone "job $job"
  fi
done

say 'Cloud SQL'
if exists sql instances describe "$SQL_INSTANCE"; then
  # deploy.sh sets deletion protection deliberately. Clearing it here is the
  # explicit act that makes deletion possible; without this the delete below
  # fails with a message that reads like a permissions problem.
  gcloud sql instances patch "$SQL_INSTANCE" --no-deletion-protection \
    --project="$PROJECT_ID" --quiet >/dev/null
  gcloud sql instances delete "$SQL_INSTANCE" --project="$PROJECT_ID" --quiet
  info "deleted instance    $SQL_INSTANCE"
else
  gone "instance $SQL_INSTANCE"
fi

say 'Artifact Registry'
if exists artifacts repositories describe "$REPO" --location="$REGION"; then
  gcloud artifacts repositories delete "$REPO" --location="$REGION" \
    --project="$PROJECT_ID" --quiet
  info "deleted repository  $REPO"
else
  gone "repository $REPO"
fi

say 'Secrets'
if [ "$KEEP_SECRETS" = '1' ]; then
  info 'kept (KEEP_SECRETS=1)'
else
  for secret in land-alpha-database-url land-alpha-auth-secret land-alpha-admin-password; do
    if exists secrets describe "$secret"; then
      gcloud secrets delete "$secret" --project="$PROJECT_ID" --quiet
      info "deleted secret      $secret"
    else
      gone "secret $secret"
    fi
  done
fi

say 'Service account'
SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
if exists iam service-accounts describe "$SA_EMAIL"; then
  gcloud iam service-accounts delete "$SA_EMAIL" --project="$PROJECT_ID" --quiet
  info "deleted account     $SA_EMAIL"
else
  gone "account $SA_EMAIL"
fi

cat <<EOF

  Done. Nothing in this project is billing for Land Alpha.

  Cloud Build keeps its build history and logs, which cost nothing. If the
  project exists only for this, deleting the project is the clean finish:
    gcloud projects delete ${PROJECT_ID}

EOF
