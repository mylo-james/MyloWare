# MCP Prompt Vector Server - Implementation Plan V2

**Date:** 2025-10-28  
**Status:** Active Development

---

## Overview

This plan focuses on completing the MCP prompt vector server by transforming prompts to structured YAML format, then enhancing the system with remaining production features. The MCP server infrastructure is already built and functional.

---

## Current State

**Completed Infrastructure:**

- ✅ PostgreSQL 16 + pgvector in Docker
- ✅ Node.js/TypeScript MCP server with HTTP transport
- ✅ Drizzle ORM with migrations
- ✅ OpenAI embeddings (text-embedding-3-small)
- ✅ File ingestion pipeline with chunking
- ✅ 4 MCP tools: `prompts.search`, `prompts.get`, `prompts.list`, `prompts.filter`
- ✅ MCP resources: `prompt://info`, `status://health`
- ✅ Cloudflare tunnel configuration

**Current Prompts:**

- 7 markdown files in `/prompts/` (unstructured prose)
- Types: persona (4), project (1), combination (2)
- Naming: `persona-{name}.md`, `project-{name}.md`, `{persona}-{project}.md`

**What's Next:**

- Transform prompts to structured YAML format
- Enhance ingestion to parse YAML metadata
- Migrate to database-first architecture
- Complete production features

---

## Epic 1: Prompt Transformation & JSON Migration

**Goal:** Transform all prompts to structured JSON format and migrate to database-first architecture

### Story 1.1: Transform Prompts to JSON

**Objective:** Convert all 7 prompts from unstructured prose to structured JSON

**Tasks:**

- [x] Transform `persona-chat.json` to structured JSON
  - Extract agent metadata (name, id, title, icon, whentouse)
  - Extract persona fields (role, style, identity, focus)
  - Convert beliefs/values to core_principles array
  - Validate JSON syntax
- [x] Transform `persona-ideagenerator.json`
- [x] Transform `persona-screenwriter.json`
- [x] Transform `persona-captionhashtag.json`
- [x] Transform `project-aismr.json`
- [x] Transform `ideagenerator-aismr.json`
- [x] Transform `screenwriter-aismr.json`
- [x] Side-by-side comparison to ensure no information loss

**JSON Schema (illustrative):**

```json
{
  "title": "string",
  "activation_notice": "string",
  "critical_notice": "string",
  "agent": {
    "name": "string",
    "id": "string",
    "title": "string",
    "icon": "string",
    "whentouse": "string",
    "customization": "string|null"
  },
  "persona": {
    "role": "string",
    "style": "string",
    "identity": "string",
    "focus": "string",
    "core_principles": ["Title - Description"]
  },
  "operating_notes": {
    "beliefs": ["string"],
    "...": ["string"]
  }
}
```

**Deliverable:** 7 transformed JSON files with validated syntax

---

### Story 1.2: Update Ingestion to Parse JSON

**Objective:** Enhance metadata extraction to parse structured JSON prompt files

**Tasks:**

- [ ] Update `src/ingestion/metadata.ts` to load and parse JSON prompt files
- [ ] Extract `agent` fields (name, id, title, icon, whentouse, customization) into metadata JSONB
- [ ] Extract `persona` fields (role, style, identity, focus, core_principles) into metadata JSONB
- [ ] Extract workflow or project sections (inputs, steps, guardrails) into structured metadata where applicable
- [ ] Keep existing filename-based metadata (type, persona[], project[])
- [ ] Test with transformed prompts
- [ ] Validate enriched metadata appears in database

**Files to Update:**

- `src/ingestion/metadata.ts` - Add JSON parsing helper
- `src/ingestion/fileProcessor.ts` - Ensure JSON files are read correctly

**Deliverable:** Ingestion code parses JSON and stores structured metadata in JSONB

---

### Story 1.3: Migrate Prompts to Database

**Objective:** Load all transformed prompts into MCP database

**Tasks:**

- [ ] Run ingestion on transformed `/prompts/` directory
- [ ] Validate all 7 prompts loaded correctly
- [ ] Check metadata includes JSON fields (agent, persona, operating notes/workflow data)
- [ ] Test `prompts.get` returns full JSON content
- [ ] Verify vector search works with structured data
- [ ] Test `prompts.search` finds specific core principles
- [ ] Test `prompts.list` shows enriched metadata
- [ ] Test `prompts.filter` by persona/project

**Deliverable:** All prompts in database with enriched JSON metadata, MCP tools working

---

### Story 1.4: Cleanup & Documentation

**Objective:** Finalize migration and document new workflow

**Tasks:**

