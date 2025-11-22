# MyloWare Roadmap

This roadmap outlines the next milestones for MyloWare as we mature the multi-agent video production platform.

## Vision

Build a production-grade, OSS-first AI studio where specialized personas collaborate through LangGraph to ideate, generate, edit, and publish video content with auditable HITL checkpoints.

## Current Status

**v1.0** — ✅ Production Launch Complete (November 2025)
- Multi-agent LangGraph orchestrator with LangChain personas
- Two complete pipelines: Test Video Gen and AISMR
- FastAPI gateway with Telegram integration
- Full observability stack (LangSmith, Prometheus, Grafana, Sentry)
- 82% test coverage with comprehensive CI/CD
- Production deployment on Fly.io

## Upcoming Milestones

### v1.1.0 — Publishing Expansion
- Add YouTube and Instagram Reels publishers alongside TikTok
- Unify publisher interface with per-channel metadata mapping
- Extend HITL prepublish gate with channel-specific policy checks
- Ship CLI shortcuts for multi-channel publishes (`mw-py publish --channels ...`)

### v1.2.0 — Studio Automation
- Introduce Scheduler persona for time-based publishing windows
- Add content calendar artifacts with run lineage
- Auto-generate thumbnails and captions via provider adapters
- Alex persona authors project-specific Shotstack timelines/templates, versioned per project
- Expand observability dashboards for publish success/failure rates

### v1.3.0 — Retrieval & Knowledge Quality
- KB ingestion workflow with quality scoring and deduplication
- Persona-aware retrieval prompts with provenance tracking
- Auto-load guardrails and key KB snippets into persona prompts so most runs do not need explicit memory_search calls
- Semantic caching for repeated queries across runs

### v1.4.0 — Reliability & Scale
- Circuit breaker + retry policies configurable per provider
- DLQ replay automation with audit trails
- Horizontal scale guidance for orchestrator and API services

### v1.5.0 — Graph Authoring & Studio UI
- Allow Brendan to author and update LangGraph graphs dynamically instead of relying solely on hard-coded project graphs
- Web studio UI for creating and editing personas, project specs, and starting/rerunning runs
- Richer HITL UX: structured review forms, better explanations, and history for each gate

### v1.6.0 — Integrations & MCP
- Harden and extend the MCP adapter for richer tool surfaces and better error handling
- Publish n8n recipes and Zapier-style examples that exercise MyloWare via MCP
- Provide opinionated starter workflows for third-party automation platforms (e.g., trigger runs from CRMs, task trackers)

## Future Ideas
- Web UI for HITL approvals, persona/project configuration, and run introspection
- Additional persona packs (research, fact-checker, compliance)
- On-prem deployment profile with Terraform module
- Plug-and-play provider kits for new generation/editing/publishing APIs
- Enhanced MCP adapter with richer tool surfaces

## How We Prioritize
- Production reliability and safety come first (HITL, auditability, retries)
- Developer ergonomics (CLI first, clear contracts, strong docs)
- Impactful demos that showcase multi-agent orchestration in real workflows

Contributions and feedback are welcome—open an issue or PR to propose roadmap changes.

**Contact:** mylo.james114@gmail.com | GitHub: https://github.com/mylo-james
