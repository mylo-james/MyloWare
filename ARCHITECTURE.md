# Architecture: Prompts vs Workflows

This document explains the architectural split between **Prompts** and **Workflows** in MCP Prompts V2.

## Core Concepts

### 🎯 Prompts (Semantic/Declarative)
- **What they are**: Stored as procedural memories in the database
- **Purpose**: Semantic guidance that tells the AI **WHAT** to accomplish and **WHY**
- **Exposure**: Available via MCP Prompt API (`list_prompts`, `get_prompt`)
- **Format**: Declarative descriptions with steps, guardrails, and output formats
- **Examples**: "Generate Ideas", "Write Script", "Make Videos", "Post Video"

### ⚙️ Workflows (Programmatic/Executable)
- **What they are**: n8n workflows with actual nodes and connections
- **Purpose**: Programmatic implementations that execute **HOW** to do something
- **Exposure**: Available as `toolWorkflow` nodes in `agent.workflow.json`
- **Format**: JSON workflow definitions with triggers, code nodes, API calls
- **Examples**: "Generate Video", "Upload to TikTok", "Edit AISMR"

### 🔧 MCP Tools (Atomic Operations)
- **What they are**: Focused utility tools for memory and session management
- **Purpose**: Core operations the AI uses to manage state and context
- **Exposure**: Registered as MCP tools via `registerMCPTools()`
- **Examples**: `memory_search`, `memory_store`, `memory_evolve`, `clarify_ask`

---

## How It Works

```
┌────────────────────────────────────────────────────────────┐
│ User Request: "Create an AISMR video about puppies"        │
└────────────────────────────────────────────────────────────┘
                           ↓
┌────────────────────────────────────────────────────────────┐
│ 1. AI sees available PROMPTS via MCP Prompt API            │
│    - generate-ideas                                         │
│    - write-script                                           │
│    - make-videos                                            │
│    - post-video                                             │
└────────────────────────────────────────────────────────────┘
                           ↓
┌────────────────────────────────────────────────────────────┐
│ 2. AI calls get_prompt("generate-ideas")                   │
│                                                             │
│    Returns:                                                 │
│    # Generate Ideas                                         │
│                                                             │
│    Generate 12 unique AISMR video ideas...                 │
│                                                             │
│    ## Steps:                                                │
│    1. Retrieve past ideas from episodic memory              │
│    2. Search archive for similar ideas                      │
│    3. Generate 12 unique AISMR ideas using LLM              │
│    4. Perform final uniqueness audit                        │
│    5. Store generated ideas in episodic memory              │
│                                                             │
│    ## How to Execute:                                       │
│    Use the n8n workflow tools available (toolWorkflow)      │
│    You can also use memory_search and memory_store          │
└────────────────────────────────────────────────────────────┘
                           ↓
┌────────────────────────────────────────────────────────────┐
│ 3. AI decides HOW to implement the steps:                  │
│                                                             │
│    a) Use memory_search to retrieve past ideas             │
│    b) Call n8n workflow "Generate Video" (if exists)       │
│    c) Use memory_store to save results                     │
└────────────────────────────────────────────────────────────┘
```

---

## File Organization

### Prompts (Data Layer)
```
data/workflows/
  ├── aismr-idea-generation-workflow.json        # Prompt definition
  ├── aismr-screenplay-workflow.json             # Prompt definition
  ├── aismr-video-generation-workflow.json       # Prompt definition
  └── aismr-publishing-workflow.json             # Prompt definition

Stored in database as:
  memories.memory_type = 'procedural'
  memories.metadata.workflow = { name, description, steps, ... }
```

### Workflows (Execution Layer)
```
workflows/
  ├── agent.workflow.json                 # Main agent with toolWorkflow nodes
  ├── edit-aismr.workflow.json            # Executable n8n workflow
  ├── generate-video.workflow.json        # Executable n8n workflow
  └── upload-tiktok.workflow.json         # Executable n8n workflow
```

### MCP Implementation
```
src/mcp/
  ├── prompts.ts          # Dynamically loads prompts from DB
  ├── tools.ts            # Registers memory + utility tools
  ├── resources.ts        # Exposes personas, projects as resources
  └── handlers.ts         # Wires everything together
```

---

## Database Schema

