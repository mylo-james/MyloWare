# Prompts System Fix & RAG Bootstrap Plan

**Status**: ✅ Phase 1-5 Complete | 🚀 Phase 6 Ready  
**Created**: 2025-11-03  
**Goal**: Enable true agentic RAG self-discovery for AI agents

---

## ✅ Phase 1-5: COMPLETED

All implementation steps for prompts reorganization and database reseeding are complete:

- ✅ Archive structure created at `archive-prompts/` (outside prompts/)
- ✅ Canonical prompts established with NO version suffixes
- ✅ Database completely wiped and reseeded with 18 prompts
- ✅ All prompts follow canonical structure with `memory` sections
- ✅ `ideagenerator+aismr` combination verified in database
- ✅ All active prompts organized: personas/, projects/, combinations/, memory/, workflows/

**Database Status**: Clean - 0 v2 suffixes, 0 archive files, 18 canonical prompts

---

## 🚀 Phase 6: Enable Agentic RAG Self-Discovery

**Reference**: See `/docs/RAG_BOOTSTRAP_GAPS.md` for detailed gap analysis

### Problem Statement

**Current State**:

- ✅ Prompts in database with proper metadata
- ✅ RAG tools (prompt_search, prompt_get) functional
- ❌ Agents can't self-discover their instructions effectively
- ❌ System messages too prescriptive (150+ words, step-by-step)
- ❌ Tool descriptions generic, not self-referential
- ❌ Agents don't understand combination vs separate loading

**Root Cause**: Tool descriptions written for external users, not for agents to discover THEIR OWN instructions.

**Per rag_docs.txt**:

> "Adaptive RAG systems allow an agent to **decide if additional knowledge is needed**, form search queries, and **iteratively refine retrieval** using intermediate reasoning."

We're defeating "agentic" in "agentic RAG" by telling agents exactly what to do.

---

## Implementation Steps

### Step 6.1: Enhance prompt_search Tool Description

**File**: `src/server/tools/promptSearchTool.ts` (lines 493-497)

**Goal**: Make agents understand they can query for THEIR OWN instructions

- [x] Open `src/server/tools/promptSearchTool.ts`
- [x] Locate the `description` field in `registerPromptSearchTool` function (around line 493)
- [x] Replace the description array with enhanced version that includes self-discovery guidance
- [x] New description should include:
  - Current functionality (Swiss-army retrieval)
  - **NEW**: Self-discovery pattern section
  - **NEW**: Example queries for finding own instructions
  - **NEW**: Guidance on using metadata to identify own config
  - **NEW**: Pattern: search → review chunks → prompt_get for full content
- [x] Verify code compiles: `npm run build`

**Expected Addition** (add after current description):

```
Self-Discovery Pattern:
- Query for YOUR instructions: "[your-persona] [your-project] workflow"
- Look for metadata matching your identity (persona/project arrays)
- Use prompt_get with identified persona+project to load full content

Discovery Queries:
- "ideagenerator aismr workflow" → your task-specific instructions
- "AISMR timing specifications" → project constraints
- "successful AISMR ideas" → examples and patterns
```

### Step 6.2: Enhance prompt_get Tool Description

**File**: `src/server/tools/promptGetTool.ts` (lines 76-80)

**Goal**: Explain combination vs separate loading clearly

- [x] Open `src/server/tools/promptGetTool.ts`
- [x] Locate the `description` field in `registerPromptGetTool` function (around line 76)
- [x] Add "Resolution Strategy" section explaining priority order
- [x] Add "When to Use" guidance for combination vs separate
- [x] Add examples showing combination loading pattern
- [x] Verify code compiles: `npm run build`

**Expected Addition**:

```
Resolution Strategy:
1. BOTH parameters → COMBINATION prompt (complete workflow)
2. persona only → GENERIC persona (no project workflow)
3. project only → PROJECT specs (no persona behavior)

For task execution with project context, ALWAYS provide both parameters.

Examples:
- Workflow: {persona_name: "ideagenerator", project_name: "aismr"} → ideagenerator-aismr.json
- Generic: {persona_name: "chat"} → persona-chat.json
```

### Step 6.3: Update conversation_remember Description

**File**: `src/server/tools/conversationMemoryTool.ts` (lines 171-175)

**Goal**: Add self-referential query examples

- [x] Open `src/server/tools/conversationMemoryTool.ts`
- [x] Locate description field in `registerConversationMemoryTool` (around line 171)
- [x] Add section about querying own past work
- [x] Add examples of self-referential queries
- [x] Verify code compiles: `npm run build`

**Expected Addition**:

```
Self-Referential Usage:
- "my recent generated ideas" → recall your past outputs
- "user feedback on my work" → learn from responses
- "rejected concepts" → avoid past failures
- "user preferences" → recall stated constraints
```

### Step 6.4: Create System Message Documentation

