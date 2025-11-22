#!/usr/bin/env bash
set -euo pipefail

# Run Alembic migrations against the Fly.io staging Postgres instance.
# This script:
#   - Reads DB_URL from .env.staging
#   - Starts a local flyctl proxy to the staging Postgres app
#   - Runs `alembic upgrade head` using that proxied URL
#
# Usage:
#   bash infra/scripts/migrate_staging.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.staging"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing .env.staging at ${ENV_FILE} – create it first (copy from .env.development and set ENVIRONMENT=staging)." >&2
  exit 1
fi

if ! command -v flyctl >/dev/null 2>&1; then
  echo "flyctl is not installed. Install via Homebrew (brew install flyctl) or the Fly.io installer, then rerun." >&2
  exit 1
fi

if ! command -v alembic >/dev/null 2>&1; then
  echo "alembic is not available on PATH. Activate your virtualenv for this repo before running this script." >&2
  exit 1
fi

echo "Loading DB_URL from .env.staging…"

# Export variables from .env.staging without echoing secrets.
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${DB_URL:-}" ]]; then
  echo "DB_URL is not set in .env.staging; cannot run migrations." >&2
  exit 1
fi

PROXY_DB_URL="${DB_URL/myloware-postgres-staging.flycast:5432/localhost:15432}"

echo "Starting flyctl proxy to staging Postgres on localhost:15432…"
flyctl proxy 15432:5432 -a myloware-postgres-staging --watch-stdin >/dev/null 2>&1 &
PROXY_PID=$!

cleanup() {
  if ps -p "${PROXY_PID}" >/dev/null 2>&1; then
    kill "${PROXY_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

run_migrations_with_retry() {
  local attempt=1
  local max_attempts=10
  local delay=3

  while (( attempt <= max_attempts )); do
    echo "Running Alembic migrations (attempt ${attempt}/${max_attempts})…"
    if DB_URL="${PROXY_DB_URL}" alembic upgrade head; then
      echo "Alembic migrations completed successfully for staging."
      return 0
    fi
    echo "Alembic migrations failed (attempt ${attempt}). Retrying in ${delay}s…"
    sleep "${delay}"
    attempt=$(( attempt + 1 ))
  done

  echo "Alembic migrations failed after ${max_attempts} attempts." >&2
  exit 1
}

( cd "${ROOT_DIR}" && run_migrations_with_retry )
