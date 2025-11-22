# Development Cycle: Observe-Diagnose-Fix-Verify-Document

## Philosophy

**Watch it run. See what breaks. Fix the root cause. Prove it works. Write it down.**

This is how we develop at MyloWare, and it's how our AI agents should work too.

---

## The Cycle

### 1. **Observe** 👀

**Start a run and watch what happens.**

- Kick off a production run with a real `runId`
- Watch LangSmith traces in real-time
- Monitor logs for errors, warnings, tool calls
- Check artifacts being created
- Note what works and what doesn't

**Key Questions:**
- Did the agent call the right tools?
- Did it research before acting?
- Did it get stuck in a loop?
- Did it skip required steps?
- What does LangSmith show about its reasoning?

**Tools:**
- LangSmith: `https://smith.langchain.com/o/.../projects/p/...`
- Logs: `flyctl logs -c fly.orchestrator.toml -n | rg "run_id"`
- Database: Query `runs`, `artifacts`, `webhook_events` tables
- API: `GET /v1/runs/{runId}` to check state

**Example:**
```bash
# Start a run
curl -X POST https://myloware-api-staging.fly.dev/v1/runs/start \
  -H "x-api-key: $API_KEY" \
  -d '{"project": "test_video_gen", "input": "Generate test videos"}'

# Watch logs
flyctl logs -c fly.orchestrator.toml -f | rg "335a193f"

# Check LangSmith
open "https://smith.langchain.com/o/.../projects/p/myloware-orchestrator-staging"
```

---

### 2. **Diagnose** 🔍

**Find the root cause, not just symptoms.**

- Look at the exact error message and stack trace
- Check LangSmith for tool calls and reasoning
- Review the agent's system prompt and expectations
- Examine the state at the point of failure
- Trace backwards from the symptom to the cause

**Key Questions:**
- What was the agent trying to do?
- Why did it fail or get stuck?
- Is this a prompt issue, tool issue, or data issue?
- Is there a silent fallback hiding the real problem?
- What would make this fail-fast instead of failing silently?

**Tools:**
- LangSmith traces (reasoning tokens, tool trajectory)
- Log context around the error
- Database state inspection
- Code review of the relevant tool/node
- `grep` for related code patterns

**Example:**
```bash
# Riley stuck in loop - what tools did he call?
# LangSmith shows: memory_search, memory_search, memory_search (no submit_generation_jobs_tool)

# Check the contract expectations
cat data/projects/test_video_gen/agent-expectations.json | jq '.riley.tools'

# Check the tool registration
grep -A 20 "def _register_persona_tools" apps/orchestrator/persona_nodes.py

# Found: _load_allowed_tools returning empty dict, defaulting to memory_search only
```

---

### 3. **Fix** 🔧

**Fix the root cause, remove fallbacks, enforce fail-fast.**

- Address the underlying issue, not the symptom
- Remove any silent fallbacks that hide problems
- Add validation to catch the issue early
- Update prompts, expectations, and KB as needed
- Add tests to prevent regression

**Key Principles:**
- **Fail-fast**: Errors should be loud and immediate
- **No silent fallbacks**: If something's wrong, raise an exception
- **Validate early**: Check inputs before processing
- **Document intent**: Comments explain why, not what
- **Test the fix**: Add a unit test or integration test

**Example:**
```python
# Before: Silent fallback to memory_search only
def _load_allowed_tools(persona: str, project: str) -> list[str]:
    expectations = _load_agent_expectations(project)
    persona_config = expectations.get(persona, {})
    return persona_config.get("tools", ["memory_search"])  # ❌ Silent fallback

# After: Fail-fast if expectations not found
def _load_allowed_tools(persona: str, project: str) -> list[str]:
    expectations = _load_agent_expectations(project)
    if persona not in expectations:
        raise ValueError(f"No expectations found for {persona} in {project}")  # ✅ Fail-fast
    return expectations[persona]["tools"]
```

---

### 4. **Verify** ✅

**Prove the fix works with a real run.**

- Deploy the fix to staging
- Start a fresh run with a new `runId`
- Watch it complete end-to-end
- Check LangSmith for correct behavior
- Verify artifacts are created correctly
- Confirm the issue is resolved

**Key Questions:**
- Did the run complete successfully?
- Did the agent call the right tools in the right order?
- Are artifacts created with correct metadata?
- Does LangSmith show the expected reasoning?
- Can we reproduce the success?

