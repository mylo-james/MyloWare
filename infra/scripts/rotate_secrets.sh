#!/usr/bin/env bash
set -euo pipefail

# Helper script and checklist for rotating API/orchestrator secrets.
#
# This does not generate new secrets for you; it wires together the
# existing helpers in this repo so that secret rotation is a repeatable
# sequence instead of an ad-hoc process.
#
# Recommended quarterly flow (run from repo root):
#
#   1) Materialize a fresh .env from 1Password or your chosen secret store:
#        python infra/scripts/materialize_env.py --src .env.real --dest .env
#
#   2) Create/update environment-specific files (e.g. .env.staging, .env.production)
#      with rotated values for:
#        - API_KEY, DB_URL, SENTRY_DSN
#        - KIEAI_API_KEY, KIEAI_SIGNING_SECRET
#        - SHOTSTACK_API_KEY
#        - UPLOAD_POST_API_KEY, UPLOAD_POST_SIGNING_SECRET
#        - HITL_SECRET, TELEGRAM_BOT_TOKEN (if used)
#
#   3) Re-sync Fly.io secrets for staging using the existing bootstrap helper:
#        bash infra/scripts/bootstrap_staging_secrets.sh
#
#   4) For production, run an equivalent flyctl secrets set command from
#      apps/api and apps/orchestrator (mirroring bootstrap_staging_secrets.sh)
#      with the production .env file loaded in your shell.
#
#   5) Deploy and verify:
#        cd apps/api && flyctl deploy
#        cd ../orchestrator && flyctl deploy
#      Then run the standard smoke + HITL flows described in AGENTS.md.
#
# This script intentionally only documents the sequence instead of executing
# potentially destructive operations automatically. Treat it as a single
# source of truth for secret-rotation runbooks.

echo "This script is a documented runbook for rotating secrets."
echo "Read and follow the numbered steps in infra/scripts/rotate_secrets.sh."

