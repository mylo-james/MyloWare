# Migration Summary: Prompts vs Workflows

## What Changed

We've restructured the architecture to cleanly separate **Prompts** (semantic guidance) from **Workflows** (programmatic execution).

### Before
```
workflow_discover tool → Search procedural memories → Return workflow candidates
workflow_execute tool → Look up in workflow_registry → Delegate to n8n
```

### After
```
MCP Prompt API → Load from procedural memories → Return semantic guidance
AI decides → Call n8n workflows directly (toolWorkflow) OR use memory tools
```

---

## Key Changes

### 1. ✅ Dynamic MCP Prompt API
**File**: `src/mcp/prompts.ts`

- Now loads prompts dynamically from procedural memories at server startup
- Each procedural memory with `metadata.workflow` becomes an MCP prompt
- Prompts return formatted guidance with steps, guardrails, and output formats

**Example**:
```typescript
// AI calls:
await get_prompt("generate-ideas", { input: '{"topic": "puppies"}' });

// Returns:
# Generate Ideas

Generate 12 unique AISMR video ideas...

## Steps to accomplish this:
1. Retrieve past ideas from episodic memory
2. Search archive for similar ideas
3. Generate 12 unique AISMR ideas using LLM
...

## How to Execute:
Use the n8n workflow tools available (toolWorkflow nodes)
You can also use memory_search and memory_store tools
```

### 2. ✅ Removed Workflow Tools
**File**: `src/mcp/tools.ts`

**Removed**:
- `workflow_discover` - No longer needed (use MCP `list_prompts`)
- `workflow_execute` - No longer needed (AI calls n8n workflows directly)
- `workflow_status` - No longer needed

**Kept/Added**:
- `memory_search` / `memory_store` / `memory_evolve` / `memory_searchByRun` - Memory primitives
- `context_get_persona` / `context_get_project` - Context retrieval
- `trace_create` / `handoff_to_agent` / `workflow_complete` - Trace-based coordination
- `session_get_context` / `session_update_context` - Session lifecycle helpers
- (Removed) The old `clarify_ask` interaction tool is now handled by Telegram HITL nodes instead of an MCP tool.

### 3. ✅ Async Server Initialization
**File**: `src/server.ts`

Added `initializeMCPServer()` function that runs before server starts:
- Registers MCP tools
- Registers MCP resources
- **Loads prompts from database** (async operation)

### 4. ✅ Deprecated workflow_registry Table

The `workflow_registry` table is **no longer used**:
- Prompts don't need to be mapped to n8n workflows
- AI gets semantic guidance from prompts
- AI calls n8n workflows directly via toolWorkflow nodes in `agent.workflow.json`

**Migration**: You can drop this table or keep it for backwards compatibility during transition.

### 5. ✅ New Architecture Documentation
**File**: `ARCHITECTURE.md`

Complete guide explaining:
- Prompts vs Workflows vs Tools
- How the system works end-to-end
- Common patterns
- Migration examples

---

## What Still Works

### Procedural Memories
- Still stored in `memories` table with `memory_type = 'procedural'`
- Still contain `metadata.workflow` with prompt definitions
- Seeding scripts (`npm run db:seed:workflows`) still work

### n8n Workflows
- Still defined in `workflows/` directory
- Still imported to n8n via `npm run import:workflows`
- Still exposed as toolWorkflow nodes in `agent.workflow.json`

### Memory Tools
- All memory operations work exactly as before
- `memory_search`, `memory_store`, `memory_evolve` unchanged

---

## How to Use

### 1. AI Discovers Available Prompts
```typescript
// n8n agent automatically sees available prompts via MCP Prompt API
const prompts = await list_prompts();
// Returns: ["generate-ideas", "write-script", "make-videos", "post-video", "memory-chat"]
```

### 2. AI Gets Semantic Guidance
```typescript
const prompt = await get_prompt("write-script", {
  input: JSON.stringify({ idea: "AISMR about rain" })
});

// Returns full description of what to accomplish and how
```

### 3. AI Implements Using Available Tools

**Option A: Follow Steps Using Memory Tools**
```typescript
// Step 1: Retrieve past quality issues
await memory_search({
  query: "screenplay quality issues",
  memoryTypes: ["episodic"]
});

// Step 2: Generate screenplay
// (AI uses its own LLM capabilities)

// Step 3: Store results
await memory_store({
  content: "Screenplay for rain AISMR...",
  memoryType: "episodic"
});
```

**Option B: Delegate to n8n Workflow**
```typescript
// Call the "Generate Video" toolWorkflow node
// (available in agent.workflow.json)
```

**Option C: Hybrid Approach**
```typescript
// Use memory_search for context
// Call n8n workflow for heavy lifting
// Use memory_store for tracking
```

---

## Testing

### 1. Check Prompts Are Loading
```bash
# Start server
npm run dev

# Check logs for:
# "MCP prompts registered dynamically from procedural memories"
# count: 4  (or however many procedural memories you have)
```

### 2. Test from n8n Agent
In your n8n agent workflow:
- The AI should now see prompts in its available prompts
- Can call `get_prompt` to get guidance
- Can use toolWorkflow nodes to call n8n workflows
- Can use memory tools for state management

### 3. Verify Build
```bash
npm run build
# Should complete with no errors
```

---

## Breaking Changes

### ❌ `workflow_discover` Tool Removed
**Before**:
```typescript
await workflow_discover({ intent: "create video" });
```

**After**:
```typescript
// Use MCP Prompt API (handled automatically by n8n MCP client)
const prompts = await list_prompts();
const prompt = await get_prompt("make-videos");
```

### ❌ `workflow_execute` Tool Removed
**Before**:
```typescript
await workflow_execute({
  workflowId: "cc55a52b-...",  // Memory ID
  input: { topic: "puppies" }
});
```

**After**:
```typescript
// AI calls n8n workflow directly via toolWorkflow node
// OR implements steps using memory tools
```

### ❌ `workflow_registry` Table No Longer Used
**Before**:
- Required mapping: memory_id → n8n_workflow_id
- Used by `workflow_execute` to find which n8n workflow to call

**After**:
- Not needed - AI calls n8n workflows directly
- Prompts provide semantic guidance only

---

## Rollback Plan

If you need to rollback:

1. Revert changes to these files:
   - `src/mcp/prompts.ts`
   - `src/mcp/tools.ts`
   - `src/server.ts`

2. Run:
   ```bash
   git checkout HEAD~1 src/mcp/prompts.ts src/mcp/tools.ts src/server.ts
   npm run build
   npm restart
   ```

3. Ensure `workflow_registry` table has mappings

---

## Next Steps

1. **Test with your n8n agent**
   - Verify prompts are visible
   - Test getting prompt guidance
   - Test calling workflows

2. **Update your workflows**
   - Ensure toolWorkflow nodes are properly configured
   - Test end-to-end flows

3. **Optional: Clean up**
   - Drop `workflow_registry` table if not needed
   - Remove old workflow tool files from backups

4. **Monitor**
   - Check logs for prompt loading
   - Verify AI can access prompts
   - Test complete video production flow

---

## Questions?

See `ARCHITECTURE.md` for detailed explanations of the new system.

**Key Insight**: Prompts tell the AI **WHAT** to do (semantic guidance). The AI then decides **HOW** to do it using n8n workflows (programmatic tools) or memory operations.
