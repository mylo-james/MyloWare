## Repository Restructure Plan (FP-first, products, MCP–DB isolation)

### Why
- Enforce separation of concerns: the MCP server must not depend on or import database code.
- Package the system as distinct products that can be shipped and scaled independently.
- Keep code semantically aligned with docs: trace-driven, memory-first, universal workflow.
- Improve testability with pure domain logic and effectful edges only at adapters.

### Senior principles in practice
- Contract-first: OpenAPI is the source of truth; Zod validates at runtime; clients are generated.
- Idempotency and resilience: idempotency keys, retries with backoff, sane timeouts, circuit breaking.
- AuthN/AuthZ: service-to-service tokens; persona/project scoped authorization enforced server-side.
- Tenancy: explicit cross-project RAG opt-in; default scoping by persona/project/trace.
- Observability: `traceId`-correlated logs/metrics, per-product SLOs, red/amber/green dashboards.
- Testing: unit (pure), contract (OpenAPI), integration (repos/tools), E2E (workflow loop).
- Tooling: monorepo workspaces, cached builds/tests, CI import guards for SoC.

---

## Product outcomes & KPIs (PO lens)

- Outcomes
  - Faster iteration with safe boundaries; reusable shared knowledge via RAG; reliable handoffs to completion.
  - Self-serve authoring (Studio) with governance and auditability.
- KPIs
  - Time-to-first-trace (TTFT)
  - Successful handoff rate (% persona hops without retry)
  - p95 memory_search latency and recall@k (measured with golden set)
  - % traces completed, end-to-end lead time
  - Studio approval cycle time for persona/workflow changes
  - Deployment frequency and change failure rate (DORA)
  - AI quality: task success rate, hallucination rate, refusal rate, toxicity, factuality/helpfulness score
  - Cost: $/task or $/trace, cache hit rate, token utilization

---

## AI evaluation & guardrails

- Evaluation framework
  - Offline: golden datasets (human-labeled), templated prompts, synthetic augmentations; stable baselines per use case.
  - Online: A/B or interleaving; holdouts; feature flags; safe rollout and auto-rollback.
  - Versioning: prompt + model + retrieval corpus versions tracked; changelogs; regression gates in CI.
  - Acceptance thresholds: define pass/fail (e.g., success ≥ 90%, hallucination ≤ 2%, p95 ≤ 1.5s).

- Guardrails & safety
  - Refusal policy and disallowed content; safety filters by domain.
  - Grounding requirements for RAG paths (citations mandatory where applicable).
  - Runtime policy checks with audit logging on intercepts.

- Incident management
  - AI-behavior incident playbook: contain → disable/rollback → RCA; include prompt/model/corpus diffs.

---

## HITL (human-in-the-loop) & experience quality

- Checkpoints
  - Medium/high-risk outputs require approval; SLA (e.g., < 10 min median).
  - Reviewer identity captured; approvals stored as memories with tags (e.g., `approved`).

- UX signals
  - Show uncertainty/confidence and citations; affordances to “ask for sources” and “flag output.”
  - Clear escalation/override path for users and operators.

---

## Data & RAG responsibilities (PO + platform)

- Data contracts
  - Source, rights/consent, privacy class, retention/TTL, lineage, PII handling.

- Feedback loop
  - Capture user feedback and HITL decisions; auto-triage into eval queues; periodic re-labeling.

- Retrieval policy
  - Source-of-truth priority, freshness semantics, reindex cadence; cross-tenant RAG requires explicit opt-in + audit.

---

## Milestones (vertical slices)

- M0: Walking Skeleton
  - MCP → Core API → n8n loop with minimal endpoints (memories.search/store, traces.create/update, handoff).
  - KPIs: TTFT < 5m; p95 handoff < 300ms; 95% happy-path reliability.
- M1: Studio MVP
  - Personas/Projects/Workflows CRUD; publish to Core API; basic guardrails.
  - KPIs: Studio-to-production lead time < 1 day; audit logs for changes.
- M2: RAG Baseline
  - Hybrid search (vector + FTS), single-line AI data rule, reindex job, related memory graph (opt-in).
  - KPIs: p95 memory_search < 150ms; recall@k baseline established.
- M3: Hardening & SLOs
  - Idempotency, retries/backoff, import guards, OpenAPI contract gates, canary deploys, dashboards + alerts.
  - KPIs: Core API availability ≥ 99.9%; MCP build checks pass; alert fatigue < 5% false positives.
