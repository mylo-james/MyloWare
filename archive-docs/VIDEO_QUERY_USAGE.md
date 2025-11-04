# video_query Tool Usage

## The Problem You Just Hit

The `video_query` tool failed with:
```
❌ video_query failed: Failed query: select ... from "videos" where "videos"."project_id" = $1
params: aismr,200
```

This happened because the tool received `projectId: "aismr"` (a slug) but the `videos` table's `project_id` column expects a **UUID**, not a text slug.

---

## The Solution

The AI agent needs to pass the **project UUID** from the workflow context, not the slug.

### In the Workflow

Looking at `generate-ideas.workflow.json` line 250, the Aggregate Ideas node has:

```javascript
const projectId = runData.project_id || runData.projectId || 'aismr';
```

This fallback to `'aismr'` is the problem. The agent should use:
- `runData.project_id` (UUID from the run record) ✅
- NOT `'aismr'` (slug fallback) ❌

### What the Agent Should Do

When calling `video_query`, the agent should:

1. Get the project UUID from the workflow input/context:
   ```json
   {
     "idea": "velvet puppy",
     "projectId": "<runData.project_id>",  // UUID, e.g., "550e8400-e29b-41d4-a716-446655440000"
     "fuzzyMatch": true
   }
   ```

2. NOT use the slug:
   ```json
   {
     "idea": "velvet puppy",
     "projectId": "aismr",  // ❌ THIS WILL FAIL
     "fuzzyMatch": true
   }
   ```

---

## Updated Tool Description

The `video_query` tool now clearly states in its description:

```
## IMPORTANT: projectId Format
projectId must be a UUID (e.g., "550e8400-e29b-41d4-a716-446655440000"), NOT a slug like "aismr".
The videos table stores project_id as UUID. You must obtain the UUID from the workflow context.
```

---

## Updated Prompt Instructions

The `ideagenerator-aismr.json` prompt (Step 2) now says:

```json
{
  "name": "Video Table Uniqueness Check",
  "instruction": "For each candidate 2-word idea, query the videos table to check if it already exists. Use the project UUID from the workflow input, NOT the slug.",
  "tool": {
    "name": "video_query",
    "arguments": {
      "idea": "<candidate 2-word title>",
      "projectId": "<workflow projectId UUID (from runData.project_id, NOT the slug 'aismr')>"
    }
  }
}
```

---

## Next Steps for You

1. Make sure the workflow is passing the project UUID to the AI agent
2. Or update the workflow's Aggregate Ideas node to only use `runData.project_id` (remove the `'aismr'` fallback)
3. The AI agent will now understand to use the UUID from the tool description and prompt

The tool and prompts are now updated to make this clear!

