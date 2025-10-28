# Prompt Retrieval Service Plan

## Objectives
- Serve prompt content to internal AI agents via a dedicated retrieval API backed by both structured metadata and semantic search.
- Self-host all storage so the solution can run locally or within our infrastructure without external SaaS dependencies.
- Expose the service over a Cloudflared tunnel to provide secure webhook access for remote automations and tool invocations.

## Assumptions & Constraints
- Primary codebase remains Node.js/TypeScript; new service can live under `server/` or `apps/prompt-retriever/`.
- We can run Docker in target environments; Docker Compose is acceptable for local/dev orchestration.
- Embeddings can rely on an open model hosted locally (e.g., `nomic-embed-text`, `all-MiniLM-L6-v2`) or on an internal inference endpoint—no third-party API calls at runtime.
- Existing prompt files (Markdown) remain the source of truth until migrated; plan covers automated ingestion.

## Architecture Overview
- **Application Server**: Node.js (Fastify or Express) REST API providing endpoints for prompt ingestion, search, and metadata management. Includes background workers for embedding generation and sync jobs.
- **Relational DB**: PostgreSQL for canonical prompt records, metadata, version history, and tooling permissions.
- **Vector DB**: Qdrant (self-hosted) for semantic search over prompt embeddings. Consider Milvus as fallback if GPU acceleration is required.
- **Embedding Service**: Lightweight worker that batches prompts and generates embeddings using an open-source model (possibly via `sentence-transformers` in a Python microservice exposed over gRPC/HTTP) or Node wrapper around `onnxruntime`.
- **Message Queue (Optional)**: Redis + BullMQ to decouple ingestion from embedding jobs if throughput grows.
- **Cloudflare Tunnel**: Cloudflared sidecar publishes the Fastify webhook endpoint (`/webhook/prompt-query`, `/webhook/prompt-sync`) for AI tool access without direct inbound networking.
- **n8n Integration**: Provide custom nodes or generic HTTP Request preconfigured to hit the new service; future MCP tools can call same endpoints.

## Data & API Design
- **PostgreSQL Schema**:
  - `prompts`: id, slug, title, raw_markdown, normalized_text, tags (JSONB), created_at, updated_at, source_path, version.
  - `prompt_vectors`: prompt_id (FK), embedding (vector type via pgvector), vector_status, last_embedded_at.
  - `prompt_queries`: audit log of tool queries (query, filters, response_ids) for observability.
- **Qdrant Collections**:
  - `prompts`: vector size = embedding_dim, payload mirrors prompt metadata for fast filters (`tags`, `project`, `content_type`).
- **REST Endpoints**:
  - `POST /prompts/import` — bulk ingest from filesystem/git.
  - `POST /prompts` / `PUT /prompts/:id` — CRUD for prompts authored via API.
  - `POST /search` — hybrid search combining vector (Qdrant) + keyword fallback (Postgres `tsvector`).
  - `POST /webhook/prompt-query` — Cloudflare-exposed endpoint for AI tooling; wraps `/search` with access token verification.
  - `POST /webhook/prompt-sync` — triggers re-ingest when markdown changes.
  - `GET /health` — readiness/liveness for orchestration.

## Implementation Phases
1. **Foundation & Scaffolding**
   - Create new service directory with Fastify app, env configuration, and TypeScript build setup.
   - Add Docker Compose stack bringing up Postgres, Qdrant, Redis (optional), embedding worker container, and Cloudflared (dev).
   - Configure shared `.env` and secrets management strategy (direnv or Doppler integration).
2. **Database Layer**
   - Install Prisma or Drizzle ORM; define migrations for `prompts`, `prompt_vectors`, `prompt_queries` tables.
   - Establish connection pooling (pgBouncer optional) and set up pgvector extension for similarity queries as SQL fallback.
   - Seed script to bootstrap initial prompt metadata from existing markdown.
3. **Embedding Pipeline**
   - Implement ingestion job that reads markdown, normalizes text (strip markdown syntax, capture YAML frontmatter tags).
   - Create embedding worker: choose model, optimize for CPU (quantization if needed), expose simple gRPC/REST service.
   - Build job queue for embedding tasks; ensure idempotent updates and retry logic.
   - Sync embeddings into both Postgres (`prompt_vectors`) and Qdrant collection.
4. **Search & Retrieval APIs**
   - Implement hybrid search endpoint combining vector similarity (Qdrant) with SQL filters. Provide structured response (prompt content, metadata, snippets).
   - Add scoring logic (vector score, keyword score) and ranking/threshold tuning.
   - Implement caching (Redis) for hot queries and RPS smoothing.
   - Harden authentication (API keys or JWT linked to tooling identities); add rate limiting/metering.
5. **Cloudflare Tunnel Integration**
   - Configure cloudflared daemon in Docker Compose with credentials file; map service routes to webhook endpoints.
   - Write deployment notes for staging/production Cloudflare Zero Trust, including access policies and audit logging.
   - Ensure webhook payload contracts documented for downstream tools.
6. **Tooling Interfaces**
   - Build n8n custom node or HTTP template node to call `/webhook/prompt-query` with secure headers.
   - Draft MCP tool definition referencing same endpoint for local AI runtimes.
   - Provide TypeScript/SDK helper for other services to embed/search prompts programmatically.
7. **Observability & QA**
   - Add structured logging (pino), metrics (Prometheus exporter), and distributed tracing hooks (OpenTelemetry optional).
   - Write integration tests covering ingestion → embedding → search flow; use test containers for DB/vector DB.
   - Establish CI jobs for lint/test, Docker image build, and vulnerability scanning.
   - Document runbooks for data backfills, vector re-indexing, and model upgrades.

## Milestones & Deliverables
- **Milestone 1**: Docker Compose stack + Hello World Fastify server accessible via Cloudflared tunnel.
- **Milestone 2**: Markdown ingestion stored in Postgres with versioning; basic search via SQL.
- **Milestone 3**: Embedding pipeline live with Qdrant hybrid search; API returning ranked prompts.
- **Milestone 4**: n8n node + MCP tool consuming webhook; observability baseline in place.
- **Milestone 5**: Production hardening (auth, scaling notes, disaster recovery) and full documentation.

## Risks & Mitigations
- **Embedding performance**: Large prompt corpus may slow CPU-only embeddings → plan for batching, caching, and optional GPU deployment.
- **Data drift**: Markdown source may diverge from DB → schedule reconciler job and add pre-commit hook to enforce updates.
- **Tunnel reliability**: Cloudflared outages could block tools → include local fallback path and monitoring alerts.
- **Security**: Webhook must reject unauthorized callers → enforce signed payloads, rotate tokens, and log access.

## Open Questions
- Preferred embedding model and licensing constraints?
- Should prompts remain editable in Markdown, or migrate to DB-first authoring with git export?
- Do we need per-project access controls for AI tools, or is global read-only sufficient?
- What SLAs are expected for retrieval latency across Cloudflare tunnel?
