# Myloware Agent Workflow

The `workflows/myloware-agent.workflow.json` file is the production **single, universal n8n workflow** that every persona (Casey → Quinn) shares. Instead of six separate workflow exports, we converge around one webhook that inspects the active `traceId`, loads persona/project context over MCP, and renders a tailored system prompt for the `@n8n/n8n-nodes-langchain.agent` node.

## Current Capabilities

- **Triple Trigger Surface**
  - **Telegram** (`casey` bot), **LangChain Chat Trigger**, and the **Webhook** (`/myloware/ingest`) used by `handoff_to_agent` all share the same normalization path.
  - Every trigger lands in `Prepare Input` (Set node), so the rest of the workflow only ever sees `{ traceId, instructions, sessionId, source }`.
- **One MCP Call (`trace_prepare`)**
  - Instead of chaining half a dozen HTTP nodes, the workflow now calls `/tools/trace_prepare` once.
  - The tool creates a trace when none exists, loads persona/project context, fetches trace-scoped memories, builds the final system prompt, and scopes the allowed MCP tools for the current owner.
- **Agent Node**
  - The LangChain Agent uses the prompt and instructions returned by `trace_prepare`.
  - The MCP Client receives the exact `allowedTools` array from the same payload, keeping the runtime tool list in lockstep with persona policy.
- **Inline Guardrails**
  - Guardrails run on the sanitized instructions returned by `trace_prepare`.
  - Violations are logged via `memory_store` with the active `traceId`; the workflow tolerates logging failures so persona execution is never blocked.

## Node Walkthrough

1. **Telegram / Chat / Webhook Triggers** — Normalize user chats, Casey’s Telegram DM, or downstream agent handoffs into a common payload.
2. **Prepare Input (Set node)** — Extracts `traceId`, `instructions`, `sessionId`, and `source` into a predictable shape with deterministic prefixes for session routing.
3. **Prepare Trace Context (HTTP Request)** — Calls the MCP `trace_prepare` tool to create-or-load the trace, bundle persona/project context, and emit `{ systemPrompt, allowedTools, instructions }`.
4. **Guardrails + Violation Logging** — Validates instructions against injection/PII/jailbreak policies and, on violation, stores a `memory_store` entry tagged with the active `traceId`.
5. **Myloware Agent** — Executes the LangChain agent node with the returned system prompt, instructions, and `allowedTools`.

## MCP Connectivity

- All HTTP Request nodes use the `Mylo MCP` header credential so they can hit `https://mcp-vector.mjames.dev/tools/<toolName>` directly.
- The LangChain MCP Client node still points at `https://mcp-vector.mjames.dev/mcp` for AI-issued tool calls.
- Because n8n Cloud does not honor `$env.*` placeholders, every URL in this workflow is literal by design (per `AGENTS.md`).

## Importing the Workflow

```bash
npm run import:workflows   # now also syncs workflows/myloware-agent.workflow.json
```

If you are importing manually, register the webhook path `myloware/ingest` inside the `agent_webhooks` table so `handoff_to_agent` resolves to this workflow for every persona.

## Archived Workflows

The `archive/` directory contains legacy persona-specific workflows that have been replaced by the universal workflow (`myloware-agent.workflow.json`). These are kept for historical reference only and should not be imported or activated.

### Migration Status

- **Universal workflow is now the single source of truth**
- All personas (Casey → Quinn) execute via `myloware-agent.workflow.json`
- Legacy workflows archived as of January 2025
- Parity tests confirm universal workflow covers all persona capabilities

### Archived Files

- `casey.workflow.json` - Legacy Casey workflow (replaced by universal workflow)
- `iggy.workflow.json` - Legacy Iggy workflow (replaced by universal workflow)
- `riley.workflow.json` - Legacy Riley workflow (replaced by universal workflow)
- `veo.workflow.json` - Legacy Veo workflow (replaced by universal workflow)
- `alex.workflow.json` - Legacy Alex workflow (replaced by universal workflow)
- `quinn.workflow.json` - Legacy Quinn workflow (replaced by universal workflow)

### Production Workflows

- `myloware-agent.workflow.json` - Universal workflow for all personas
- `error-handler.workflow.json` - Error handling workflow (linked via settings.errorWorkflow)
- `mcp-health-check.workflow.json` - MCP server health monitoring workflow

## Next Steps

- Add Casey's post-handoff blocking/waiting loop so Telegram users get the completion ping when Quinn calls `workflow_complete`.
- Bolt on the HITL Send-and-Wait nodes for Iggy and Alex once their personas are migrated into the universal workflow.
- Revive the deterministic sub-workflows (`generate-video`, `edit-aismr`) and expose them via MCP `toolWorkflow` calls for Veo/Alex fan-out steps.
