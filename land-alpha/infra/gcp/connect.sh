#!/usr/bin/env bash
#
# Reach the hosted database from a laptop, a CI runner or an agent container.
#
#   PROJECT_ID=my-project ./infra/gcp/connect.sh
#
# The Cloud SQL instance keeps a public IP with no authorised networks, so no
# address on the internet can open a socket to it. Access is by IAM instead: the
# Cloud SQL Auth Proxy proves who you are to the Admin API and then forwards an
# encrypted tunnel to a local port. That is why there is no firewall rule to
# add, and why losing this laptop does not expose the database.
#
# Leaves a proxy listening on 127.0.0.1:${LOCAL_PORT} until you stop it, and
# writes a ready-to-source .env.cloud alongside the repo.
#
#   ./infra/gcp/connect.sh                  start the tunnel, write .env.cloud
#   ./infra/gcp/connect.sh --print          also print DATABASE_URL to stdout
#
# Then, in another shell:
#   set -a && . ./.env.cloud && set +a
#   pnpm pipeline --state FL
#
# .env.cloud contains a live database password. It is written 0600, and
# .gitignore carries a `.env.*` rule so it cannot be committed by accident.
# Neither of those protects it from being read off the disk it sits on.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
SQL_INSTANCE="${SQL_INSTANCE:-land-alpha-db}"
DB_SECRET="${DB_SECRET:-land-alpha-database-url}"
LOCAL_PORT="${LOCAL_PORT:-5433}"
PROXY_VERSION="${PROXY_VERSION:-v2.14.1}"
PRINT_URL=0
[ "${1:-}" = '--print' ] && PRINT_URL=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.cloud"
BIN_DIR="${REPO_ROOT}/.cache/bin"
PROXY="${BIN_DIR}/cloud-sql-proxy"

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

[ -n "$PROJECT_ID" ] || die 'PROJECT_ID is required.'
command -v gcloud >/dev/null 2>&1 || die 'gcloud is not installed.'

# Default port is 5433, not 5432: a local `docker compose up` is very often
# already on 5432, and a proxy that silently loses the race leaves you querying
# the wrong database while everything appears to work.
say 'Cloud SQL Auth Proxy'
if [ ! -x "$PROXY" ]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)   ASSET='linux.amd64'  ;;
    Linux-aarch64)  ASSET='linux.arm64'  ;;
    Darwin-x86_64)  ASSET='darwin.amd64' ;;
    Darwin-arm64)   ASSET='darwin.arm64' ;;
    *) die "No proxy build for $(uname -s)-$(uname -m). See https://github.com/GoogleCloudPlatform/cloud-sql-proxy/releases" ;;
  esac
  mkdir -p "$BIN_DIR"
  info "downloading         ${PROXY_VERSION} ${ASSET}"
  curl -fsSL -o "$PROXY" \
    "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/${PROXY_VERSION}/cloud-sql-proxy.${ASSET}"
  chmod +x "$PROXY"
else
  info "binary              $PROXY (cached)"
fi

# Application Default Credentials, not the gcloud user credential: the proxy is
# a library client, not a gcloud subcommand, and it reads ADC only.
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  die 'No application-default credentials. Run:
    gcloud auth application-default login'
fi

CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" \
  --project="$PROJECT_ID" --format='value(connectionName)')" \
  || die "Cannot describe instance '$SQL_INSTANCE' in '$PROJECT_ID'."
info "instance            $CONNECTION_NAME"

say 'Connection string'
# The stored URL is the one Cloud Run uses: it names a unix socket that exists
# only inside a Cloud Run container. Rewrite it to the TCP form the tunnel
# serves, keeping the credentials.
STORED="$(gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT_ID")" \
  || die "Cannot read secret '$DB_SECRET'."

CREDS="${STORED#postgresql://}"; CREDS="${CREDS%%@*}"
DB_PART="${STORED##*@localhost/}"; DB_NAME="${DB_PART%%\?*}"
LOCAL_URL="postgresql://${CREDS}@127.0.0.1:${LOCAL_PORT}/${DB_NAME}?schema=public"

case "$LOCAL_URL" in
  postgresql://*:*@127.0.0.1:*/*) : ;;
  *) die "Could not rewrite the stored URL into a local one. Read it yourself:
    gcloud secrets versions access latest --secret=$DB_SECRET --project=$PROJECT_ID" ;;
esac

umask 077
printf 'DATABASE_URL="%s"\n' "$LOCAL_URL" > "$ENV_FILE"
info "wrote               $ENV_FILE (0600)"
[ "$PRINT_URL" = '1' ] && info "url                 $LOCAL_URL"

say "Listening on 127.0.0.1:${LOCAL_PORT} — Ctrl-C to stop"
cat <<EOF

  In another shell:
    set -a && . ./.env.cloud && set +a
    pnpm pipeline --state FL

EOF
exec "$PROXY" --address 127.0.0.1 --port "$LOCAL_PORT" "$CONNECTION_NAME"
