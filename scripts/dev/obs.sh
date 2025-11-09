#!/usr/bin/env bash

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker command not found. Start Docker Desktop or install Docker first." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx 'n8n'; then
  echo "❌ n8n container is not running. Start it with 'npm run dev:services:start' first." >&2
  exit 1
fi

# Attempt to clear any lingering tails inside the container so we don't stack processes.
docker exec n8n pkill -f 'tail -f /home/node/.n8n/logs/n8n.log' >/dev/null 2>&1 || true

LOG_PATH=/home/node/.n8n/logs/n8n.log
echo "📄 Tailing ${LOG_PATH} (container: n8n)"
docker exec n8n tail -f "${LOG_PATH}" &
TAIL_PID=$!

cleanup() {
  if ps -p "${TAIL_PID}" >/dev/null 2>&1; then
    kill "${TAIL_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ "$#" -gt 0 ]; then
  npm run watch:execution -- "$@"
else
  npm run watch:execution
fi

