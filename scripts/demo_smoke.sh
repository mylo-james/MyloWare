#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8765}"
BASE_URL="http://${HOST}:${PORT}"

API_KEY="${API_KEY:-dev-api-key}"
WORKFLOW="${WORKFLOW:-aismr}"
BRIEF="${BRIEF:-Create a calming rain ASMR video.}"

DATABASE_URL_DEFAULT="sqlite+aiosqlite:///./e2e_local.db"
DATABASE_URL="${DATABASE_URL:-$DATABASE_URL_DEFAULT}"

LOG_FILE="${LOG_FILE:-./.demo_smoke_server.log}"

export ENVIRONMENT="${ENVIRONMENT:-development}"
export PYTHONPATH="${PYTHONPATH:-src}"
export API_KEY="$API_KEY"
export DATABASE_URL="$DATABASE_URL"
export WORKFLOW_DISPATCHER="${WORKFLOW_DISPATCHER:-inprocess}"
export DISABLE_BACKGROUND_WORKFLOWS="${DISABLE_BACKGROUND_WORKFLOWS:-false}"
export WEBHOOK_BASE_URL="${WEBHOOK_BASE_URL:-$BASE_URL}"
export USE_LANGGRAPH_ENGINE="${USE_LANGGRAPH_ENGINE:-true}"

# Fake-by-default: no real API calls required.
export LLAMA_STACK_PROVIDER="${LLAMA_STACK_PROVIDER:-fake}"
export SORA_PROVIDER="${SORA_PROVIDER:-fake}"
export REMOTION_PROVIDER="${REMOTION_PROVIDER:-fake}"
export UPLOAD_POST_PROVIDER="${UPLOAD_POST_PROVIDER:-fake}"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "Starting API server: ${BASE_URL} (logs: ${LOG_FILE})"
python -m uvicorn myloware.api.server:app --host "$HOST" --port "$PORT" >"$LOG_FILE" 2>&1 &
SERVER_PID="$!"

echo -n "Waiting for /health ..."
for _i in $(seq 1 80); do
  if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  sleep 0.25
done

if ! curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
  echo ""
  echo "Server failed to start. Tail logs:"
  tail -n 120 "$LOG_FILE" || true
  exit 1
fi

headers=(-H "X-API-Key: ${API_KEY}" -H "Content-Type: application/json")

echo "Starting LangGraph run via /v2/runs/start (workflow=${WORKFLOW})"
start_payload="$(
  WORKFLOW="$WORKFLOW" BRIEF="$BRIEF" python - <<'PY'
import json
import os

print(json.dumps({"workflow": os.environ["WORKFLOW"], "brief": os.environ["BRIEF"]}))
PY
)"

start_json="$(curl -fsS -X POST "${BASE_URL}/v2/runs/start" "${headers[@]}" -d "${start_payload}")"
run_id="$(python -c 'import json,sys; print(json.load(sys.stdin)["run_id"])' <<<"${start_json}")"

if [[ -z "${run_id}" ]]; then
  echo "Failed to parse run_id from /v2/runs/start response. Raw response:"
  printf '%s\n' "${start_json}"
  exit 1
fi

echo "Run ID: ${run_id}"

approved_ideation="false"
approved_publish="false"

approve_interrupt() {
  local label="$1"
  local approve_json
  local status_hint

  approve_json="$(curl -fsS -X POST "${BASE_URL}/v2/runs/${run_id}/approve" "${headers[@]}" -d '{"approved": true}')"
  status_hint="$(python -c 'import json,sys; print((json.load(sys.stdin).get("state") or {}).get("status","unknown"))' <<<"${approve_json}")"
  echo "Approved ${label} (status now: ${status_hint})"
}

echo -n "Polling /v1/runs/{id} for terminal status ..."
final_detail=""
final_status="unknown"
for _i in $(seq 1 120); do
  final_detail="$(curl -fsS "${BASE_URL}/v1/runs/${run_id}" -H "X-API-Key: ${API_KEY}")"
  final_status="$(python -c 'import json,sys; print(json.load(sys.stdin).get("status","unknown"))' <<<"${final_detail}")"

  if [[ "${final_status}" == "awaiting_ideation_approval" && "${approved_ideation}" != "true" ]]; then
    approve_interrupt "ideation"
    approved_ideation="true"
  fi

  if [[ "${final_status}" == "awaiting_publish_approval" && "${approved_publish}" != "true" ]]; then
    approve_interrupt "publish"
    approved_publish="true"
  fi
  if [[ "$final_status" == "completed" || "$final_status" == "failed" || "$final_status" == "rejected" ]]; then
    break
  fi
  sleep 0.25
done
echo " ${final_status}"

python -c '
import json, sys
detail = json.load(sys.stdin)
artifacts = detail.get("artifacts") or {}
print("Artifacts keys:", ", ".join(sorted(artifacts.keys())) if artifacts else "(none)")
print("Current step:", detail.get("current_step"))
if detail.get("error"):
    print("Error:", detail["error"])
' <<<"${final_detail}"

if [[ "$final_status" != "completed" ]]; then
  echo ""
  echo "Run did not complete successfully (status=${final_status}). Tail logs:"
  tail -n 160 "$LOG_FILE" || true
  exit 1
fi

echo "✅ Demo smoke complete (status=completed)"
