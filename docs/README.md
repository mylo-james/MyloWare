# MyloWare Documentation

**Welcome to the MyloWare AI Production Studio documentation.**

This is a trace-driven, multi-agent system that turns natural language into published videos. Read [NORTH_STAR.md](../NORTH_STAR.md) for the complete vision and detailed walkthrough.

---

## Quick Navigation

### 🚀 Getting Started
New to MyloWare? Start here.

- [Quick Start](01-getting-started/quick-start.md) - Get running in 5 minutes
- [Local Setup](01-getting-started/local-setup.md) - Complete development environment
- [First End-to-End Run](01-getting-started/first-run-e2e.md) - Test the full pipeline

### 🏗️ Architecture
Understand how the system works.

- [System Overview](02-architecture/system-overview.md) - High-level architecture
- [Universal Workflow](02-architecture/universal-workflow.md) - One workflow, all personas
- [Trace State Machine](02-architecture/trace-state-machine.md) - Coordination model
- [Data Model](02-architecture/data-model.md) - Database schema overview

### 📖 How-To Guides
Task-oriented guides for common operations.

- [Add a Persona](03-how-to/add-a-persona.md) - Create new agent roles
- [Add a Project](03-how-to/add-a-project.md) - Define new production types
- [Add External Workflow](03-how-to/add-external-workflow.md) - Integrate n8n workflows
- [Run Integration Tests](03-how-to/run-integration-tests.md) - Test coordination flows
- [Release Cut and Rollback](03-how-to/release-cut-and-rollback.md) - Deployment procedures

### 🔌 Integration
Connect external systems.

- [MCP Integration](04-integration/mcp-integration.md) - Model Context Protocol clients
- [n8n Universal Workflow](04-integration/n8n-universal-workflow.md) - Workflow configuration
- [Telegram Setup](04-integration/telegram-setup.md) - Bot configuration
- [n8n Error Handling](04-integration/n8n-error-handling.md) - Error patterns
- [n8n Guardrails](04-integration/n8n-guardrails.md) - Safety constraints
- [n8n Webhook Config](04-integration/n8n-webhook-config.md) - Webhook setup
- [n8n Workflow Mappings](04-integration/n8n-workflow-mappings.md) - Workflow registry

### 🔧 Operations
Run, monitor, and troubleshoot production.

- [Security Hardening](05-operations/security-hardening.md) - Lock down deployment surface
- [Production Runbook](05-operations/production-runbook.md) - Day-2 operations & incident response
- [Observability](05-operations/observability.md) - Metrics and queries
- [Troubleshooting](05-operations/troubleshooting.md) - Common issues and fixes
- [Deployment](05-operations/deployment.md) - Production deployment guide
- [Backups and Restore](05-operations/backups-and-restore.md) - Data protection

### 📚 Reference
Technical specifications and API documentation.

- [MCP Tools](06-reference/mcp-tools.md) - Complete tool catalog (auto-generated)
- [API Endpoints](06-reference/api-endpoints.md) - HTTP API reference
- [Configuration](06-reference/config-and-env.md) - Environment variables
- [Database Schema](06-reference/schema.md) - Schema reference (auto-generated)
- [Prompt Notes](06-reference/prompt-notes.md) - Agent prompt patterns

### 🤝 Contributing
Join development.

- [Development Guide](07-contributing/dev-guide.md) - Local development workflow
- [Development Workflow](07-contributing/dev-workflow.md) - Day-to-day development
- [Coding Standards](07-contributing/coding-standards.md) - Code quality rules
- [Testing Guide](07-contributing/testing.md) - Test strategy and patterns
- [Docs Style Guide](07-contributing/docs-style-guide.md) - Documentation standards

---

## Documentation Principles

### Voice and Tone
- **Concise**: Short sentences, active voice, minimal jargon
- **Task-focused**: Start with the outcome, provide steps, validate success
- **North Star aligned**: Link to [NORTH_STAR.md](../NORTH_STAR.md) for narrative; don't duplicate it
- **Code over prose**: Show working examples; explain only what's non-obvious

### Structure
Every page follows this pattern:
1. **Audience** - Who this is for
2. **Outcomes** - What you'll accomplish
3. **Prerequisites** - What you need first
4. **Steps** - Numbered, actionable instructions
5. **Validation** - How to verify success
6. **Next Steps** - Where to go from here

### Context7 Usage
Use Context7 to fetch official vendor documentation and our repo docs:

```bash
# Fetch n8n docs
Context7: /n8n/n8n

# Fetch MCP protocol spec
Context7: /modelcontextprotocol/specification

# Fetch OpenAI API docs
Context7: /openai/openai-openapi
```

The `docs/official-documentation/` directory contains convenience snapshots but is **not authoritative**. Always prefer Context7 for up-to-date vendor docs.

### Auto-Generated Content
Some reference docs are generated from source code:
- `06-reference/mcp-tools.md` - Generated from `src/mcp/tools.ts`
- `06-reference/schema.md` - Generated from `src/db/schema.ts`

These files are regenerated on every commit via CI. Do not edit them manually.

---

## Key Concepts

### Trace-Driven Coordination
Every production run has a unique `traceId`. Agents coordinate by:
1. Loading context via `memory_search({ traceId })`
2. Executing work
3. Storing outputs via `memory_store({ metadata: { traceId } })`
4. Handing off via `handoff_to_agent({ traceId, toAgent, instructions })`

See [Trace State Machine](02-architecture/trace-state-machine.md) for details.

### Universal Workflow
One n8n workflow (`myloware-agent.workflow.json`) becomes any persona dynamically:
- Receives trigger (Telegram/Chat/Webhook)
- Calls `trace_prep` to discover persona from trace
- Executes as that persona with scoped tools
- Hands off to next agent via webhook

See [Universal Workflow](02-architecture/universal-workflow.md) for details.

### Special Handoff Targets
- `handoff_to_agent({ toAgent: 'complete' })` - Marks trace completed, sends user notification
- `handoff_to_agent({ toAgent: 'error' })` - Marks trace failed, logs error

---

## Need Help?

- **Getting stuck?** Check [Troubleshooting](05-operations/troubleshooting.md)
- **Want to contribute?** Read [Development Guide](07-contributing/dev-guide.md)
- **Understanding the vision?** Read [NORTH_STAR.md](../NORTH_STAR.md)
- **Quick reference?** See [AGENTS.md](../AGENTS.md)
- **Looking for old docs?** See [Migration Guide](MIGRATION_GUIDE.md)
- **Want to record work?** Append to [Work Summaries](SUMMARIES.md)

---

**Last updated:** January 2025  
**Version:** 2.0 (Universal Workflow Era)
