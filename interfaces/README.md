# Interfaces

`interfaces/` collects inbound/outbound edge adapters that are not core services:

- Telegram bot/webhook bridge.
- HITL UI + signed approval endpoints.
- Future web UI adapters.

Code here should be thin wrappers that forward into `apps/api` or `apps/orchestrator`.
