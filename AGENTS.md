# Agent Development Guide

Quick reference for AI and human agents working in the MyloWare repository.

---

## Mission

Build a **multi-agent, memory-first AI Production Studio** where:

- Casey (Showrunner) coordinates production runs via `traceId`
- Specialist agents (Iggy, Riley, Veo, Alex, Quinn) work autonomously
- Memory tagged by `traceId` provides coordination fabric
- Each agent hands off directly to the next via natural language

**Current Status (Jan 2025):** Epic 1 (trace coordination) is live. Epic 2 (agent workflows) is in progress.

---

## Quick Start for Agents

### 1. Understand the System

Read in this order:
1. **[NORTH_STAR.md](NORTH_STAR.md)** - Complete vision and detailed walkthrough
2. **[System Overview](docs/02-architecture/system-overview.md)** - High-level architecture
3. **[Universal Workflow](docs/02-architecture/universal-workflow.md)** - One workflow, all personas
4. **[Trace State Machine](docs/02-architecture/trace-state-machine.md)** - Coordination model

### 2. Development Workflow

```bash
# Start development environment
./start-dev.sh

# Run tests
npm test

# Check code quality
npm run lint
npm run type-check
npm run check:legacy-tools

# Generate/check docs
npm run docs:generate
npm run docs:check-links
```

### 3. Key Documentation

**For development:**
- [Development Guide](docs/07-contributing/dev-guide.md) - Local development workflow
- [Coding Standards](docs/07-contributing/coding-standards.md) - Code quality rules
- [Testing Guide](docs/07-contributing/testing.md) - Test strategy and patterns

**For integration:**
- [MCP Integration](docs/04-integration/mcp-integration.md) - MCP protocol
- [n8n Universal Workflow](docs/04-integration/n8n-universal-workflow.md) - Workflow configuration

**For operations:**
- [Observability](docs/05-operations/observability.md) - Metrics and queries
- [Troubleshooting](docs/05-operations/troubleshooting.md) - Common issues
- [Deployment](docs/05-operations/deployment.md) - Production setup

---

## Universal Workflow Pattern

All personas execute in the **same workflow** (`myloware-agent.workflow.json`):

1. Trigger (Telegram/Chat/Webhook) → Edit Fields
2. `trace_prep` HTTP Request → Discovers persona from `trace.currentOwner`
3. AI Agent Node → Receives `systemPrompt` + `allowedTools`
4. Agent executes → Calls MCP tools
5. `handoff_to_agent` → Invokes same workflow via webhook

See [Universal Workflow](docs/02-architecture/universal-workflow.md) for details.

---

## Trace Coordination

Every production run has a unique `traceId`. Agents coordinate by:

1. **Load context:** `memory_search({ traceId })`
2. **Execute work:** Follow project specs
3. **Store outputs:** `memory_store({ metadata: { traceId } })`
4. **Hand off:** `handoff_to_agent({ traceId, toAgent, instructions })`

See [Trace State Machine](docs/02-architecture/trace-state-machine.md) for details.

---

## Agent Pipeline

```
Casey (Showrunner)
  ↓ handoff_to_agent
Iggy (Creative Director)
  ↓ handoff_to_agent
Riley (Head Writer)
  ↓ handoff_to_agent
Veo (Production)
  ↓ handoff_to_agent
Alex (Editor)
  ↓ handoff_to_agent
Quinn (Publisher)
  ↓ handoff_to_agent({ toAgent: 'complete' })
User Notification
```

**Persona configs:** `data/personas/*.json`  
**Project configs:** `data/projects/*.json`

---

## MCP Tools

**Core tools (all personas):**
- `memory_search` - Find memories by semantic similarity
- `memory_store` - Save outputs with auto-embedding
- `handoff_to_agent` - Transfer ownership to next agent

**Casey-specific:**
- `trace_update` - Update trace metadata
- `context_get_persona` - Load agent config
- `context_get_project` - Load project specs

**Veo/Alex-specific:**
- `job_upsert` - Track async jobs
- `jobs_summary` - Check job completion

**Special handoff targets:**
- `toAgent: 'complete'` - Marks trace completed, sends notification
- `toAgent: 'error'` - Marks trace failed, logs error