- M4: Governance & Tenancy
  - Persona/project-scoped tokens, explicit cross-project RAG opt-in + audit, retention policies.
- M5: Scale & Indexer Split (optional)
  - Dedicated Indexer worker and queue; capacity targets for embeddings/reindex throughput.

---

## Scrum operating model (Scrum Master lens)

- Cadence & WIP
  - 2-week sprints; WIP limits per lane; daily sync; weekly demos; bi-weekly retros focused on DORA + SLOs.
- Definition of Ready (DoR)
  - OpenAPI stub (if applicable), acceptance criteria, test plan, telemetry plan, owner + dependencies mapped.
- Definition of Done (DoD)
  - Unit/contract/integration tests pass; SLO metric added; dashboards updated; runbook entry; docs updated; security review (as needed).
- Dependencies & risk management
  - CI import guard for MCP now; contract test/generation gate; ephemeral envs per PR; synthetic monitor for handoff loop.
- Backlog examples (INVEST)
  - “As Casey, kick off a trace end-to-end” — AC: 95% success over 100 runs; p95 handoff < 300ms; trace visible in dashboard.
  - “As Veo, search upstream work” — AC: hybrid RAG returns Riley outputs; single-line enforced; p95 < 150ms.
  - “As Admin, edit persona” — AC: Studio saves; Core API versions; MCP sees updated allowedTools next run; audit entry written.

---

## Productization Overview

- Product A: MCP Server
  - A stateless, persona-scoped agent runtime exposing MCP tools.
  - Calls a Core API over HTTP for all persistence, retrieval, and RAG lookups.
  - Hard rule: zero imports of DB/ORM/libs (no `drizzle-orm`, `pg`, or schema imports).
  - Accepts only validated inputs; returns structured outputs; emits observability metrics.

- Product B: Studio Frontend (Personas & Workflows)
  - A web UI for creating/editing personas, projects, workflows, and guardrails.
  - Uses the Core API for CRUD and publishes changes to the shared knowledge base.
  - Generates/validates JSON/Zod schemas for tools and prompts; manages approvals/HITL.

- Product C: Core API (Knowledge + Orchestration)
  - The single integration point for data: personas, projects, traces, memories, jobs.
  - Exposes OpenAPI/JSON Schema contracts; server-side validates with Zod.
  - Offers hybrid RAG search endpoints and job tracking; owns DB connectivity.
  - Optionally hosts an “Indexer” worker for embeddings, reindex, and linking.

- Product D (Optional split): Indexer/Vector Service
  - Async embedding generation, metadata enrichment, linking, and reindex jobs.
  - Can be run as a separate worker or folded into Core API for simplicity.

- Shared: Knowledge DB (Multi-tenant)
  - One database for all personas/projects; vector + relational (pgvector + Postgres).
  - Strict tenant scoping and persona/project isolation via policies; cross-project RAG allowed via explicit opts.

---

## Service Boundaries and Contracts

- MCP Server → Core API: HTTP/JSON only
  - Example endpoints:
    - POST /memories.search
    - POST /memories.store
    - POST /traces.create
    - POST /traces.update
    - POST /handoff
    - POST /jobs.upsert
    - GET  /jobs.summary?traceId=...
  - Transport: JSON with Zod validation at both ends; contracts published and versioned via OpenAPI.
  - Auth: service-to-service token with scope-limited capabilities; persona/project scopes optional.
  - Idempotency: requests that mutate state accept `Idempotency-Key` header; Core API stores keys per resource.
  - Resilience: explicit timeouts (e.g., 3–5s), exponential backoff (e.g., 100ms → 1s, max 3–5), error codes standardized.
  - Codegen: `@clients/core-api-client` generated from OpenAPI; MCP imports this client only.

```yaml
paths:
  /memories.search:
    post:
      operationId: searchMemories
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/MemorySearchInput'
      responses:
        '200':
          description: Ranking of memories
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MemorySearchResult'
      security:
        - serviceAuth: [memory.search]
      x-idempotency-key: false
  /handoff:
    post:
      operationId: handoffTrace
      parameters:
        - in: header
          name: Idempotency-Key
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/HandoffInput'
      responses:
        '202':
          description: Handoff accepted
      security:
        - serviceAuth: [handoff.write]
```

