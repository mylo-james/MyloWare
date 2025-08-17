# Requirements

## Functional Requirements

**FR1: Slack Integration & Commands**
- The system must provide Slack app integration with Socket Mode for MVP
- The system must support slash commands: `/mylo new`, `/mylo status`, `/mylo talk`, `/mylo stop`, `/mylo mute`
- The system must create and manage three primary channels: `#mylo-control`, `#mylo-approvals`, `#mylo-feed`
- The system must post run updates as threads in `#mylo-feed` keyed by `run_id`
- The system must support approval cards with interactive buttons for HITL decisions
- The system must provide user onboarding and training documentation for non-technical users
- The system must support approval card batching and filtering for high-volume scenarios

**FR2: Workflow Orchestration**
- The system must execute deterministic workflows using Temporal for retries, timers, heartbeats, and idempotency
- The system must support the "Docs: Extract & Verify" workflow: `recordgen → extractorLLM → jsonrestyler → schemaguard → persister → verifier → (optional summarizerLLM)`
- The system must implement agent leasing with `lease_ttl=30s` and heartbeat every 10s
- The system must provide outbox→bus→inbox pattern with at-least-once delivery and idempotent consumers
- The system must define clear service boundaries for microservices architecture

**FR3: Human-in-the-Loop (HITL) Approvals**
- The system must implement policy engine returning `allow | soft_gate(timeout_ms) | deny(reason)`
- The system must support approval policy matrix with Hard Gates and Soft Gates
- The system must auto-approve soft gates after timeout (default 2 minutes)
- The system must require justification notes for Hard Gate approvals
- The system must record all approval events in `approval_event` table with 365-day retention
- The system must provide approval card UX patterns with clear information hierarchy
- The system must support mobile-responsive design for approval interactions

**FR4: Agent Management**
- The system must use OpenAI Agents SDK for all agents
- The system must implement CPU steps as tool-only agents with `tool_choice`
- The system must implement LLM steps with JSON schema mode and `temperature=0`
- The system must support agent personas with concurrency limits and fair scheduling
- The system must implement agent mutex to prevent double checkout
- The system must provide detailed agent leasing mechanism specifications

**FR5: Memory & Knowledge Management**
- The system must implement importance-scored memory with decay and tiering
- The system must support namespaces: `team/<team_id>/org/*`, `team/<team_id>/task/<task_id>/*`, `team/<team_id>/persona/<persona_id>/*`
- The system must require citations for LLM outputs via `used_mem_ids`
- The system must implement memory tiering: hot (indexed) → warm (<10 importance & 90d idle) → cold (warm 180d)
- The system must support nightly compaction for episodic memory
- The system must start with simplified vector storage for MVP, upgrade to pgvector later

**FR6: Data Model & Persistence (MVP Focus)**
- The system must implement core data model: work_order, work_item, attempt, runs, mem_doc, approval_event, dead_letter
- The system must implement proper indexing and foreign key constraints
- The system must support audit logging with immutable, append-only records
- The system must include data classification framework for PII and sensitive data
- The system must support test data generation and management

**FR7: API Surface (Simplified for MVP)**
- The system must provide REST API endpoints: `POST /runs`, `GET /runs/:id`, `GET /runs/:id/trace`, `POST /approvals`
- The system must implement capability-token authentication with ≤15 min TTL (configurable)
- The system must support audience-bound tokens with least-privilege scopes
- The system must start with HTTP REST, upgrade to MCP protocol post-MVP

**FR8: Run Trace & Observability (MVP Focus)**
- The system must provide Run Trace UI for workflow visualization with mobile-responsive design
- The system must implement correlation IDs propagated end-to-end
- The system must support structured logging (JSON) and OpenTelemetry traces/metrics
- The system must provide simplified dashboards: Run Trace, Board Status, Token Spend
- The system must include performance monitoring and bottleneck identification

**FR9: Testing & Quality Assurance (Enhanced)**
- The system must pass golden set tests (20+ docs: 6× invoice, 6× ticket, 6× status, 2× edge cases) with 100% pass rate
- The system must implement jailbreak set testing for prompt injection resistance
- The system must support load testing with N parallel runs and specific performance scenarios
- The system must implement chaos testing for lease expirations and agent failures
- The system must include security testing for authentication and authorization
- The system must provide test automation with specific acceptance criteria

**FR10: Business Metrics & ROI Tracking**
- The system must track business metrics: time saved per document, error reduction percentage, cost per successful extraction
- The system must provide ROI dashboards and cost-benefit analysis
- The system must include go-to-market strategy requirements
- The system must support competitive analysis and market positioning
- The system must provide cost forecasting and pricing strategy framework

## Non-Functional Requirements

**NFR1: Performance & Scalability**
- The system must achieve p95 CPU step ≤ 2s and p95 LLM step ≤ 6s
- The system must maintain step success ≥ 98% and dead-letters < 1%
- The system must support token budgets: input ≤ 800 tokens, output ≤ 200 tokens
- The system must implement backpressure handling on bus backlog and DB latency
- The system must provide specific performance testing scenarios and benchmarks
- The system must support capacity planning and scaling validation

**NFR2: Security & Compliance (Enhanced)**
- The system must encrypt data at rest and redact PII in logs
- The system must implement JWT capability tokens with ≤15 min TTL (configurable) and HTTPS only
- The system must verify Slack signatures (v2) and rotate signing secrets quarterly
- The system must implement role-based approver lists and immutable audit logs
- The system must deny PII handling in MVP (synthetic/test data only)
- The system must include security incident response procedures
- The system must implement data classification framework for PII and sensitive data
- The system must provide MCP protocol security specifications

**NFR3: Reliability & Availability**
- The system must implement lease rescue for expired agent leases
- The system must provide retry taxonomy with appropriate backoff strategies
- The system must support idempotency by `op_id` and Slack `payload_id`
- The system must implement circuit breakers for connector failures
- The system must provide technical debt tracking for post-MVP refactoring

**NFR4: Cost Management (Enhanced)**
- The system must enforce token budgets with refusal fallback on exceed
- The system must provide cost dashboards and alert on budget breaches
- The system must implement budget classes: low, medium, high with numeric caps
- The system must prevent silent cost escalation through policy controls
- The system must provide cost forecasting and pricing strategy framework
- The system must include ROI tracking and cost-benefit analysis

**NFR5: Maintainability & Operations (Enhanced)**
- The system must provide comprehensive runbooks and incident playbooks
- The system must implement SLOs with alerting on violations
- The system must support graceful degradation for connector outages
- The system must provide clear escalation paths and SLAs
- The system must include user training and documentation requirements
- The system must provide competitive analysis and market positioning framework