**Tools:**
- Same as Observe phase
- Compare before/after LangSmith traces
- Check artifact checksums and metadata
- Review run state at each step

**Example:**
```bash
# Deploy fix
flyctl deploy -c fly.orchestrator.toml --strategy immediate

# Start fresh run
curl -X POST https://myloware-api-staging.fly.dev/v1/runs/start \
  -H "x-api-key: $API_KEY" \
  -d '{"project": "test_video_gen", "input": "Generate test videos"}'

# Watch it complete
flyctl logs -c fly.orchestrator.toml -f | rg "9bc36a33"

# Verify in LangSmith
# ✅ Riley called: memory_search (3x), submit_generation_jobs_tool, wait_for_generations_tool, transfer_to_alex
# ✅ Alex called: render_video_timeline_tool (no payload), transfer_to_quinn
# ✅ Quinn called: memory_search (1x), publish_to_tiktok_tool
```

---

### 5. **Document** 📝

**Write down what happened, why, and how to prevent it.**

- Create a summary document (e.g., `ALEX_TIMELINE_REFACTOR.md`)
- Update `implementation-plan.md` with the fix
- Add evidence files with run IDs and LangSmith links
- Update relevant KB documents
- Add comments to code explaining non-obvious fixes

**Key Sections:**
1. **Problem**: What was broken?
2. **Root Cause**: Why was it broken?
3. **Solution**: What did we change?
4. **Changes**: Specific files and code changes
5. **Benefits**: Why is this better?
6. **Verification**: Evidence that it works (run IDs, LangSmith links)

**Example:**
```markdown
# Riley Contract Regression Fix

## Problem
Riley stuck in infinite retrieval loop (run `335a193f`), repeatedly calling `memory_search` but never `submit_generation_jobs_tool`.

## Root Cause
`_load_agent_expectations` returning empty dict due to incorrect file path, causing `_load_allowed_tools` to default to `["memory_search"]` only.

## Solution
1. Fixed file path in `persona_context.py` to prepend `/app`
2. Removed silent fallback in `_load_allowed_tools` to fail-fast
3. Added contract validation to enforce required tool calls

## Verification
Run `9bc36a33` completed successfully:
- Riley called: memory_search (3x), submit_generation_jobs_tool ✅
- LangSmith: https://smith.langchain.com/.../9bc36a33
```

---

## Applying This to AI Agents

Our AI agents (Iggy, Riley, Alex, Quinn) should follow the same cycle:

### Agent Workflow Pattern

```python
# 1. OBSERVE: Load context from state and artifacts
state = load_run_state(run_id)
prior_artifacts = load_artifacts(run_id)
project_spec = load_project_spec(state["project"])

# 2. DIAGNOSE: Research what's needed
memory_search("project requirements and format specs")
memory_search("relevant patterns and examples")
memory_search("quality checklist and guardrails")

# 3. FIX/CREATE: Do the work
result = execute_primary_responsibility(
    context=state,
    research=memory_results,
    spec=project_spec
)

# 4. VERIFY: Validate before handing off
validate_result(result, project_spec)
store_artifact(run_id, result)

# 5. DOCUMENT: Record what was done
transfer_to_next_persona(
    summary=f"Completed {task}, created {artifact_count} artifacts",
    next_steps="Next persona should..."
)
```

### Example: Alex's Timeline Building

```python
# 1. OBSERVE
videos = state["videos"]
if not all(v.get("assetUrl") for v in videos):
    return "Waiting for Riley to complete generation"

# 2. DIAGNOSE (Research)
shotstack_patterns = memory_search("shotstack timeline overlay template", k=5)
format_specs = memory_search("test_video_gen video format duration", k=3)
qc_checklist = memory_search("editing quality checklist transitions", k=3)

# 3. FIX/CREATE (Call helper)
if not all(v.get("assetUrl") for v in videos):
    return "waiting for generated clips"

render_url = render_video_timeline_tool(run_id=run_id)

# 4. DOCUMENT (Hand off)
transfer_to_quinn(
    summary=f"Rendered {len(videos)} clips via template helper",
    render_url=render_url,
    next_steps="Quinn should publish to TikTok with test caption"
)
```

---

## Key Principles

### 1. **Always Start with Observation**
Don't assume what's broken. Watch a real run and see what actually happens.

### 2. **Research Before Acting**
Use `memory_search` to load relevant patterns, specs, and checklists before doing work.

### 3. **Fail-Fast, No Silent Fallbacks**
If something's wrong, raise an exception immediately. Don't hide problems with defaults.

