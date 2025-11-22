#!/usr/bin/env bash
set -euo pipefail

# Bootstrap Fly.io staging secrets for the API and orchestrator apps using .env.staging.
# This script does NOT create apps or databases; it assumes:
# - flyctl is installed and authenticated
# - apps/api/fly.toml and apps/orchestrator/fly.toml are configured
#
# Usage:
#   bash infra/scripts/bootstrap_staging_secrets.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.staging"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing .env.staging at ${ENV_FILE} – create it first (copy from .env.development and set ENVIRONMENT=staging)." >&2
  exit 1
fi

# Export vars from .env.staging without printing them.
# We rely on the file containing only simple KEY=VALUE assignments and comments.
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if ! command -v flyctl >/dev/null 2>&1; then
  echo "flyctl is not installed. Install via Homebrew (brew install flyctl) or the Fly.io installer, then rerun." >&2
  exit 1
fi

echo "Setting staging secrets for API app (apps/api/fly.toml)…"
(
  cd "${ROOT_DIR}/apps/api"
  flyctl secrets set \
    API_KEY="${API_KEY:?}" \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    DB_URL="${DB_URL:?}" \
    SENTRY_DSN="${SENTRY_DSN:-}" \
    LANGSMITH_API_KEY="${LANGSMITH_API_KEY:-}" \
    KIEAI_API_KEY="${KIEAI_API_KEY:?}" \
    KIEAI_SIGNING_SECRET="${KIEAI_SECRET:-${KIEAI_SIGNING_SECRET:-}}" \
    SHOTSTACK_API_KEY="${SHOTSTACK_API_KEY:?}" \
    UPLOAD_POST_API_KEY="${UPLOAD_POST_API_KEY:?}" \
    UPLOAD_POST_SIGNING_SECRET="${UPLOAD_POST_SECRET:-${UPLOAD_POST_SIGNING_SECRET:-}}" \
    HITL_SECRET="${HITL_SECRET:?}" \
    TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
)

echo "Setting staging secrets for orchestrator app (apps/orchestrator/fly.toml)…"
(
  cd "${ROOT_DIR}/apps/orchestrator"
  flyctl secrets set \
    API_KEY="${API_KEY:?}" \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    DB_URL="${DB_URL:?}" \
    SENTRY_DSN="${SENTRY_DSN:-}" \
    LANGSMITH_API_KEY="${LANGSMITH_API_KEY:-}" \
    KIEAI_API_KEY="${KIEAI_API_KEY:?}" \
    KIEAI_SIGNING_SECRET="${KIEAI_SECRET:-${KIEAI_SIGNING_SECRET:-}}" \
    SHOTSTACK_API_KEY="${SHOTSTACK_API_KEY:?}" \
    UPLOAD_POST_API_KEY="${UPLOAD_POST_API_KEY:?}" \
    UPLOAD_POST_SIGNING_SECRET="${UPLOAD_POST_SECRET:-${UPLOAD_POST_SIGNING_SECRET:-}}"
)

echo "Staging secrets configured. Next steps:"
echo "  1) flyctl deploy   (from apps/api)"
echo "  2) flyctl deploy   (from apps/orchestrator)"
echo "  3) Run the Step 21 curl + HITL flow against the staging API host."