- [ ] Archive `/prompts/` directory (keep as backup)
- [ ] Update deployment configs (no file mounting needed)
- [ ] Document new workflow for editing prompts:
  - Option 1: Edit `.json` files, re-run `npm run ingest`
  - Option 2: Direct database access
  - Option 3: Build admin UI (future)
- [ ] Update README with JSON schema documentation
- [ ] Document benefits of structured format

**Deliverable:** Database is source of truth, clear documentation for prompt editing

---

## Epic 2: Incremental Updates & Optimization

**Goal:** Efficient re-ingestion and production-ready performance

### Story 2.1: Change Detection & Delta Ingestion

**Tasks:**

- [ ] Create delta selector in `src/ingestion/deltaSelector.ts`:
  - Compare file checksums with database
  - Identify new, modified, deleted files
  - Return change list
- [ ] Implement incremental ingestion:
  - Only process changed files
  - Remove embeddings for deleted files
  - Update modified file embeddings
- [ ] Add CLI script `scripts/ingestChanged.ts`
- [ ] Log change summary

**Deliverable:** Modifying one prompt only re-processes that file

---

### Story 2.2: Performance Optimization

**Tasks:**

- [ ] Tune vector index parameters (IVFFlat lists)
- [ ] Add database connection pooling
- [ ] Implement query result caching (5 min TTL)
- [ ] Optimize chunk size for search quality
- [ ] Add database query explain analysis
- [ ] Load test with 100 concurrent searches

**Deliverable:** Search latency <500ms at p95

---

### Story 2.3: Hybrid Search Enhancement (Future)

**Tasks:**

- [ ] Add full-text search with tsvector
- [ ] Implement BM25 scoring
- [ ] Combine vector + lexical search
- [ ] Add re-ranking logic
- [ ] Test search quality improvements

**Deliverable:** Keyword searches improve recall

---

## Epic 3: Testing & Quality Assurance

**Goal:** Comprehensive test coverage and reliability

### Story 3.1: Integration Testing

**Tasks:**

- [ ] Set up Testcontainers for PostgreSQL
- [ ] Write end-to-end ingestion tests
- [ ] Write MCP tool integration tests
- [ ] Test search quality with known queries
- [ ] Test error scenarios (DB down, invalid input)

**Deliverable:** Integration tests pass consistently

---

### Story 3.2: Test Data & Fixtures

**Tasks:**

- [ ] Create test prompt fixtures
- [ ] Add sample embeddings for tests
- [ ] Create database seed script for testing
- [ ] Document test data structure

**Deliverable:** Tests run with consistent fixtures

---

## Epic 4: Documentation & Developer Experience

**Goal:** Complete documentation for setup and usage

### Story 4.1: Technical Documentation

**Tasks:**

- [ ] Write comprehensive README.md:
  - Architecture overview
  - Setup instructions
  - Environment variables
  - Running locally
  - Deployment guide
- [ ] Document MCP tools with examples
- [ ] Create API documentation
- [ ] Add troubleshooting guide
- [ ] Document database schema
- [ ] Document YAML prompt format

**Deliverable:** New developer can set up project in 15 minutes

---

### Story 4.2: Operational Runbooks

**Tasks:**

- [ ] Create runbook for ingestion failures
- [ ] Create runbook for database issues
- [ ] Create runbook for tunnel downtime
- [ ] Document backup/restore procedures
- [ ] Add monitoring alert response guide

**Deliverable:** Common issues have documented solutions

---

### Story 4.3: Development Tools

**Tasks:**

- [ ] Create CLI tool for testing searches locally
- [ ] Add script to inspect embeddings
- [ ] Create debug mode with verbose logging
- [ ] Add database inspection scripts
- [ ] Create development shortcuts

**Deliverable:** Developers can debug issues efficiently

---

## Epic 5: Monitoring & Production Readiness

**Goal:** Production monitoring and alerting

### Story 5.1: Monitoring & Observability

**Tasks:**

- [ ] Set up structured logging with pino:
  - Request/response logs
  - Error logs with stack traces
  - Performance metrics
- [ ] Add Prometheus metrics endpoint `/metrics`:
  - Request count and duration
  - Tool invocation stats
  - Database query times
  - Vector search latency
- [ ] Create status dashboard endpoint
- [ ] Add alerting for failures

**Deliverable:** Metrics endpoint returns valid Prometheus format

---

### Story 5.2: Production Deployment

**Tasks:**

- [ ] Set up production environment variables
- [ ] Configure production PostgreSQL
- [ ] Set up automated backups
- [ ] Deploy Cloudflare tunnel
- [ ] Run production ingestion
- [ ] Verify all tools work remotely

**Deliverable:** Production server accessible via HTTPS