### 4. **Validate Before Handing Off**
Check your work meets requirements before transferring to the next persona.

### 5. **Document Everything**
Every fix, every run, every decision should be written down with evidence.

---

## Tools for Each Phase

| Phase | Human Tools | Agent Tools |
|-------|-------------|-------------|
| **Observe** | LangSmith, logs, DB queries | `load_run_state`, `load_artifacts` |
| **Diagnose** | Traces, grep, code review | `memory_search` (patterns, specs, checklists) |
| **Fix** | Code editor, tests | Primary tools (submit_jobs, render_timeline, publish) |
| **Verify** | Deploy, test run, traces | Validation functions, artifact storage |
| **Document** | Markdown files, comments | `transfer_to_*` with summary and next steps |

---

## Anti-Patterns to Avoid

❌ **Assuming the problem** without observing a real run
❌ **Treating symptoms** instead of finding root cause
❌ **Silent fallbacks** that hide real issues
❌ **Skipping research** and guessing at requirements
❌ **No verification** after making changes
❌ **Undocumented fixes** that will be forgotten

✅ **Watch it run** and see what actually breaks
✅ **Trace to root cause** using logs and traces
✅ **Fail-fast** with clear error messages
✅ **Research first** using memory_search
✅ **Verify with real run** after every fix
✅ **Document with evidence** (run IDs, traces, artifacts)

---

## Example: Full Cycle in Practice

### Problem Discovery
```bash
# Observe: Riley stuck in loop
flyctl logs | rg "335a193f"
# "Persona 'riley' calling memory_search again (attempt 12/15)"

# LangSmith shows: memory_search × 12, no submit_generation_jobs_tool
```

### Diagnosis
```bash
# Check expectations
cat data/projects/test_video_gen/agent-expectations.json | jq '.riley.tools'
# ["memory_search", "submit_generation_jobs_tool", "wait_for_generations_tool", "transfer_to_alex"]

# Check tool registration
grep "_load_allowed_tools" apps/orchestrator/persona_context.py -A 10
# Found: returns ["memory_search"] as fallback when expectations not found

# Check file path
grep "data_dir = Path" apps/orchestrator/persona_context.py
# Found: data_dir = Path("data/projects")  ❌ Should be Path("/app/data/projects")
```

### Fix
```python
# apps/orchestrator/persona_context.py
- data_dir = Path("data/projects")
+ data_dir = Path("/app/data/projects")

# Remove silent fallback
- return persona_config.get("tools", ["memory_search"])
+ if persona not in expectations:
+     raise ValueError(f"No expectations found for {persona}")
+ return expectations[persona]["tools"]
```

### Verify
```bash
# Deploy
flyctl deploy -c fly.orchestrator.toml --strategy immediate

# Test
curl -X POST .../v1/runs/start -d '{"project": "test_video_gen", ...}'

# Watch logs
flyctl logs -f | rg "9bc36a33"
# ✅ "Riley calling submit_generation_jobs_tool"
# ✅ "Riley calling wait_for_generations_tool"
# ✅ "Riley transferring to Alex"

# Check LangSmith
# ✅ Tool trajectory: memory_search (3x) → submit_generation_jobs_tool → wait → transfer
```

### Document
```bash
# Create summary
cat > RILEY_CONTRACT_FIX.md << EOF
# Riley Contract Regression Fix

## Problem
Riley stuck in loop (run 335a193f), only calling memory_search.

## Root Cause
Incorrect file path + silent fallback = tools not loaded.

## Solution
1. Fixed path: /app/data/projects
2. Removed fallback: fail-fast if expectations missing
3. Added contract validation

## Verification
Run 9bc36a33 completed successfully.
LangSmith: https://smith.langchain.com/.../9bc36a33
EOF

# Update implementation plan
# Add to "Recent Fixes" section with run ID and evidence
```

---

## Summary

**The cycle is simple:**

1. 👀 **Observe**: Start a run, watch what happens
2. 🔍 **Diagnose**: Find the root cause using traces and logs
3. 🔧 **Fix**: Address the cause, remove fallbacks, fail-fast
4. ✅ **Verify**: Deploy and prove it works with a real run
5. 📝 **Document**: Write it down with evidence

**This is how we develop. This is how our agents should work.**

No assumptions. No guessing. No silent failures.

**Watch → Diagnose → Fix → Verify → Document.**

Repeat until production-ready.
