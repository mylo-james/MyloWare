#!/bin/bash
# =============================================================================
# MyloWare Fly.io Secrets Setup
# =============================================================================
# Configures all required secrets for MyloWare deployment.
#
# Make sure your .env file has all required values before running!
# =============================================================================

set -euo pipefail

APP_NAME="${MYLOWARE_APP_NAME:-myloware-api}"

echo "=== MyloWare Fly.io Secrets Setup ==="
echo "App: $APP_NAME"
echo ""

# Check for .env file
if [ ! -f .env ]; then
    echo "ERROR: .env file not found!"
    echo "Copy .env.example to .env and fill in your values."
    exit 1
fi

# Source .env file
set -a
source .env
set +a

echo "Setting secrets..."

# Core Llama Stack
fly secrets set --app "$APP_NAME" \
    LLAMA_STACK_URL="${LLAMA_STACK_URL:-http://localhost:5001}" \
    LLAMA_STACK_MODEL="${LLAMA_STACK_MODEL:-meta-llama/Llama-3.2-3B-Instruct}" \
    TOGETHER_API_KEY="${TOGETHER_API_KEY}"

# API Authentication
fly secrets set --app "$APP_NAME" \
    API_KEY="${API_KEY}"

# External Services
fly secrets set --app "$APP_NAME" \
    KIE_API_KEY="${KIE_API_KEY}" \
    UPLOAD_POST_API_KEY="${UPLOAD_POST_API_KEY}" \

# Telegram
fly secrets set --app "$APP_NAME" \
    TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN}" \
    TELEGRAM_ALLOWED_CHAT_IDS="${TELEGRAM_ALLOWED_CHAT_IDS:-}"

echo ""
echo "=== Secrets configured ==="
echo ""
echo "To verify: fly secrets list --app $APP_NAME"

