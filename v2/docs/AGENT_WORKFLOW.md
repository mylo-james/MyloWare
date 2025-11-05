# Agent Workflow Guide

The agent workflow is a single n8n workflow that handles all user interactions.

---

## Overview

```
User Message (Telegram)
    ↓
Extract Context
    ↓
AI Agent (GPT-4o-mini + MCP Tools)
    ↓
Reply to User
```

**One agent node. That's it.**

---

## The Agent Node

**Configuration:**
- **Model:** `gpt-4o-mini` (default for all OpenAI calls)
- **Temperature:** 0.7 (balanced creativity/consistency)
- **System Prompt:** Agentic RAG pattern
- **Tools:** All 11 MCP tools available

### System Prompt

```
You are Casey, an agentic AI assistant.

YOUR PROCESS (Agentic RAG):

1. ASSESS
   - Understand user intent
   - Is this clear or ambiguous?

2. CLARIFY (if needed)
   - Ask questions naturally
   - Use clarify_ask for options

3. CONTEXT
   - Load persona: context_get_persona({personaName})
   - Load project: context_get_project({projectName})
   - Load session: session_get_context({sessionId})

4. SEARCH
   - Query relevant memories: memory_search({query, memoryTypes, project})
   - Decide what's relevant
   - Don't always search (only when needed)

5. DECIDE
   - Does this need a workflow?
   - If yes: workflow_discover({intent, project})
   - If no: respond with what you know

6. EXECUTE
   - Run workflow: workflow_execute({workflowId, input})
   - Or respond directly

7. STORE
   - Remember interaction: memory_store({content, memoryType, project, tags})

MEMORY TYPES:
- episodic: Conversations, interactions
- semantic: Facts, specs, rules
- procedural: Workflows, processes

KEY PRINCIPLES:
- You decide when to retrieve (don't always search)
- You decide what to retrieve (types, filters)
- Ask clarifying questions naturally
- Explain your reasoning concisely
- Be warm and conversational
```

---

## Example: Complete Flow

### User Message
```
"Create an AISMR video about rain sounds"
```

### Agent Reasoning
```
1. ASSESS
   Intent: Create video production workflow
   Clarity: High (clear request)

2. CONTEXT
   Persona: casey (loaded)
   Project: aismr (loaded with guardrails)
   Session: telegram:6559268788 (loaded)

3. SEARCH
   Query: "past AISMR rain ideas"
   Found: User prefers gentle rain over storms

4. DECIDE
   Needs workflow: Yes
   Intent: "create complete AISMR video"

5. EXECUTE
   Discovered: "Complete Video Production" workflow
   Steps: Ideas → Selection → Screenplay → Video → Upload
   Starting execution...

6. RESPOND
   "I'll generate 12 ideas, have you pick your favorite,
    write the screenplay, produce the video, and upload
    it to TikTok. Starting now..."

7. STORE
   Memory: "Started complete video production for rain sounds"
```

---

## Decision Making

### When to Search Memory

✅ **Search when:**
- User references past ("like last time")
- Context would improve response ("rain ideas")
- Need to check constraints ("AISMR specs")

❌ **Don't search when:**
- Question is self-contained ("what time is it?")
- No relevant context exists (new topic)
- Overhead isn't worth it (simple math)

### When to Discover Workflow

✅ **Discover when:**
- User requests action ("create", "generate", "make")
- Task involves multiple steps
- Project has relevant workflows

❌ **Don't discover when:**
- Simple information request
- Just chatting
- Direct response is better

### When to Clarify

✅ **Clarify when:**
- Intent is ambiguous
- Multiple valid interpretations
- Missing critical information

❌ **Don't clarify when:**
- Intent is clear
- Can infer from context
- Too many questions annoy user

---

## Workflow Execution

### Direct Execution (Phase 5)

Agent executes workflow steps itself using MCP tools:

```
workflow_execute returns workflowRunId
  ↓
Agent reads workflow.steps
  ↓
For each step:
  - If tool: memory.search → call memory_search
  - If llm: generate → use own capabilities
  - If clarify: ask → call clarify_ask
  ↓
Store results and continue
```

