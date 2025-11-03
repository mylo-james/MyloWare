# RAG Bootstrap Gaps Analysis

**Date**: 2025-11-03  
**Context**: Why agents can't effectively self-discover their instructions via RAG

---

## The Vision (from rag_docs.txt)

Modern agentic RAG systems should allow agents to:
- **Autonomously decide** when and what to retrieve
- **Self-discover** their own instructions by querying the knowledge base
- **Iteratively refine** retrieval based on what they find
- Rely on **good tool descriptions** rather than rigid scripts

### Ideal Flow for "Generate Ideas" Agent

```
System Message (Minimal):
  "You are Iggy, the idea generator for the AISMR project. 
   Load your configuration and handle the user's request."

Agent Reasoning:
  1. "I need my configuration. Let me search for it."
  2. Uses prompt_search: "ideagenerator aismr instructions"
  3. Sees results about workflow, persona, and project specs
  4. Uses prompt_get with persona+project to load full content
  5. Follows the workflow in the loaded prompt
  6. Queries for clarifications as needed
```

---

## Current State

### Tool Descriptions (What LLM Sees)

**prompt_search**: 
> "Swiss-army retrieval across the entire prompt corpus: vector, keyword, or hybrid modes in one tool. Layer on persona/project filters, temporal decay, graph expansion, and memory routing to surface the most relevant snippets."

**prompt_get**:
> "Fetch the canonical prompt document—complete with markdown content and metadata—for a given persona or project. Pass persona_name, project_name, or both to disambiguate overlapping prompts. Ideal for loading an AI Agent persona's system prompt before answering a user."

**conversation_remember**:
> "Instantly pull the most relevant past conversation turns using semantic search, session/user filters, and time ranges. Choose chat, narrative, or bullet formatting so you can drop the recall straight into a response plan."

### System Messages (Current)

**Chat Workflow**:
```
Required Steps
1. Load persona using prompt_search_adaptive and prompt_get for the persona "chat"
2. Load the past conversation with conversation_remember with "recent conversation context"
3. Decide if you have enough information to process user Input otherwise you're free to query as needed. USE search tools!
4. Handle user input using any tools provided.
5. Respond to user with tool execution results
```

