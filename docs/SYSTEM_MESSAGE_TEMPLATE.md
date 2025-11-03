# System Message Template for Agentic RAG

**Purpose**: Minimal, goal-oriented system messages that enable agents to self-discover their instructions via RAG tools.

**Design Principle**: Trust the agent's tools, not prescriptive instructions.

---

## Template Pattern (30-50 words)

```
You are [Name], [role].

Identity: persona="[slug]", project="[slug or null]"

Goal: [One sentence describing what you accomplish]

Bootstrap: Load your configuration and context, then execute.
Use your tools as needed.
```

---

## Examples

### Chat Orchestrator

```
You are Casey, conversational orchestrator.

Identity: persona="chat", project=null

Goal: Help users with context-aware responses.

Bootstrap: Load your configuration, recall conversation context, then respond.
Use your tools as needed.
```

**Word Count**: 35 words

### Idea Generator (with Project)

```
You are Iggy, idea generator for AISMR.

Identity: persona="ideagenerator", project="aismr"

Goal: Generate 12 unique AISMR video ideas with validated uniqueness.

Bootstrap: Load your workflow, check past work, then execute.
Use your tools to discover specifications and validate uniqueness.
```

**Word Count**: 38 words

### Screenwriter (with Project)

```
You are Sloane, screenwriter for AISMR.

Identity: persona="screenwriter", project="aismr"

Goal: Transform ideas into validated AISMR screenplays with exact timing and specs.

Bootstrap: Load your workflow, recall specifications, then execute.
Use your tools as needed.
```

**Word Count**: 37 words

---

## Design Principles

### ✅ DO: Goal-Oriented

- **One clear sentence** describing what the agent accomplishes
- **Identity metadata** (persona/project) for RAG tool queries
- **Bootstrap mention** that encourages self-discovery
- **Tool autonomy** - "Use your tools as needed"

### ❌ DON'T: Prescriptive

- **No step-by-step instructions** (e.g., "1. Do X, 2. Do Y")
- **No explicit tool call sequences** (e.g., "Call prompt_get then conversation_remember")
- **No rigid workflows** embedded in system message
- **No verbose explanations** (keep under 50 words)

---

## Why This Enables Agentic RAG

### Self-Discovery Pattern

1. **Agent receives minimal identity** (persona + project)
2. **Agent queries RAG tools** to discover instructions:
   - `prompt_get({persona_name, project_name})` → loads complete workflow
   - `prompt_search({query: "workflow", project, persona})` → finds relevant specs
   - `conversation_remember({query: "past work"})` → recalls context
3. **Agent executes discovered workflow** autonomously
4. **Agent queries for clarifications** when needed

### Alignment with RAG Best Practices

Per `rag_docs.txt`:

> "Adaptive RAG systems allow an agent to **decide if additional knowledge is needed**, form search queries, and **iteratively refine retrieval** using intermediate reasoning."

**This template enables exactly that**:
- Agent decides what to retrieve based on identity
- Agent forms queries dynamically (not pre-scripted)
- Agent iteratively refines understanding via multiple tool calls
- Agent maintains context-awareness through metadata filtering

### Tool Description Integration

The enhanced tool descriptions guide the agent:

- **`prompt_search`**: Explains how to query for own instructions
- **`prompt_get`**: Clarifies combination vs separate loading
- **`conversation_remember`**: Shows self-referential query patterns

The system message provides **identity**, and the tools provide **discovery guidance**.

---

## Anti-Patterns

### ❌ Prescriptive System Message

```
Required Steps:
1. Load persona using prompt_search_adaptive and prompt_get for the persona "ideagenerator"
2. Load project using prompt_search_adaptive and prompt_get for the project "aismr"
3. Load the past conversation with conversation_remember
4. Handle user input using any tools provided.
5. Respond to user with tool execution results
```

**Problems**:
- Tells agent exactly what to do (not agentic)
- Assumes agent doesn't know how to use tools
- Defeats purpose of RAG self-discovery
- Too verbose (80+ words)

### ✅ Minimal System Message

```
You are Iggy, idea generator for AISMR.

Identity: persona="ideagenerator", project="aismr"

Goal: Generate 12 unique AISMR video ideas with validated uniqueness.

Bootstrap: Load your workflow, check past work, then execute.
Use your tools as needed.
```

**Benefits**:
- Agent discovers workflow via RAG tools
- Agent decides when to use tools
- Enables true agentic behavior
- Concise (38 words)

---

## Migration Guide

### Step 1: Identify Identity

- Extract persona from current system message
- Extract project (if any) from current system message
- Format as: `persona="[slug]", project="[slug or null]"`

### Step 2: Define Goal

- Condense current workflow description into one sentence
- Focus on **what** the agent accomplishes, not **how**
- Example: "Generate 12 unique AISMR video ideas with validated uniqueness"

### Step 3: Add Bootstrap

- One sentence mentioning loading config/context
- Encourage tool usage: "Use your tools as needed"

### Step 4: Remove Prescriptive Content

- Delete all step-by-step instructions
- Delete explicit tool call sequences
- Delete verbose explanations
- Keep only identity + goal + bootstrap

### Step 5: Verify

- Word count under 50 words
- Contains persona/project identity
- Goal is one clear sentence
- No step-by-step instructions
- Encourages tool autonomy

---

## Testing Checklist

After updating a system message:

- [ ] Agent successfully discovers configuration (check logs for `prompt_get`/`prompt_search` calls)
- [ ] Agent loads correct combination/persona (not loading separately)
- [ ] Agent executes workflow without rigid instructions
- [ ] Agent queries for clarifications when uncertain (agentic behavior)
- [ ] Output matches expected schema and quality
- [ ] System message is under 50 words
- [ ] No prescriptive instructions remain

---

## Related Documentation

- **RAG Best Practices**: `/docs/rag_docs.txt`
- **Gap Analysis**: `/docs/RAG_BOOTSTRAP_GAPS.md` (if exists)
- **Tool Specifications**: `/docs/tool-specs/`
- **System Summary**: `/docs/SYSTEM-SUMMARY.md`

---

**Last Updated**: 2025-11-03  
**Status**: Active template for all agent workflows

