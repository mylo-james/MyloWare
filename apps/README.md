# Apps Layer

This directory contains deployable services in the Python‑first stack:

- `apps/api/` — FastAPI service that exposes HTTP surface area (runs, HITL, webhooks).
- `apps/orchestrator/` — LangGraph-based supervisor + persona graphs (Brendan + run pipelines).
- `apps/mcp_adapter/` — Python MCP adapter that forwards tools/resources to the API/orchestrator.

Each subdirectory should embed its own README and deployment assets as code evolves.
