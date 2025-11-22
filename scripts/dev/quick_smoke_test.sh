#!/bin/bash
# Quick smoke test for persona orchestration fixes
# Run this after applying the critical fixes

set -e

echo "🔧 Quick Smoke Test for Persona Orchestration"
echo "=============================================="
echo

# Prefer repo virtualenv python, fall back to system python
PYTHON_BIN=${PYTHON_BIN:-.venv/bin/python}
if [ ! -x "$PYTHON_BIN" ]; then
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_BIN=$(command -v python3)
    elif command -v python >/dev/null 2>&1; then
        PYTHON_BIN=$(command -v python)
    else
        echo "❌ No Python interpreter found (expected .venv/bin/python or python3)"
        exit 1
    fi
fi

echo "🐍 Using Python interpreter: $PYTHON_BIN"
echo

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo "   Please create .env with API_KEY and DB_URL"
    exit 1
fi

# Source .env
export $(cat .env | grep -v '^#' | xargs)

# Verify PROVIDERS_MODE is set to mock
if [ -z "$PROVIDERS_MODE" ]; then
    echo "⚠️  PROVIDERS_MODE not set, defaulting to 'mock'"
    export PROVIDERS_MODE=mock
fi

if [ "$PROVIDERS_MODE" != "mock" ]; then
    echo "⚠️  PROVIDERS_MODE is '$PROVIDERS_MODE' - recommend 'mock' for smoke test"
    read -p "   Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if docker stack is running
if ! docker compose -f infra/docker-compose.yml ps | grep -q "orchestrator.*Up"; then
    echo "❌ Orchestrator container not running"
    echo "   Run: docker compose -f infra/docker-compose.yml up -d"
    exit 1
fi

echo "✅ Environment checks passed"
echo

# Verify tool allowlist fixes
echo "🔍 Verifying tool allowlist fixes..."
"$PYTHON_BIN" - <<'PY'
import json
from pathlib import Path

personas = ["iggy", "riley", "alex", "quinn"]
expected_tools = {
    "iggy": ["memory_search", "transfer_to_riley"],
    "riley": ["memory_search", "submit_generation_jobs_tool", "wait_for_generations_tool", "transfer_to_alex"],
    "alex": ["memory_search", "render_video_timeline_tool", "transfer_to_quinn"],
    "quinn": ["memory_search", "publish_to_tiktok_tool"],
}

base = Path("data/personas")
all_good = True

for persona in personas:
    path = base / persona / "persona.json"
    if not path.exists():
        print(f"❌ {persona}/persona.json not found")
        all_good = False
        continue
    
    data = json.loads(path.read_text())
    tools = set(data.get("allowedTools", []))
    expected = set(expected_tools[persona])
    
    if not expected.issubset(tools):
        missing = expected - tools
        print(f"❌ {persona} missing tools: {missing}")
        all_good = False
    else:
        print(f"✅ {persona} tools: {', '.join(sorted(expected))}")

if not all_good:
    import sys
    sys.exit(1)
PY

if [ $? -ne 0 ]; then
    echo
    echo "❌ Tool allowlist verification failed"
    echo "   Review: review-critical.md Phase 1"
    exit 1
fi

echo "✅ Tool allowlists verified"
echo

# Test that orchestrator can import and build context
echo "🔍 Testing persona context building..."
"$PYTHON_BIN" - <<'PY'
import sys
sys.path.insert(0, ".")

try:
    from apps.orchestrator.persona_context import build_persona_context
    from apps.orchestrator.graph_factory import load_project_spec
    
    state = {"project": "test_video_gen", "run_id": "test_001", "input": "test"}
    spec = load_project_spec("test_video_gen")
    
    for persona in ["iggy", "riley", "alex", "quinn"]:
        ctx = build_persona_context(state, spec, persona)
        tools = ctx.get("allowed_tools", [])
        if not tools:
            print(f"❌ {persona} has no allowed tools")
            sys.exit(1)
        print(f"✅ {persona} context: {len(tools)} tools")
    
except Exception as exc:
    print(f"❌ Error building context: {exc}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
PY

if [ $? -ne 0 ]; then
    echo
    echo "❌ Persona context building failed"
    exit 1
fi

echo "✅ Persona context builds successfully"
echo

# Start a test run via Brendan
echo "🚀 Starting test run via Brendan..."
API_BASE=${API_BASE_URL:-http://localhost:8080}

RUN_RESPONSE=$(curl -s -X POST "$API_BASE/v1/chat/brendan" \
    -H "x-api-key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"user_id": "smoke_test", "message": "Make a test video"}')

if [ $? -ne 0 ]; then
    echo "❌ Failed to start run via Brendan"
    exit 1
fi

echo "📝 Brendan response:"
echo "$RUN_RESPONSE" | jq -C '.' 2>/dev/null || echo "$RUN_RESPONSE"
echo

# Extract run_id from pending_gate if present
RUN_ID=$(echo "$RUN_RESPONSE" | jq -r '.pending_gate.run_id // empty' 2>/dev/null)

if [ -z "$RUN_ID" ]; then
    echo "⚠️  No run_id found in response - may need workflow approval"
    echo "   Check Brendan's response for approval instructions"
else
    echo "✅ Run started: $RUN_ID"
    echo
    echo "📊 Next steps:"
    echo "   1. Approve workflow gate (if needed)"
    echo "   2. Watch run: python scripts/watch_run.py $RUN_ID"
    echo "   3. Check status: curl $API_BASE/v1/runs/$RUN_ID | jq '.status, .result'"
fi

echo
echo "🎉 Smoke test setup complete!"
echo "   Review full checklist in: review-critical.md"