**File**: Create `docs/SYSTEM_MESSAGE_TEMPLATE.md`

**Goal**: Document the minimal system message pattern for all workflows

- [x] Create new file `docs/SYSTEM_MESSAGE_TEMPLATE.md`
- [x] Document the 30-50 word template pattern
- [x] Include examples for each persona type
- [x] Document design principles (goal-oriented, not prescriptive)
- [x] List anti-patterns (no step-by-step instructions)
- [x] Add section on why this enables agentic RAG
- [x] Reference rag_docs.txt best practices
- [ ] Git add: `git add docs/SYSTEM_MESSAGE_TEMPLATE.md`

### Step 6.5: Update Chat Workflow System Message

**File**: `workflows/chat.workflow.json` (line ~308)

**Goal**: Replace prescriptive message with minimal template

**Current** (~80 words):

```
Required Steps
1. Load persona using prompt_search_adaptive and prompt_get for the persona "chat"
2. Load the past conversation with conversation_remember with "recent conversation context"
3. Decide if you have enough information to process user Input otherwise you're free to query as needed. USE search tools!
3. Handle user input using any tools provided.
4. Respond to user with tool execution results
```

**New** (35 words):

```
You are Casey, conversational orchestrator.

Identity: persona="chat", project=null

Goal: Help users with context-aware responses.

Bootstrap: Load your configuration, recall conversation context, then respond.
Use your tools as needed.
```

- [x] Open `workflows/chat.workflow.json`
- [x] Find the system message in AI Agent node options
- [x] Replace with minimal template
- [x] Verify JSON is valid
- [ ] Git add: `git add workflows/chat.workflow.json`

### Step 6.6: Update Generate Ideas Workflow System Message

**File**: `workflows/generate-ideas.workflow.json`

**Goal**: Replace prescriptive message with minimal template

**New** (38 words):

```
You are Iggy, idea generator for AISMR.

Identity: persona="ideagenerator", project="aismr"

Goal: Generate 12 unique AISMR video ideas with validated uniqueness.

Bootstrap: Load your workflow, check past work, then execute.
Use your tools to discover specifications and validate uniqueness.
```

- [x] Open `workflows/generate-ideas.workflow.json`
- [x] Find the system message in AI Agent node
- [x] Replace with minimal template
- [x] Verify JSON is valid
- [ ] Git add: `git add workflows/generate-ideas.workflow.json`

### Step 6.7: Update Screen Writer Workflow System Message

**File**: `workflows/screen-writer.workflow.json`

**Goal**: Replace prescriptive message with minimal template

**New** (37 words):

```
You are Sloane, screenwriter for AISMR.

Identity: persona="screenwriter", project="aismr"

Goal: Transform ideas into validated AISMR screenplays with exact timing and specs.

Bootstrap: Load your workflow, recall specifications, then execute.
Use your tools as needed.
```

- [x] Open `workflows/screen-writer.workflow.json`
- [x] Find the system message in AI Agent node
- [x] Replace with minimal template
- [x] Verify JSON is valid
- [ ] Git add: `git add workflows/screen-writer.workflow.json`

### Step 6.10: Verify All Workflow Updates

**Goal**: Ensure consistency across all updated AI Agent nodes

- [x] List all modified workflow files
- [x] For each file, verify:
  - System message follows minimal pattern
  - Identity line present with correct persona/project
  - Goal is one clear sentence
  - Bootstrap mentions loading config
  - Total words under 50
- [x] Create summary of changes made

**Verification Command**:

```bash
cd /Users/mjames/Code/mcp-prompts/workflows
for file in $(git diff --name-only | grep '.workflow.json'); do
  echo "=== $file ==="
  grep -A 3 '"systemMessage"' "$file" | head -10
done
```

### Step 6.11: Build and Deploy

- [x] Build TypeScript: `npm run build`
- [x] Verify all builds succeed with no errors
- [x] Run tests: `npm test` (ensure no regressions)
- [x] Check linter: `npm run lint` (if available)
- [x] Verify dist/ directory has updated tool files

### Step 6.12: End-to-End Integration Test

**Test Scenario**: Generate Ideas workflow with minimal system message

- [ ] Ensure MCP server is running
- [ ] Ensure n8n is connected to MCP server
- [ ] Trigger Generate Ideas workflow with test input
- [ ] Monitor agent tool calls (should see prompt_search or prompt_get)
- [ ] Verify agent discovers and loads ideagenerator-aismr combination
- [ ] Verify agent executes workflow steps from loaded config
- [ ] Verify agent generates 12 ideas successfully
- [ ] Check output quality and schema compliance

**Expected Tool Call Sequence**:

1. Agent receives minimal system message with identity
2. Agent calls `prompt_get({ persona_name: "ideagenerator", project_name: "aismr" })`
3. Agent receives full workflow from combination prompt
4. Agent follows workflow steps (conversation_remember, prompt_search for specs, etc.)
5. Agent generates and validates ideas
6. Agent stores results via conversation_store