```ts
// packages/clients/core-api-client/src/index.ts
import { createClient } from '@hey-api/client-fetch';
import type { SearchMemoriesRequest, SearchMemoriesResponse } from './types';

export const coreApi = createClient({
  baseUrl: process.env.CORE_API_URL,
  headers: () => ({
    Authorization: `Bearer ${serviceToken}`,
    'Idempotency-Key': crypto.randomUUID(),
  }),
});

export async function searchMemories(
  payload: SearchMemoriesRequest
): Promise<SearchMemoriesResponse> {
  const response = await coreApi.POST('/memories.search', { body: payload });
  if (response.error) {
    throw new Error(`core-api::memories.search failed: ${response.error.message}`);
  }
  return response.data;
}
```

- Studio Frontend → Core API
  - CRUD endpoints: personas, projects, workflows, guardrails, sessions.
  - Publishing flow emits events or writes directly; approvals recorded as memories/metadata.

- Core API → DB
  - The only service with DB connectivity and ORM imports.
  - Implements repositories/adapters; provides RAG search; manages migrations.
  - Optional RLS: app-level checks required; DB-level RLS can be added for stricter tenancy.

---

## RAG Model (Global Learning, Scoped by Trace/Persona/Project)

- Storage
  - `memories` table with vector embeddings + relational filters (persona[], project[], tags[], metadata JSONB).
  - Cross-persona learning allowed by default (configurable); queries can be scoped to project, persona, tags, or global.

- Retrieval
  - Hybrid vector + keyword with reciprocal rank fusion.
  - Temporal boost, tag filters, traceId filters.
  - Related memory graph expansion (optional) with `relatedTo` edges.

- Indexing
  - On write: clean single-line AI-facing content; embed; store vectors.
  - On update: evolve tags/summary; re-embed when content changes.

---

## FP-First Architecture (Pragmatic)

- Domain (pure): types, invariants, transformations; no I/O, no time.
- Application: MCP tool handlers and API route handlers; validation at edges via Zod.
- Infrastructure: DB, caches, HTTP clients, metrics, external providers.
- Composition: dependency injection via factory functions; Result/Option helpers for error-tolerant flows.

Lightweight Result helpers (no new deps):
```ts
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E = Error> = Ok<T> | Err<E>;
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });
```

---

## Monorepo Layout (apps + packages)

```text
apps/
  mcp-server/               # Product A (no DB imports)
    src/
      tools/                # MCP tools -> call Core API client
      server.ts
    package.json
  core-api/                 # Product C (DB owner)
    src/
      api/                  # Fastify/Express routes
      services/             # app services (call domain + repos)
      infra/                # db client, repositories, schema
      index.ts
    openapi.yaml
    package.json
  studio-frontend/          # Product B (Next.js/Vite)
    package.json

packages/
  domain/                   # Pure domain modules (memory, trace, context, session, jobs)
  clients/                  # Type-safe SDKs (generated from OpenAPI or handwritten)
    core-api-client/
  shared/                   # Validation (Zod), utils (functional, text, time), types
  observability/            # logger, metrics wrappers

docs/                       # existing docs (unchanged)
workflows/                  # n8n workflows (unchanged)
```

Path aliases:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["packages/*"],
      "@domain/*": ["packages/domain/*"],
      "@shared/*": ["packages/shared/*"],
      "@clients/*": ["packages/clients/*"]
    }
  }
}
```

Workspace tooling:
- Use npm/pnpm/yarn workspaces; single lockfile at repo root.
- Optional Turborepo/Nx for task graph caching (build/test/lint/docs).
- Node/TypeScript versions pinned across all apps/packages.

---

## Platform & Deploy (Containers, K8s, IaC)

- Containers
  - Multi-stage Dockerfiles per app with reproducible builds; pin Node/TS versions.
  - Generate SBOM (e.g., Syft) and sign images (cosign); target SLSA level progression.
  - Non-root users; distroless where feasible.

- Kubernetes
  - Helm charts per app with values for envs (dev/stage/prod).
  - Probes: startup, readiness, liveness; resource requests/limits; PDBs; HPAs.
  - Secrets via external store (Vault/SSM) → mounted/injected at runtime.
  - Policy-as-code: OPA/Gatekeeper for admission policies (image signatures, runAsNonRoot, resource limits).

- IaC
  - Terraform for cloud infra (networking, DB, secrets, registries, DNS).
  - Environment parity; ephemeral preview envs for PRs.

---

## Enforcing MCP–DB Isolation

Hard rules for `apps/mcp-server`:
- No imports from `drizzle-orm`, `pg`, `schema.ts`, or any repository adapter.
- Only allowed integration is `@clients/core-api-client` (HTTP).
- CI guard: add a script to fail on disallowed imports (grep/AST), e.g., `scripts/check-mcp-imports.ts`.
- Contract tests: mock Core API; unit test MCP tools as pure orchestrators.

Example MCP tool (conceptual):
```ts
// apps/mcp-server/src/tools/memory/search.ts
import { z } from 'zod';
import { coreApi } from '@clients/core-api-client';
import { cleanSingleLine } from '@shared/validation';

