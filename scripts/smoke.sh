#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8080}"
ORCH_BASE="${ORCH_BASE:-http://localhost:8090}"
API_KEY="${API_KEY:-dev_local_api_key_4d6f9b87e2c348caa5f03e2fb8b9d4fe}"
ITERATIONS="${ITERATIONS:-50}"

info() { printf "[smoke] %s\n" "$1"; }
warn() { printf "[smoke][warn] %s\n" "$1" >&2; }

hit_endpoint() {
  local name="$1"
  shift
  if curl -sSf "$@" >/dev/null; then
    info "${name} OK"
    return 0
  else
    warn "${name} FAILED"
    return 1
  fi
}

info "Checking orchestrator health at ${ORCH_BASE}/health"
hit_endpoint "orchestrator/health" "${ORCH_BASE}/health" || true

total=0
failures=0
info "Running ${ITERATIONS} iterations against /health and /version"
for i in $(seq 1 "${ITERATIONS}"); do
  if ! hit_endpoint "api/health #${i}" "${API_BASE}/health"; then
    failures=$((failures + 1))
  fi
  if ! hit_endpoint "api/version #${i}" -H "x-api-key: ${API_KEY}" "${API_BASE}/version"; then
    failures=$((failures + 1))
  fi
  total=$((total + 2))
  sleep 0.1
done

if (( total == 0 )); then
  echo "No requests executed" >&2
  exit 1
fi

error_pct=$(python3 - <<PY
failures = ${failures}
total = ${total}
print(round((failures / total) * 100, 2))
PY
)

info "Requests: ${total}, Failures: ${failures}, Error%%: ${error_pct}"

if (( failures * 100 >= total * 5 )); then
  warn "Smoke test failed: error rate ${error_pct}% exceeds 5% threshold"
  exit 1
fi

info "Smoke test passed"