---

### Story 5.3: Monitoring & Alerting Setup

**Tasks:**

- [ ] Set up uptime monitoring
- [ ] Configure error rate alerts
- [ ] Monitor database performance
- [ ] Track embedding generation times
- [ ] Set up log aggregation

**Deliverable:** Team notified of critical issues

---

## Success Metrics

### Epic 1 Complete (Prompt Transformation)

- ✅ All 7 prompts transformed to YAML format
- ✅ YAML metadata stored in database
- ✅ Search works with structured principles
- ✅ n8n workflows use MCP tools exclusively
- ✅ Database is source of truth

### Epic 2 Complete (Optimization)

- ✅ Incremental updates work (<30s per file)
- ✅ Search latency <500ms at p95
- ✅ Connection pooling implemented

### Epic 3 Complete (Testing)

- ✅ Integration tests pass
- ✅ Test fixtures established
- ✅ Error scenarios covered

### Epic 4 Complete (Documentation)

- ✅ README comprehensive
- ✅ Runbooks written
- ✅ Developer tools available

### Epic 5 Complete (Production)

- ✅ Monitoring active
- ✅ Alerts configured
- ✅ Production deployed

---

## Project Timeline

| Phase                      | Duration | Epics  |
| -------------------------- | -------- | ------ |
| Prompt Transformation      | 1-2 days | Epic 1 |
| Optimization & Performance | 2-3 days | Epic 2 |
| Testing & Quality          | 2-3 days | Epic 3 |
| Documentation              | 1-2 days | Epic 4 |
| Production Deployment      | 1-2 days | Epic 5 |

**Total Estimated Time:** 1-2 weeks

---

## Risk Management

| Risk                       | Impact | Mitigation                                          |
| -------------------------- | ------ | --------------------------------------------------- |
| Information loss in YAML   | High   | Side-by-side comparison, careful review             |
| YAML parsing errors        | Medium | Validate syntax, test incrementally                 |
| Breaking n8n workflows     | High   | Test each workflow, parallel deployment             |
| Search quality degradation | Medium | Compare before/after, tune similarity thresholds    |
| Database performance       | Medium | Proper indexing, connection pooling, query optimize |
| Ingestion failures         | Low    | Error handling, retry logic, detailed logging       |

---

## Configuration

### Environment Variables

**Required:**

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mcp_prompts

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# HTTP Server
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3456
MCP_HTTP_PATH=/mcp
```

**Optional:**

```bash
# Security
MCP_HTTP_DNS_REBINDING_PROTECTION=true
MCP_HTTP_ALLOWED_HOSTS=localhost,127.0.0.1
MCP_HTTP_ALLOWED_ORIGINS=https://*.trycloudflare.com

# Ingestion
EMBEDDING_BATCH_SIZE=100
CHUNK_STRATEGY=recursive
CHUNK_MAX_TOKENS=700

# Debug
DEBUG_MCP_HTTP=false
NODE_ENV=production
```

---

## MCP Tools (Existing)

### `prompts.search`

Semantic search with optional persona/project filters

- Input: `{ query, persona?, project?, limit?, minSimilarity? }`
- Output: Ranked results with similarity scores

### `prompts.get`

Retrieve full prompt by file path

- Input: `{ filePath, includeMetadata? }`
- Output: Full content with metadata

### `prompts.list`

List all prompts with filters

- Input: `{ type?, persona?, project? }`
- Output: Array of prompt summaries

### `prompts.filter`

Non-semantic metadata filtering

- Input: `{ persona?, project?, type? }`
- Output: Matching chunks

---

## Next Steps

1. **Start Epic 1** - Prompt Transformation
   - Begin with `persona-chat.md` as prototype
   - Review and validate transformation approach
   - Transform remaining 6 prompts
2. **Update ingestion** - Parse YAML metadata
3. **Migrate database** - Load transformed prompts
4. **Update workflows** - Switch n8n to MCP tools
5. **Complete remaining epics** - Optimization, testing, docs, production

---

## Future Enhancements (Post-MVP)

- **Prompt Versioning:** Track historical changes to prompts
- **Multi-Project Support:** Separate databases per project
- **Usage Analytics:** Track which prompts are queried most
- **Prompt Composition:** Dynamically combine multiple prompts
- **Web UI:** Admin interface for viewing/managing prompts
- **Custom Embedding Models:** Support for domain-specific models
- **Advanced Metadata:** Parse additional frontmatter fields
- **Prompt Templates:** Extract reusable patterns

---

**Version:** 2.0  
**Last Updated:** 2025-10-28  
**Status:** Active - Epic 1 Ready to Start