See [MCP Tools Reference](docs/06-reference/mcp-tools.md) for complete catalog.

---

## Memory Discipline

Every memory created during a trace **must** include:

```typescript
{
  "content": "Single-line summary (no newlines)",
  "memoryType": "episodic",
  "persona": ["iggy"],
  "project": ["aismr"],
  "tags": ["ideas", "approved"],
  "metadata": {
    "traceId": "trace-001"  // REQUIRED
  }
}
```

This enables agents to find upstream work via `memory_search({ traceId })`.

---

## Development Rules

1. **Always pull main** before creating a new branch
2. **Follow red-green-refactor** for acceptance criteria
3. **Never skip husky hooks** (no `--no-verify`)
4. **Never commit without tests passing**
5. **Only commit when explicitly asked** (don't be proactive)
6. **Never force push to main/master**
7. **Run `npm run check:legacy-tools`** before pushing

---

## Removed Tools (Legacy)

**Do not reference these in new work:**
- `clarify_ask` → Use Telegram HITL nodes
- `prompt_discover` → Use procedural memories + `memory_search`
- `workflow_complete` → Use `handoff_to_agent({ toAgent: 'complete' })`
- `run_state_*` → Use `trace_create` + `memory_search`
- `handoff_create/complete` → Use `handoff_to_agent`

The CI "Legacy Tool Guard" (`npm run check:legacy-tools`) enforces this.

---

## Context7 Usage

Use Context7 to fetch official vendor documentation:

```
Context7: /n8n/n8n
Context7: /modelcontextprotocol/specification
Context7: /openai/openai-openapi
```

Don't copy vendor docs into the repo. Keep our docs focused on MyloWare-specific guidance.

---

## Common Commands

```bash
# Development
npm run dev                  # Hot reload (local)
./start-dev.sh              # Start full stack

# Testing
npm test                    # All tests (containerized)
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests
npm run test:coverage       # Coverage report

# Database
npm run db:reset           # Wipe and recreate
npm run db:bootstrap       # Reset + migrate + seed
npm run db:test:rollback   # Test migration safety

# Code Quality
npm run type-check         # TypeScript validation
npm run lint               # ESLint check
npm run lint:fix           # Auto-fix issues
npm run check:legacy-tools # Scan for forbidden terms

# Documentation
npm run docs:generate      # Generate reference docs
npm run docs:check-links   # Validate links
```

---

## Documentation Index

**Start here:** [docs/README.md](docs/README.md)

**Quick links:**
- [Quick Start](docs/01-getting-started/quick-start.md) - Get running in 5 minutes
- [System Overview](docs/02-architecture/system-overview.md) - Architecture
- [Add a Persona](docs/03-how-to/add-a-persona.md) - Create agents
- [MCP Tools](docs/06-reference/mcp-tools.md) - Tool catalog
- [Prompt Notes](docs/06-reference/prompt-notes.md) - Agent patterns

---

## Coverage Requirements

- **Unit tests:** ≥50% coverage (interim floor; raising to 80% in Epic 7)
- **All MCP tools:** Must have targeted unit tests
- **Repositories:** Must have tests for CRUD operations
- **Integration:** At least one happy path test per epic

**Current Status:** 154+ tests / 26+ files / 66%+ coverage

---

## Need Help?

- **Architecture questions?** Read [System Overview](docs/02-architecture/system-overview.md)
- **MCP tools?** Read [MCP Tools Reference](docs/06-reference/mcp-tools.md)
- **Testing?** Read [Testing Guide](docs/07-contributing/testing.md)
- **Deployment?** Read [Deployment Guide](docs/05-operations/deployment.md)
- **Stuck?** Read [Troubleshooting](docs/05-operations/troubleshooting.md)

---

## Work Summaries

When completing significant work, append a summary to [docs/SUMMARIES.md](docs/SUMMARIES.md):

```markdown
## [Date] - [Brief Title]

**Date:** YYYY-MM-DD  
**Agent:** [Your name/identifier]  
**Summary:**

[2-3 paragraphs describing what was accomplished]

**Results:**
- Key outcome 1
- Key outcome 2
```

This creates a searchable history of major changes and decisions.

---

**Stay trace-aware. Keep memory clean. Document as you go.**