export const MemorySearchInput = z.object({
  query: z.string().min(1).pipe(cleanSingleLine()),
  project: z.string().optional(),
  persona: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export function createMemorySearchTool(api = coreApi) {
  return async function memory_search(input: unknown) {
    const params = MemorySearchInput.parse(input);
    return api.memories.search(params); // HTTP call to Core API
  };
}
```

```ts
// scripts/check-mcp-imports.ts
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { glob } from 'glob';

const disallowed = [/['"]drizzle-orm['"]/, /['"]pg['"]/, /schema\.ts/];
const files = await glob('apps/mcp-server/src/**/*.ts');

for (const file of files) {
  const content = await readFile(file, 'utf8');
  const offender = disallowed.find((pattern) => pattern.test(content));
  if (offender) {
    console.error(`❌ MCP import violation: ${file} matches ${offender}`);
    process.exit(1);
  }
}
console.log('✅ MCP isolation guard passed');
```

---

## Security & Networking

- Perimeter
  - API gateway (rate limit, WAF, authN) in front of Core API; allowlist MCP origins.
  - mTLS or OIDC service-to-service auth (JWT with JWKS rotation); prefer SPIFFE/SPIRE for workload identity on K8s.

- AuthZ
  - Persona/project-scoped service tokens; Core API re-validates `allowedTools` server-side.
  - Signed handoff events; audit logs for privilege changes and cross-project RAG use.
  - Network policies (namespaced least-privilege) and egress controls.

- Secrets
  - Central secret manager; short-lived credentials; zero secrets in images.

---

## Core API Responsibilities

- Authoritative source for:
  - Personas, projects, workflows, guardrails
  - Traces + handoffs (state machine)
  - Memories (vector + relational) with RAG endpoints
  - Jobs (video/edit) lifecycle + summaries
- Validates all requests; enforces single-line AI data rule on write.
- Publishes versioned OpenAPI; generates `@clients/core-api-client`.
- Enforces tenancy and authorization server-side; logs authorization decisions.

---

## Data Layer Operations

- Postgres
  - PgBouncer for connection pooling; read replicas for search-heavy traffic.
  - PITR backups; periodic restore drills; RPO/RTO targets defined.
  - Partition `memories` by time/tag if volumes grow; regular VACUUM/ANALYZE cadence.

- Vector Index
  - HNSW tuning for recall vs speed; scheduled reindex; cap vector dim to model in use.
  - Hybrid (vector + FTS) with reciprocal rank fusion; monitor p95/p99.

- Tenancy
  - App-level guards mandatory; DB-level RLS optionally enabled for stricter isolation.

---

## Scaling & Isolation Strategies

- Cell-based architecture
  - Partition Core API + DB into “cells” (by project/org) to limit blast radius and enable incremental scale.
  - Route by tenant key; keep global services (Studio, MCP) stateless with routing awareness.

- Tenancy escalation paths
  - Start: shared schema with app/RLS guards.
  - Next: schema-per-tenant for noisy-neighbor isolation.
  - Then: cluster-per-tenant (or cell) for strong isolation or regulatory needs.

---

## Studio Frontend (Personas & Workflows)

- Features
  - Persona editor with allowed tools and guardrails
  - Project/workflow designer (universal pattern support)
  - HITL approval flows
  - Memory explorer & trace debugger
- AuthZ
  - Role-based; environment-specific; optional multi-tenant orgs.
  - Governance: approval records written as memories with tags (e.g., `approved`, `guardrail-updated`).

---

## Data Flows (Selected)

1) memory_search via MCP
```text
MCP Tool → Core API /memories.search → DB (vector+fts) → Core API → MCP Tool
```

2) handoff_to_agent
```text
MCP Tool → Core API /handoff → updates trace + emits webhook → n8n universal workflow
```

3) persona publish from Studio
```text
Studio → Core API /personas.upsert → DB → (optional) Indexer re-embeds prompt summaries
```

---

## Asynchrony & Reliability

- Outbox/Queue
  - Core API writes to an outbox table; worker publishes to queue (SQS/NATS/Redis Streams).
  - Webhooks and Indexer consume from queue; DLQ with retention; replay tools for operators.
  - **Decision:** Launch with AWS SQS + SNS (standard queues) for managed durability, IAM integration, and simple fanout; revisit FIFO per tenant if ordering becomes critical.

```sql
CREATE TABLE outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  available_at TIMESTAMP DEFAULT NOW()
);
```

```ts
// apps/core-api/src/services/outbox-publisher.ts
import { db } from '@infra/db';
import { publish } from '@infra/queue';

export async function flushOutbox(batchSize = 100): Promise<void> {
  const events = await db
    .select()
    .from(outbox)
    .where(eq(outbox.status, 'pending'))
    .and(lt(outbox.availableAt, new Date()))
    .limit(batchSize)
    .for('update', { skipLocked: true });

  await Promise.all(
    events.map(async (event) => {
      await publish(event.topic, event.payload);
      await db
        .update(outbox)
        .set({ status: 'sent' })
        .where(eq(outbox.id, event.id));
    })
  );
}
```

- Idempotency
  - `Idempotency-Key` for mutating endpoints; dedupe window; safe retries client-side with exponential backoff.

- Policies
  - Circuit breakers and global concurrency caps for heavy endpoints (search, handoff).
  - Event contracts: Avro/JSON Schema with schema registry; compatibility checks in CI (backward/forward).

---

## Telemetry & Observability

- Tracing
  - OpenTelemetry across all apps; propagate `traceId` and HTTP baggage; exporter to OTLP.

- Metrics
  - Golden signals (latency, traffic, errors, saturation) per product and endpoint.
  - Business metrics: handoffs/hour, successful traces, RAG hit rates.

- Logging
  - Structured, JSON logs; include `traceId`, persona, project, workflowStep.
  - Central log aggregation with retention policies.

```ts
// packages/observability/src/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export function startTelemetry(appName: string) {
  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: appName,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  process.on('SIGTERM', async () => {
    await sdk.shutdown();
  });
}
```

---

## Operational SLOs (initial targets)
- MCP→Core API read p95 ≤ 200ms; write p95 ≤ 300ms.
- Handoff webhook invocation p95 ≤ 300ms; end-to-end persona hop ≤ 1s (excluding external jobs).
- Memory search p95 ≤ 150ms with HNSW index; Core API availability ≥ 99.9%.
- Error budgets tracked per product; alerts tied to SLO breaches.

---

## CI/CD & Release Management

- Pipelines
  - Lint/typecheck/tests; contract tests against OpenAPI; client regeneration in PRs.
  - Image build with SBOM + signing; vulnerability scan gates.
  - CI eval gates for AI paths: offline eval suite must pass thresholds; hallucination/toxicity regressions fail builds.

- Deployment
  - Progressive delivery: canary → 25% → 100% with automated rollback on SLO breach.
  - Blue/green for Core API migrations that alter contracts.
  - Shadow/beta for AI changes; guardrail breach or eval regression triggers rollback.

- Guards
  - MCP import guard (no DB/ORM); OpenAPI breaking-change detector requiring semver bump.
  - API versioning & deprecation: semver policy, deprecation headers, 90-day (configurable) deprecation windows.
  - Performance budgets verified in CI and canary (endpoint p95 thresholds).

```yaml
# .github/workflows/ci.yml (excerpt)
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run test
      - run: npm run docs:generate
      - run: node scripts/check-mcp-imports.ts
      - run: npm run openapi:lint
      - run: npm run openapi:test # contract tests via dredd/prism
      - run: npm run eval:offline # AI eval harness
      - run: npm run build
      - run: npm run sbom
      - run: npm run sign-image
```

```yaml
# eval/promptfoo.yaml (excerpt)
tests:
  - description: "AISMR screenplay grounded"
    prompt: ./prompts/riley_screenplay.md
    vars:
      - traceId: trace-aismr-001
    expected:
      metrics:
        faithfulness:
          min: 0.8
        answer_relevance:
          min: 0.85
        hallucination_rate:
          max: 0.02
providers:
  - id: openai:gpt-4.1-mini
    config:
      temperature: 0.3
ragas:
  datasets: ./eval/datasets
  metrics: [faithfulness, context_relevance, answer_relevance]
```

---

## Developer Experience (Golden Paths)

- Backstage (or similar) developer portal
  - Templates for new tools/services (Helm, CI, observability, security baked-in).
  - Catalog of APIs (OpenAPI), events (schemas), runbooks, and SLO dashboards.
- Code generation
  - OpenAPI → `@clients/core-api-client`; event schemas → types; guardrails docs auto-generated.

---

## Migration Plan (Incremental)

- Phase 0: Scaffolding
  - Create `apps/mcp-server`, `apps/core-api`, `packages/clients/core-api-client`, `packages/domain`, `packages/shared`.
  - Introduce path aliases and CI guards for MCP no-DB rule.

- Phase 0.5: Contracts first
  - Draft OpenAPI for minimal endpoints (memories.search/store, traces.create/update, handoff, jobs).
  - Scaffold `@clients/core-api-client` from OpenAPI; MCP compiles against generated client.

- Phase 1: Lift DB into Core API
  - Move existing DB client, schema, repositories under `apps/core-api/src/infra`.
  - Add API routes matching current MCP tool needs (memories, traces, handoffs, jobs).

- Phase 2: Decouple MCP
  - Replace MCP direct DB usages with `@clients/core-api-client` calls.
  - Keep tool interfaces the same; update docs generation paths.

- Phase 3: Add Studio MVP
  - CRUD for personas/projects/workflows via Core API.
  - Read-only trace/memory explorer.

- Phase 4: RAG Enhancements
  - Related memory graph, temporal boost tuning, cross-project opt-in.
  - Optional Indexer worker split if needed.

- Phase 5: Hardening
  - CI import guards, OpenAPI contract tests, performance SLOs, observability dashboards.

---

## Acceptance Criteria

- MCP server builds and runs with zero DB/ORM imports.
- All persistence and search flow through Core API contracts.
- Studio can define personas/projects/workflows and persist via Core API.
- RAG endpoints serve hybrid retrieval with filters and single-line content guarantees.
- OpenAPI contract tests pass; MCP builds against generated client.
- SLO dashboards present; alerts configured for SLO breaches.
- Docs generation and tests green; coverage maintained or improved.
- Supply chain: images have SBOMs and signatures; CI gates on vulnerabilities.
- Security: SPIFFE/OIDC S2S auth in place; OPA/Gatekeeper policies enforced.
- Events: schemas versioned in registry; CI compatibility checks pass.
- DR: RPO/RTO defined; periodic backup restore drills; failover playbook documented.
 - AI evals: offline suite passes thresholds; online canary shows no guardrail breaches; hallucination ≤ target.
 - HITL: approval flow operational with SLA; audit trails complete.
 - Observability: OpenTelemetry exporter running; logs emit `traceId`; dashboards and alerts defined in Grafana/Prometheus.
 - Technology choices locked: AWS SQS+SNS powering outbox, Apicurio Registry managing schemas, Promptfoo + Ragas enforcement in CI.

---

## Notes

- No new runtime dependencies required beyond HTTP client generation (optional).
- Start with minimal Core API routes to satisfy current MCP tools; expand iteratively.
- Keep n8n universal workflow as-is; webhook continues to loop with `traceId`.

---

## Appendix: Idempotency, Retries, Errors

- Idempotency
  - Clients send `Idempotency-Key: <uuid>` on mutating requests.
  - Core API stores a short-lived record (key, route, hash, response code/body).
  - Replays within TTL return the original response.

- Retries/Timeouts
  - Default timeout: 5s; retries: 3 with exponential backoff (100ms → 1s).
  - Non-retryable status codes: 4xx (except 408/429); retryable: 5xx/408/429.

- Error shape
  - `{ error: { code: string; message: string; traceId?: string; details?: unknown } }`
  - Codes: `VALIDATION_ERROR`, `AUTH_ERROR`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`

```ts
// apps/core-api/src/http/errors.ts
interface ErrorPayload {
  code:
    | 'VALIDATION_ERROR'
    | 'AUTH_ERROR'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'RATE_LIMITED'
    | 'INTERNAL_ERROR';
  message: string;
  traceId?: string;
  details?: unknown;
}

export function toErrorResponse(payload: ErrorPayload) {
  return {
    error: {
      ...payload,
      traceId: payload.traceId ?? globalThis.traceContext?.traceId,
    },
  } as const;
}
```


