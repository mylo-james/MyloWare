# MCP Tool Descriptions - AI Agent Improvements

## Problem

The AI agent in n8n wasn't calling MCP tools because the descriptions were too technical and didn't explain:

- **When** to use each tool
- **Why** to use it
- **What order** to call them in
- **How** they fit into the AISMR workflow

## Solution

Enhanced all tool descriptions to be AI-agent-friendly with:

1. ✅ Clear visual indicators (🎯, 📊, ✅, 🧠, 💾)
2. ✅ "When to use" sections
3. ✅ "AISMR Workflow Context" showing step sequence
4. ✅ Practical examples
5. ✅ Explicit instructions (e.g., "ALWAYS CALL THIS FIRST", "Call for EACH candidate")

## Tools Improved

### 1. `prompt_get` - Load workflow instructions

**Before:** "Fetch the canonical prompt document..."  
**After:** "🎯 **ALWAYS CALL THIS FIRST** when starting any AISMR or project workflow."

**Key additions:**

- Explains it loads the complete workflow instructions
- Shows when to use: "At the START of any conversation about generating ideas"
- Example: `{persona_name: "ideagenerator", project_name: "aismr"}`
- Emphasizes: "The returned workflow.steps array contains the exact sequence"

### 2. `conversation_remember` - Recall past work

**Before:** "Instantly pull the most relevant past conversation turns..."  
**After:** "🧠 **Call this EARLY** to load session memory before generating new ideas."

**Key additions:**

- Workflow context: "Step 1 of AISMR idea generation workflow"
- Explains: "avoid repeating ideas you already generated"
- Example: `{query: "AISMR ideas or feedback this session", sessionId: "uuid"}`

### 3. `video_ideas_snapshot` - Load existing ideas

**Before:** "Fetch a bulk snapshot of video ideas..."  
**After:** "📊 **Call this EARLY in idea generation workflows** to get a bulk snapshot."

**Key additions:**

- Workflow context: "Step 2 (after loading workflow with prompt_get)"
- Shows full workflow sequence numbered 1-6
- Example: `{projectId: "uuid-from-workflow", status: ["idea_gen", "complete"]}`
- Tip: "Returns an array to avoid"

### 4. `video_query` - Check uniqueness

**Before:** "Check if a 2-word idea already exists..."  
**After:** "✅ **Call this for EACH candidate idea** to verify it doesn't already exist."

**Key additions:**

- Workflow context: "Step 5 of AISMR idea generation workflow"
- Emphasis: "FOR EACH of your 15+ candidate ideas"
- Shows sequence: Load workflow → Memory → Bulk ideas → Candidates → **Check each** → Filter
- Example: `{idea: "velvet puppy", fuzzyMatch: true}`
- Tip: "If exists=false, it's unique and can be used!"

### 5. `conversation_store` - Save results

**Before:** "Persist any conversation turn..."  
**After:** "💾 **Call this at the END** of workflows to save your work."

**Key additions:**

- Workflow context: "Step 7 (FINAL STEP)"
- Shows complete workflow with all steps
- Example: `{sessionId: "uuid", role: "assistant", content: "Generated 12...", tags: ["ideas"]}`
- Tip: "Makes your work searchable via conversation_remember"

## Expected Impact

The AI agent should now:

1. ✅ **Know to call `prompt_get` first** to load workflow instructions
2. ✅ **Understand the sequence** of tools to call
3. ✅ **See the big picture** of the AISMR workflow
4. ✅ **Use correct parameters** from the examples
5. ✅ **Call tools in the right order** following the numbered steps

## Testing

To test if the AI agent can now follow the workflow:

```bash
# 1. Restart the server to load new descriptions
npm run dev:down && npm run dev:up

# 2. In n8n, trigger the AISMR idea generation workflow with:
"Generate 12 AISMR video ideas about puppies"

# 3. The AI should now:
- Call prompt_get with {persona_name: "ideagenerator", project_name: "aismr"}
- Call conversation_remember to check past ideas
- Call video_ideas_snapshot to load existing ideas
- Generate 15+ candidates
- Call video_query for each candidate
- Filter to 12 unique ideas
- Call conversation_store to save results
```

## Files Modified

- `src/server/tools/promptGetTool.ts` - Added workflow context
- `src/server/tools/conversationMemoryTool.ts` - Added early-step guidance
- `src/server/tools/videoIdeasTool.ts` - Added snapshot guidance
- `src/server/tools/videoQueryTool.ts` - Added per-idea checking emphasis
- `src/server/tools/conversationStoreTool.ts` - Added end-step guidance

## Next Steps

If the AI agent still doesn't call tools:

1. Check the system message in n8n includes tool-calling instructions
2. Verify the AI model supports function calling (GPT-4, Claude 3+)
3. Check that tool schemas are properly formatted in the MCP protocol
4. Add more examples in the n8n system message showing the exact tool call sequence