### Delegated Execution (Future)

Some workflows delegate to n8n for heavy operations:

```
workflow_execute({
  workflowId: "generate-video",
  input: { screenplay },
  waitForCompletion: true
})
  ↓
MCP server triggers n8n workflow
  ↓
n8n handles video generation (3 min)
  ↓
Returns video URL to agent
```

---

## Session Management

### Session ID Format

```
telegram:${chatId}  // e.g., "telegram:6559268788"
uuid:${sessionId}   // e.g., for API calls
```

### Context Storage

```typescript
// Working memory stored in session
{
  lastIntent: "generate-ideas",
  lastWorkflowRun: "run-abc-123",
  recentTopics: ["rain", "cozy"],
  preferences: { style: "gentle" },
  conversationHistory: [
    { role: "user", content: "...", timestamp: "..." },
    { role: "assistant", content: "...", timestamp: "..." }
  ]
}
```

### Context Persistence

- Survives Docker restarts (Postgres)
- Accessible across conversations
- Agent can resume interrupted tasks

---

## Memory Storage

After each significant interaction:

```typescript
await memory_store({
  content: cleanForAI(interactionSummary),
  memoryType: 'episodic',
  project: ['aismr'],
  tags: ['workflow-execution', 'idea-generation'],
  metadata: {
    workflowRunId: '...',
    duration: 300,
    outcome: 'success'
  }
});
```

**What to store:**
- User requests and agent responses
- Workflow executions and outcomes
- User preferences discovered
- Important decisions made

**What NOT to store:**
- Casual greetings
- System errors (log instead)
- Temporary state (use session context)
- Redundant information

---

## Configuration

### n8n Workflow JSON

Located at: `workflows/agent.workflow.json`

**Key settings:**
```json
{
  "nodes": [
    {
      "type": "n8n-nodes-base.openAiAgent",
      "parameters": {
        "model": "gpt-4o-mini",
        "systemPrompt": "...",
        "temperature": 0.7,
        "mcpServers": [
          {
            "url": "http://mcp-server:3000"
          }
        ]
      }
    }
  ]
}
```

### Environment Variables

```bash
# MCP Server
MCP_SERVER_URL=http://mcp-server:3000
MCP_AUTH_KEY=your-key-here

# OpenAI
OPENAI_API_KEY=sk-...

# Telegram (optional)
TELEGRAM_BOT_TOKEN=...
```

---

## Testing

### Manual Testing

1. Send message via Telegram
2. Check agent response
3. Verify workflow execution
4. Check memory storage

### Automated Testing

```bash
# Unit tests (individual tools)
npm run test:unit

# Integration tests (tool combinations)
npm run test:integration

# E2E tests (complete flows)
npm run test:e2e
```

---

## Monitoring

### Logs

```bash
# Watch agent logs
docker compose logs -f n8n

# Watch MCP server logs
docker compose logs -f mcp-server
```

### Metrics

```bash
# Tool call duration
curl http://localhost:3000/metrics | grep mcp_tool_call_duration

# Memory search performance
curl http://localhost:3000/metrics | grep memory_search_duration
```

### Health Check

```bash
curl http://localhost:3000/health
```

---

## Troubleshooting

### Agent not responding

1. Check n8n is running: `docker compose ps`
2. Check MCP server health: `curl http://localhost:3000/health`
3. Check Telegram webhook: n8n execution log

### Tools failing

1. Check MCP server logs: `docker compose logs mcp-server`
2. Verify database connection
3. Verify OpenAI API key

### Memory search returning no results

1. Check if memories exist: `npm run db:seed`
2. Verify embeddings generated
3. Check search parameters

---

## Next Steps

- Read [WORKFLOW_DISCOVERY.md](WORKFLOW_DISCOVERY.md) to understand workflow discovery
- Read [MCP_TOOLS.md](MCP_TOOLS.md) for complete tool reference
- See [NORTH_STAR.md](../NORTH_STAR.md) for the complete vision