**Generate Ideas** (user's attempt):
```
Required Steps
1. Load persona using prompt_search_adaptive and prompt_get for the persona "ideagenerator"
2. Load project using prompt_search_adaptive and prompt_get for the persona "aismr"  // TYPO: should be project
3. Load the past conversation with conversation_remember with "recent conversation context"
4. Decide if you have enough information to process user Input otherwise you're free to query as needed. USE search tools!
5. Handle user input using any tools provided.
6. Respond to user with tool execution results
```

---

## 🔴 Identified Gaps

### Gap 1: Tool Descriptions Don't Mention Self-Discovery

**Problem**: The tool descriptions tell agents they can search prompts, but don't explicitly say "use this to find YOUR OWN instructions"

**Impact**: Agents don't naturally think "I should query for my configuration"

**Fix**: Enhance tool descriptions with self-discovery use cases:

```yaml
prompt_search:
  description: |
    Search across all prompts, including YOUR OWN persona and project instructions.
    
    Use this to:
    - Discover what instructions exist for your persona+project combination
    - Find specifications, workflows, and guidelines you need to follow
    - Query for examples, anti-patterns, and best practices
    - Locate related knowledge via graph expansion
    
    Discovery pattern:
    1. Search with your persona+project context to find relevant instructions
    2. Review the returned chunks to understand what's available
    3. Use prompt_get to load the full content of relevant prompts
```

### Gap 2: No "Bootstrap Pattern" Documented

**Problem**: Agents need to know the pattern: search → discover → retrieve full content

**Impact**: Without this pattern, agents either:
- Don't query for their own config
- Or query ineffectively (wrong parameters, wrong tools)

**Fix**: Add explicit bootstrap pattern to tool descriptions or system message template:

```
Discovery Pattern:
1. Use prompt_search with your persona and project to find your instructions
2. Look for combination prompts (persona + project) first
3. Use prompt_get with both parameters to load the complete workflow
4. If combination not found, load persona and project separately
```

### Gap 3: System Messages Too Prescriptive

**Problem**: Current system messages list exact steps rather than goals + tool awareness

**Impact**: Defeats the purpose of agentic RAG - agent doesn't make decisions

**Fix**: Use goal-oriented system messages:

**Bad** (Current):
```
Required Steps
1. Load persona using prompt_search_adaptive and prompt_get for the persona "chat"
2. Load the past conversation...
```

**Good** (Goal-Oriented):
```
You are Casey, the chat orchestrator.

Goal: Help users with their requests using context-aware responses.

Identity: persona="chat", project=null

Bootstrap: Load your configuration and conversation context, then handle the request.

You have memory and search tools - use them as needed to discover instructions, 
recall context, and find specifications. Query for clarification when uncertain.
```

### Gap 4: Unclear Combination vs Separate Loading

**Problem**: Agents don't understand when to use:
- `prompt_get({ persona: "X", project: "Y" })` → loads combination
- vs loading persona and project separately

**Impact**: Generate Ideas tries to load ideagenerator and aismr separately instead of loading the combination

**Fix**: Clarify in prompt_get description:

```yaml
prompt_get:
  description: |
    Retrieve complete prompt content by persona and/or project.
    
    Resolution Strategy:
    - If BOTH persona+project provided: Returns combination prompt (e.g., ideagenerator×aismr workflow)
    - If only persona: Returns generic persona behavior
    - If only project: Returns project specifications
    
    For task-specific workflows, ALWAYS provide both parameters to get the combination.
    
    Examples:
    - Load combination: { persona_name: "ideagenerator", project_name: "aismr" }
    - Load generic persona: { persona_name: "chat" }
    - Load project specs: { project_name: "aismr" }
```

### Gap 5: Tool Descriptions Generic, Not Agent-Centric

**Problem**: Tool descriptions are written for external users, not for self-referential agents

**Current**: "Search prompts" (third-person)
**Better**: "Search for your instructions, workflows, and specifications" (second-person, self-aware)

**Impact**: Agents don't realize the knowledge base contains THEIR instructions

**Fix**: Make tool descriptions agent-centric:

```yaml
prompt_search:
  agent_perspective: |
    This tool searches the knowledge base that contains YOUR operating instructions,
    workflows, and specifications. Use it to:
    - Find what instructions exist for your persona+project
    - Discover workflows you should follow
    - Look up specifications and constraints
    - Query for examples and anti-patterns
    
    Self-discovery queries:
    - "What are my instructions for [project]?"
    - "[persona] [project] workflow"
    - "How should I [task]?"
```

### Gap 6: No Metadata Guidance in Search Results

**Problem**: When agents search, they get chunks but may not understand that `metadata.persona` and `metadata.project` indicate if it's their configuration

**Impact**: Agent sees search results but doesn't know which chunks are "theirs"

**Fix**: Either:
- Add guidance in system message: "Look for prompts where metadata matches your persona+project"
- Or enhance tool description to explain metadata interpretation

---

## 🎯 Recommended Solution

### Minimal System Message Pattern

```markdown
You are [Name], [role/identity].

**Identity**: persona="[persona]", project="[project]"

**Goal**: [What you're trying to accomplish]

**Bootstrap**: 
- Load your configuration: Search for your persona+project instructions, then retrieve the full content
- Load context: Check conversation history for relevant background
- Execute: Follow the workflow in your loaded configuration
- Query as needed: Use search tools when you need clarification on specs, workflows, or examples

You have advanced RAG tools. Use them intelligently to discover instructions and context.
```

### Enhanced Tool Descriptions

Update all three core tools to be agent-centric:

1. **prompt_search**: Add "Self-Discovery" section explaining how to query for own instructions
2. **prompt_get**: Add "Resolution Strategy" explaining combination vs separate loading
3. **conversation_remember**: Already good, maybe add examples of "recall my past work"

### Example for Generate Ideas

**System Message** (60 words):
```
You are Iggy, the idea generator for AISMR.

Identity: persona="ideagenerator", project="aismr"

Goal: Generate 12 unique AISMR video ideas with validated uniqueness.

Bootstrap: Load your workflow configuration, check past work via conversation memory, 
then execute. Use search tools to find specifications, validate uniqueness, and 
discover patterns. Query as needed.
```

**Tool does the rest** because it now has:
- Self-discovery guidance in `prompt_search` description
- Clear combination loading pattern in `prompt_get` description
- Agent autonomy to query for clarifications

---

## Implementation Checklist

- [ ] Update `prompt_search` tool description with self-discovery pattern
- [ ] Update `prompt_get` tool description with resolution strategy explanation
- [ ] Create minimal system message template for all workflows
- [ ] Test: Can agent bootstrap with just identity + goal?
- [ ] Document the pattern in tool specs (YAML files)
- [ ] Add examples showing self-discovery queries

---

## Why This Matters (per rag_docs.txt)

> "Adaptive RAG systems allow an agent to **decide if additional knowledge is needed**, form search queries, and **iteratively refine retrieval** using intermediate reasoning. This leads to **dynamic retrieval behaviors** rather than one-off lookups."

> "By combining semantic similarity with metadata filters (for project ID, role, etc.), agents achieve **context-aware retrieval** that 'understands not just what users are asking, but **who they are** and what they need the information for'."

Our current system tells agents exactly what to do, defeating the "agentic" in "agentic RAG".

The fix: **Minimal system message + Enhanced tool descriptions = Agent autonomy**

