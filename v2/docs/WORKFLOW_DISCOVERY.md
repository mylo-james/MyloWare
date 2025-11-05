# Workflow Discovery Guide

Workflows in V2 are **discovered semantically**, not referenced by name.

---

## Core Concept

```
Traditional (V1):
  if (userIntent === "generate ideas") {
    executeWorkflow("idea-generation");
  }

Agentic (V2):
  workflows = discoverWorkflow({
    intent: "generate video ideas",
    project: "aismr"
  });
  // Returns workflows ranked by semantic similarity
  executeWorkflow(workflows[0]);
```

**Workflows are data, not code.** They're stored as procedural memories and found by understanding meaning.

---

## How It Works

### 1. Store Workflow as Memory

```typescript
await memory_store({
  content: "Complete AISMR video production from idea generation to TikTok upload",
  memoryType: "procedural",
  project: ["aismr"],
  tags: ["workflow", "video-production", "complete-pipeline"],
  metadata: {
    workflow: {
      name: "Complete Video Production",
      description: "Generate ideas, write screenplay, produce video, upload to TikTok",
      steps: [
        {
          id: "generate_ideas",
          type: "tool",
          tool: "workflow.execute",
          workflowName: "Generate Ideas",
          input: { "userInput": "{{userInput}}", "count": 12 }
        },
        {
          id: "user_selection",
          type: "clarify",
          tool: "clarify.ask",
          question: "Which idea would you like to turn into a video?"
        },
        {
          id: "write_screenplay",
          type: "tool",
          tool: "workflow.execute",
          workflowName: "Write Screenplay",
          input: { "idea": "{{selectedIdea}}" }
        },
        {
          id: "generate_video",
          type: "tool",
          tool: "workflow.execute",
          workflowName: "Generate Video",
          input: { "screenplay": "{{screenplay}}" }
        },
        {
          id: "upload_tiktok",
          type: "tool",
          tool: "workflow.execute",
          workflowName: "Upload to TikTok",
          input: { "videoUrl": "{{videoUrl}}" }
        }
      ]
    }
  }
});
```

### 2. Agent Discovers by Intent

```typescript
const discovery = await discoverWorkflow({
  intent: "create AISMR video from idea to upload",
  project: "aismr"
});

// Searches procedural memories
// Ranks by semantic similarity
// Returns best matches
```

### 3. Agent Executes

```typescript
const workflow = discovery.workflows[0];

const execution = await executeWorkflow({
  workflowId: workflow.workflowId,
  input: { userInput: "rain sounds" },
  sessionId: "telegram:123456"
});

console.log(execution.workflowRunId); // "run-abc-123"
```

---

## Workflow Structure

### Basic Workflow

```json
{
  "name": "Generate Ideas",
  "description": "Generate unique AISMR video ideas",
  "steps": [
    {
      "id": "remember_past",
      "type": "tool",
      "tool": "memory.search",
      "input": {
        "query": "past AISMR ideas for {{topic}}",
        "memoryTypes": ["episodic"],
        "limit": 10
      }
    },
    {
      "id": "generate",
      "type": "llm",
      "prompt": "Generate 12 unique AISMR ideas about {{topic}}...",
      "model": "gpt-4o-mini"
    },
    {
      "id": "validate",
      "type": "validation",
      "rules": ["uniqueness", "count=12", "format"]
    },
    {
      "id": "store",
      "type": "tool",
      "tool": "memory.store",
      "input": {
        "content": "Generated ideas: {{ideas}}",
        "memoryType": "episodic",
        "tags": ["idea-generation"]
      }
    }
  ]
}
```

### Step Types

**Tool Steps:**
```json
{
  "type": "tool",
  "tool": "memory.search",  // Any MCP tool
  "input": { ... }
}
```

**LLM Steps:**
```json
{
  "type": "llm",
  "prompt": "Generate {{count}} ideas about {{topic}}",
  "model": "gpt-4o-mini"
}
```

**Clarification Steps:**
```json
{
  "type": "clarify",
  "tool": "clarify.ask",
  "question": "Which option do you prefer?",
  "suggestedOptions": ["A", "B", "C"]
}
```

**Validation Steps:**
```json
{
  "type": "validation",
  "rules": ["uniqueness", "runtime=8.0", "hands<=2"]
}
```

**Parallel Steps:**
```json
{
  "type": "parallel",
  "steps": [
    { "id": "upload_tiktok", ... },
    { "id": "upload_youtube", ... }
  ]
}
```

---

## Variable Resolution

Workflows use mustache-style variables:

```
{{userInput}}     - From workflow input
{{ideas[0]}}      - From previous step output
{{selectedIdea}}  - From clarification response
{{project.name}}  - From project context
```

**Resolution process:**
1. Check workflow input
2. Check previous step outputs
3. Check session context
4. Check project/persona context

---

## Available Workflows (AISMR)

### Generate Ideas

- **Intent:** "generate ideas", "brainstorm concepts", "create video ideas"
- **Input:** `userInput` (string), `count` (number, default: 12)
- **Output:** Array of `{ idea, vibe }` objects
- **Duration:** ~30 seconds

### Write Screenplay

- **Intent:** "write screenplay", "create script", "screenplay from idea"
- **Input:** `idea` (string), `vibe` (string)
- **Output:** Complete screenplay with timing
- **Duration:** ~45 seconds
- **Validates:** Runtime 8.0s, whisper at 3.0s, max 2 hands

### Generate Video

- **Intent:** "generate video", "produce video", "create video"
- **Input:** `screenplay` (object)
- **Output:** `videoUrl`, `videoId`, `duration`
- **Duration:** ~3 minutes
- **Delegated:** n8n workflow (API calls)

### Upload to TikTok

- **Intent:** "upload to tiktok", "publish video", "post to tiktok"
- **Input:** `videoUrl`, `title`, `description`, `hashtags`
- **Output:** `postUrl`, `postId`, `publishedAt`
- **Duration:** ~30 seconds
- **Delegated:** n8n workflow (TikTok API)

### Complete Video Production

- **Intent:** "create complete video", "full video pipeline", "idea to upload"
- **Chains:** Ideas → Selection → Screenplay → Video → Upload
- **Duration:** ~5 minutes total

---

## Creating New Workflows

### 1. Define Workflow

```typescript
const workflowDef = {
  name: "My Custom Workflow",
  description: "What this workflow does",
  steps: [
    { id: "step1", type: "tool", ... },
    { id: "step2", type: "llm", ... },
    { id: "step3", type: "validation", ... }
  ]
};
```

### 2. Store as Memory

```typescript
await memory_store({
  content: "Description that captures intent",
  memoryType: "procedural",
  project: ["your-project"],
  tags: ["workflow", "custom"],
  metadata: { workflow: workflowDef }
});
```

### 3. Test Discovery

```typescript
const discovery = await discoverWorkflow({
  intent: "what this workflow does",
  project: "your-project"
});

// Should find your workflow
console.log(discovery.workflows[0].name);
```

### 4. Execute

```typescript
await executeWorkflow({
  workflowId: discovery.workflows[0].workflowId,
  input: { /* your inputs */ }
});
```

---

## Best Practices

### Good Workflow Descriptions

✅ **Good:** "Generate unique AISMR video ideas based on user topic, validate uniqueness against archive, return 12 ideas"

❌ **Bad:** "Idea generation workflow"

**Why:** Semantic search works better with descriptive content

### Good Step IDs

✅ **Good:** `remember_past_ideas`, `generate_unique_ideas`, `validate_uniqueness`

❌ **Bad:** `step1`, `step2`, `step3`

**Why:** Readable, debuggable, self-documenting

### Input Validation

✅ **Do:** Validate inputs in first step
✅ **Do:** Provide defaults where sensible
✅ **Do:** Document required vs optional

### Error Handling

✅ **Do:** Add validation steps after critical operations
✅ **Do:** Store partial results before failure points
✅ **Do:** Use metadata to track workflow state

---

## Debugging

### Workflow Not Found

```typescript
// Check if stored
const search = await memory_search({
  query: "your workflow description",
  memoryTypes: ["procedural"],
  project: "your-project"
});

// Should return your workflow
console.log(search.memories);
```

### Discovery Returns Wrong Workflow

- Make description more specific
- Add relevant tags
- Check project filter
- Review similarity scores

### Execution Fails

```typescript
// Check run status
const status = await getWorkflowStatus({
  workflowRunId: "run-abc-123"
});

console.log(status.error); // Error details
```

---

## Migration from V1

V1 workflows are migrated to procedural memories:

```bash
npm run migrate:workflows
```

**Migrated:**
- 4 AISMR workflows
- All steps preserved
- Variable resolution patterns
- Guardrails and validation

**Changes:**
- Discovery by intent (not by name reference)
- Stored as memories (not hardcoded)
- Semantic ranking (not exact match)

---

## Next Steps

- Read [MCP_TOOLS.md](MCP_TOOLS.md) for tool reference
- Read [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) for agent behavior
- See [NORTH_STAR.md](../NORTH_STAR.md) for complete example