### Step 6.13: Documentation and Cleanup

- [ ] Update `docs/SYSTEM-SUMMARY.md` with new agentic RAG pattern
- [ ] Update `README.md` to reference minimal system message approach
- [ ] Remove any old documentation referencing prescriptive patterns
- [ ] Create migration guide for updating other workflows
- [ ] Git add all documentation changes

### Step 6.14: Final Commit

- [x] Review all changes with `git status`
- [x] Ensure no unintended files are staged
- [x] Commit with comprehensive message:

  ```
  feat: enable true agentic RAG self-discovery

  Enhanced tool descriptions to guide agent self-discovery:
  - prompt_search now explains how to find own instructions
  - prompt_get clarifies combination vs separate loading strategy
  - conversation_remember includes self-referential query examples

  Updated system messages to minimal format:
  - Reduced from 150 words to 35-40 words
  - Goal-oriented instead of step-by-step prescriptive
  - Trusts agent to discover workflow via RAG tools

  Created system message template documentation:
  - Pattern: identity + goal + bootstrap mention (30-50 words)
  - Examples for all persona types
  - Design principles and anti-patterns

  Updated workflows:
  - chat.workflow.json: minimal system message
  - generate-ideas.workflow.json: minimal system message
  - screen-writer.workflow.json: minimal system message

  This enables agents to autonomously discover their instructions
  per rag_docs.txt best practices: "adaptive RAG systems allow an
  agent to decide if additional knowledge is needed, form search
  queries, and iteratively refine retrieval."

  Resolves: Agents can now self-bootstrap with minimal guidance
  ```

- [ ] Push changes (follow workflow: create PR, verify CI)

---

## 🚨 Critical Success Indicators

After Phase 6 completion, verify:

1. **Tool Autonomy**: Agent makes discovery decisions, not following rigid script
2. **Self-Discovery**: Agent can query "what are my instructions?" and find them
3. **Minimal System**: System messages under 50 words, goal-oriented
4. **Combination Loading**: Agent uses prompt_get with both parameters for workflows
5. **Query Flexibility**: Agent queries for clarifications when needed
6. **RAG Leverage**: Agent uses search tools to discover specs, examples, anti-patterns

**Test Question**: Can you delete step 1-6 from system message and agent still succeeds?

- ✅ Yes → Agentic RAG is working
- ❌ No → Still too prescriptive

---

## 📝 Implementation Notes

### Tool Description Update Pattern

When updating tool descriptions, use this structure:

```typescript
description: [
  // Original functionality (2-3 sentences)
  'What the tool does...',
  '',
  // Self-discovery section (NEW)
  '## Self-Discovery Pattern',
  'How to use this tool to find your own instructions...',
  '',
  // Examples (NEW or enhanced)
  '## Example Queries',
  '- "your persona + project" - Discover your workflow',
  '- "specification type" - Find constraints',
].join('\n'),
```

### System Message Update Pattern

Old format:

```
Required Steps
1. Do X
2. Do Y
3. Do Z
```

New format:

```
You are [Name], [role].

Identity: persona="[slug]", project="[slug]"

Goal: [One sentence]

Bootstrap: [One sentence about loading + executing]
Use your tools as needed.
```

### Testing Checklist

For each workflow after updates:

- [ ] Agent discovers configuration (via logs/telemetry)
- [ ] Agent loads correct combination/persona
- [ ] Agent executes workflow successfully
- [ ] Agent queries for clarifications when uncertain
- [ ] Output matches expected schema and quality

---

## 🔗 Related Documentation

- Gap Analysis: `/docs/RAG_BOOTSTRAP_GAPS.md`
- RAG Best Practices: `/docs/rag_docs.txt`
- Tool Specs: `/docs/tool-specs/`
- System Summary: `/docs/SYSTEM-SUMMARY.md`
- Template (NEW): `/docs/SYSTEM_MESSAGE_TEMPLATE.md`

---

---

## 📋 Phase 6 Execution Summary

**Total Steps**: 14 sequential steps
**Estimated Time**: 90-120 minutes
**Critical Path**: Tool descriptions → Template docs → Workflow updates → Testing

**Key Deliverables**:

1. Enhanced tool descriptions (3 files)
2. System message template documentation (1 file)
3. Updated workflow system messages (3+ files)
4. End-to-end integration tests
5. Comprehensive commit with before/after examples

**Success Metric**: Can agents bootstrap with just "Identity + Goal" and discover everything else via RAG?

---

**Ready to Execute Phase 6**: Follow steps 6.1-6.14 sequentially. Each step builds on previous ones.

**Agent executing this plan**: Mark each checkbox as complete when done. Stop only if blocked.


