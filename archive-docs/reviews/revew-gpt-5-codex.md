# Generate Ideas Workflow Review

## Findings

1. **Blocker – Stage output drops required `uniquenessCheck` metadata** (`workflows/generate-ideas.workflow.json`)
   - `Aggregate Ideas` replaces the agent output with the batch API response, but the API response lacks a `uniquenessCheck` payload, so the workflow records lose that contractually required field before updating `workflow_runs`. Downstream tooling (and the spec in `workflows/AISMR_SCHEMAS.md`) expect every idea object to retain `uniquenessCheck` for duplicate detection.

```265:283:/Users/mjames/.cursor/worktrees/mcp-prompts/rJPfK/workflows/generate-ideas.workflow.json
const batchResponse = $('Create Batch Videos').item?.json;
...
  ideas.push(...batchResponse.data.videos.map((v) => ({
    ideaTitle: v.idea,
    idea: v.idea,
    vibe: v.vibe,
    ideaId: v.id
  })));
```

```14:45:/Users/mjames/.cursor/worktrees/mcp-prompts/rJPfK/workflows/AISMR_SCHEMAS.md
    "required": ["ideaTitle", "vibe", "uniquenessCheck"],
    "properties": {
      "uniquenessCheck": {
        "type": "object",
        ...
```

- **Impact**: `Update Run Ideas Complete` writes incomplete idea objects into `workflow_runs`, so subsequent stages cannot see or log uniqueness verification and the orchestrator deviates from the published contract.
- **Fix**: Merge the original agent output (or at least its `uniquenessCheck`) back into the array you persist/return, or persist it in `metadata` before the batch call and rehydrate it afterward.

2. **Major – Fallback parsing never succeeds when the LLM response is non-array** (`workflows/generate-ideas.workflow.json`)
   - `Parse Ideas Output` builds a `parsed` object but always returns `ideas: rawOutput`. If the agent ever emits a string (e.g. validation error, markdown preface) this node will hand a string to `Prepare Batch Videos`, which immediately calls `.map` and crashes. `totalIdeas` will also reflect the character length of the string, not the idea count.

```225:240:/Users/mjames/.cursor/worktrees/mcp-prompts/rJPfK/workflows/generate-ideas.workflow.json
return {
  json: {
    ideas: rawOutput,
    userIdea: userIdea,
    totalIdeas: rawOutput.length,

  }
};
```

- **Impact**: Any deviation from the strict structured output – including temporary upstream misconfigurations – will hard-fail the workflow instead of falling back to the parsed object the code just produced.
- **Fix**: Return `parsed?.ideas ?? []` (and guard `totalIdeas` with `Array.isArray`) so the recovery code actually executes.

3. **Moderate – Dead branch references a missing node** (`workflows/generate-ideas.workflow.json`)
   - The connections still route `Edit Fields1 → Create a row`, but the `nodes` array no longer defines a `Create a row` node, and nothing feeds `Split Out`. The export now contains dangling wiring that will surface as validation errors when opened in n8n and removes the intended per-item fallback insert path.

```389:398:/Users/mjames/.cursor/worktrees/mcp-prompts/rJPfK/workflows/generate-ideas.workflow.json
"Edit Fields1": {
  "main": [
    [
      {
        "node": "Create a row",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
```

- **Impact**: Anyone re-importing this workflow inherits inconsistent state, and the original row-by-row insert fallback no longer exists.
- **Fix**: Either remove the dead branch entirely or reintroduce the per-item insert node and connect it to a real upstream trigger.

## Open Questions

- Should we persist `uniquenessCheck` inside each video row’s `metadata` so analytics and downstream reviews retain source evidence even if the batch API is the authority? (Right now that data is discarded entirely.)

## Summary

- Core blocker: idea-generation stage drops `uniquenessCheck`, violating the published schema and breaking downstream uniqueness validation.
- Additional major issue: error-handling path in `Parse Ideas Output` cannot run because the function returns the wrong value.
- Cleanup: remove or restore the orphaned `Create a row` branch to keep the export consistent and/or reinstate the single-row fallback insertion path.