### Procedural Memories (Prompts)
```sql
CREATE TABLE memories (
  id UUID PRIMARY KEY,
  memory_type TEXT NOT NULL,  -- 'procedural' for prompts
  content TEXT NOT NULL,      -- Human-readable description
  summary TEXT,               -- Auto-generated summary
  metadata JSONB,             -- Contains 'workflow' object with prompt definition
  ...
);

-- Example metadata.workflow:
{
  "name": "Generate Ideas",
  "description": "Generate 12 unique AISMR video ideas...",
  "steps": [
    {
      "id": "retrieve_past",
      "step": 1,
      "type": "mcp_call",
      "description": "Retrieve past ideas from episodic memory",
      "mcp_call": {
        "tool": "memory_search",
        "params": { "query": "...", "memoryTypes": ["episodic"] }
      }
    },
    ...
  ],
  "output_format": { ... },
  "guardrails": [ ... ]
}
```

### ~~Workflow Registry~~ (DEPRECATED)
The `workflow_registry` table is **no longer needed** because:
- Prompts are exposed via MCP Prompt API (no need for discovery tool)
- n8n workflows are called directly by AI via toolWorkflow nodes
- No need to map prompt IDs → workflow IDs

---

## Migration Guide

### Before (Old Architecture)
```typescript
// AI discovers workflows using custom tool
await workflow_discover({ intent: "generate video ideas" });

// AI executes via workflow_execute
await workflow_execute({
  workflowId: "cc55a52b-b7b0-4e75-ba9d-02b082d5c62c",  // Memory ID
  input: { topic: "puppies" }
});

// System looks up n8n workflow ID from workflow_registry
// Then delegates to n8n
```

### After (New Architecture)
```typescript
// AI sees prompts via MCP Prompt API
const prompts = await list_prompts();
// Returns: ["generate-ideas", "write-script", "make-videos", ...]

// AI gets semantic guidance
const prompt = await get_prompt("generate-ideas", { topic: "puppies" });
// Returns: Full description of what to do and how

// AI implements using available tools:
// 1. memory_search - find past ideas
// 2. Call n8n "Generate Video" workflow directly (toolWorkflow node)
// 3. memory_store - save results
```

---

## Benefits of New Architecture

### ✅ Cleaner Separation of Concerns
- **Prompts** = guidance/knowledge (what/why)
- **Workflows** = execution (how)
- **Tools** = utilities (operations)

### ✅ Standards-Compliant
- Uses MCP Prompt API instead of custom discovery/execution tools
- n8n agent can leverage native MCP capabilities

### ✅ More Flexible
- AI can choose to:
  - Follow prompt steps using memory tools
  - Call n8n workflows directly
  - Combine both approaches

### ✅ Easier to Maintain
- Prompts live in database (version-controlled via seed scripts)
- Workflows live in n8n (visual editing)
- No complex mapping table needed

### ✅ Better DX for AI
- Prompts provide semantic context
- AI sees clear guidance on what to accomplish
- AI has freedom to choose implementation approach

---

## Common Patterns

### Pattern 1: AI Follows Prompt Steps
```
User: "Generate video ideas about rain"

AI:
1. Calls get_prompt("generate-ideas")
2. Reads steps from prompt
3. Implements each step using memory_search, memory_store
4. Returns 12 ideas
```

### Pattern 2: AI Delegates to Workflow
```
User: "Generate a video"

AI:
1. Calls get_prompt("make-videos")
2. Sees it needs video generation
3. Calls n8n "Generate Video" workflow (toolWorkflow)
4. Workflow handles API calls, polling, editing
5. Returns video URL
```

### Pattern 3: Hybrid Approach
```
User: "Create an AISMR video"

AI:
1. Calls get_prompt("aismr-video-creation")
2. Step 1: Uses memory_search to find past ideas
3. Step 2: Uses clarify_ask to get user input
4. Step 3: Calls n8n "Generate Video" workflow
5. Step 4: Uses memory_store to save metadata
```

---

## Key Takeaways

1. **Prompts ≠ Workflows**
   - Prompts guide (semantic)
   - Workflows execute (programmatic)

2. **Use MCP Prompt API**
   - Don't create custom discovery tools
   - Let MCP SDK handle prompt exposure

3. **Keep Tools Focused**
   - Memory operations
   - Session management
   - Utility functions

4. **Let n8n Handle Complexity**
   - API integrations
   - Long-running processes
   - Visual workflow building

5. **Store Knowledge in Prompts**
   - Best practices
   - Guardrails
   - Domain knowledge

---

## See Also

- [MCP Specification - Prompts](https://spec.modelcontextprotocol.io/specification/architecture/prompts/)
- [n8n Workflow Documentation](https://docs.n8n.io/)
- [Setup Guide](./docs/SETUP_GUIDE.md)

