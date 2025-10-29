# MCP System V1 Implementation Plan

**Date:** 2025-10-29  
**Status:** V1 Development - Clean Slate Implementation  
**Author:** GitHub Copilot

> **Development Philosophy:** This is V1 development. No production system exists. Remove all legacy code and build the dream architecture cleanly. No fallbacks, no backward compatibility, no migration concerns.

---

## Vision: The Dream Architecture

Build a **clean, slim MCP-based system** with these core requirements:

1. **MCP Server** with `/mcp` endpoint providing `prompt.get(project_name, persona_name)` that queries vector metadata
2. **Vector database** as the single source of truth for prompts with semantic + metadata search
3. **SQL database** containing only `runs` and `videos` tables
4. **REST endpoints** for standard HTTP requests (`/api/runs/:id`, `/api/videos/:id`) replacing all Supabase
5. **n8n workflows** calling our server only, with `n8n:push`/`n8n:pull` sync scripts

---

## Current State: What to Keep vs Delete

### ✅ **Keep - Core Infrastructure**

- PostgreSQL 16 + pgvector setup
- Node.js/TypeScript MCP server foundation
- Drizzle ORM with migrations
- OpenAI embeddings integration
- HTTP transport layer

### 🗑️ **Delete - Legacy/Bloated Code**

- All current MCP tools (rebuild focused versions)
- File-based prompt loading (move to DB-only)
- Backward compatibility in `prompt.get`
- Complex metadata parsing (simplify)
- Operations tools that duplicate REST functionality
- Any Supabase references or fallback code

### ⚠️ **Transform - Specific Gaps to Address**

1. **`prompt.get` tool**: Delete current implementation, rebuild to accept `project_name + persona_name` only
2. **No REST endpoints**: Build clean API alongside MCP
3. **Bloated prompt metadata**: Simplify to essential project/persona fields only
4. **n8n dependency on Supabase**: Replace with our server calls
5. **No workflow sync**: Add n8n SDK integration

---

## Implementation Plan: V1 Clean Build

## Phase 1: Core System Rebuild (Week 1)

### Step 1.1: Delete Legacy, Keep Infrastructure ⏱️ 0.5 days

**Objective**: Clean house - remove all legacy code that doesn't fit the dream architecture

**Delete Tasks:**

- [x] **Remove Current MCP Tools**
  - Delete `src/server/tools/getPromptTool.ts` (rebuild from scratch)
  - Delete `src/server/tools/searchPromptsTool.ts` (rebuild simpler)
  - Delete `src/server/tools/listPromptsTool.ts` (rebuild simpler)
  - Delete `src/server/tools/filterPromptsTool.ts` (not needed)
- [x] **Remove File Dependencies**
  - Delete `/prompts/` directory mounting from Docker
  - Remove file-walking ingestion code
  - Remove file-based metadata parsing
  - Update Dockerfile to not copy prompt files
- [x] **Clean Repository Layer**
  - Simplify `PromptEmbeddingsRepository` to essential methods only
  - Remove complex metadata parsing
  - Remove file path dependencies

**Keep Tasks:**

- [x] Keep database schemas and migrations
- [x] Keep basic HTTP server setup
- [x] Keep operations database (runs/videos)
- [x] Keep OpenAI embedding integration

### Step 1.2: Rebuild `prompt.get` Tool (Clean) ⏱️ 1 day

**Objective**: Build the dream `prompt.get` tool from scratch

**New Tool Specification:**

```typescript
// NEW: Clean interface - no file paths
interface PromptGetInput {
  project_name?: string; // e.g., "aismr"
  persona_name?: string; // e.g., "ideagenerator"
}

// Resolution logic (simple):
// 1. Both provided: find exact combination
// 2. Only persona: find persona-only prompt
// 3. Only project: find project-only prompt
// 4. Neither: error
// 5. Multiple matches: error with list
```

**Implementation Tasks:**

- [x] **Create New Tool File**
  - Build `src/server/tools/promptGetTool.ts` from scratch
  - Simple input schema (project_name, persona_name only)
  - No backward compatibility with filePath
- [x] **Metadata-Based Resolution**
  - Query vector DB by metadata filters only
  - Implement deterministic selection logic
  - Return full prompt content + metadata
- [x] **Error Handling**
  - Clear error messages for no matches
  - List available options for multiple matches
  - Validation for required fields

### Step 1.3: Rebuild Essential MCP Tools ⏱️ 1 day

**Objective**: Create minimal, focused MCP tools

**Tools to Rebuild (Simple Versions):**

- [x] **`prompts.search`** - Semantic search with project/persona filters only
- [x] **`prompts.list`** - Simple list of available prompts by metadata
- [x] **Remove operations tools** - These become REST endpoints instead

**Design Principles:**

- Single responsibility per tool
- No complex options or backward compatibility
- Focus on the core use cases only
- Clean, simple schemas

### Step 1.4: Build Clean Prompt Ingestion ⏱️ 1 day

**Objective**: Simplified prompt loading that works with existing JSON files

**Tasks:**

- [x] **Simplify Metadata Extraction**
  - Extract only: project_name, persona_name, content
  - Remove complex parsing of file names
  - Standardize metadata schema
- [x] **Database-First Approach**
  - Load prompts directly to vector DB
  - Remove file dependencies after initial load
  - Simple update mechanism via re-ingestion
- [x] **Test with Current Prompts**
  - Verify all 7 JSON prompts load correctly
  - Ensure metadata supports project/persona queries
  - Test new `prompt.get` tool resolves correctly

**Exit Criteria**: Clean MCP tools working, prompts in vector DB with simple metadata

---

## Phase 2: REST API Implementation (Week 1-2)

### Step 2.1: Build Clean REST Endpoints ⏱️ 1.5 days

**Objective**: Create focused REST API for operations data

**API Design (Minimal):**

```typescript
// Operations API - replace ALL Supabase calls
GET    /api/runs/:id           // Get run by ID
POST   /api/runs               // Create run
PUT    /api/runs/:id           // Update run
GET    /api/videos/:id         // Get video by ID
POST   /api/videos             // Create video
PUT    /api/videos/:id         // Update video
GET    /api/videos?project=X   // List videos by project

// Prompts API - HTTP version of MCP tools
GET    /api/prompts/resolve?project=X&persona=Y  // HTTP version of prompt.get
GET    /api/prompts/search?q=X&project=Y         // HTTP version of prompts.search
```

**Implementation Tasks:**

- [x] **Create Router Structure**
  - Build `src/server/routes/api.ts` - single router for all endpoints
  - Use existing `OperationsRepository`
  - Reuse MCP tool logic for prompt endpoints
- [x] **Extend Operations Repository**
  - Add missing CRUD methods: `createRun`, `updateRun`, `createVideo`, `updateVideo`
  - Keep methods simple and focused
  - No complex querying - delegate to dedicated endpoints
- [x] **Standard Response Format**
  - Consistent JSON response schema
  - Standard error format
  - Simple success/error status codes

### Step 2.2: Remove MCP Operations Tools ⏱️ 0.5 days

**Objective**: Delete redundant MCP tools that duplicate REST functionality

**Delete Tasks:**

- [x] Remove `src/server/tools/getRunTool.ts` (becomes `GET /api/runs/:id`)
- [x] Remove `src/server/tools/listVideosTool.ts` (becomes `GET /api/videos`)
- [x] Update MCP server registration to only include prompt tools

**Result**: Clean separation - MCP for AI tools, REST for automation

---

## Phase 3: n8n Integration (Week 2)

### Step 3.1: n8n SDK Setup ⏱️ 0.5 days

**Objective**: Add n8n workflow sync capability

**Tasks:**

- [x] **Install n8n SDK**
  - Add appropriate n8n package to dependencies
  - Create `scripts/n8nSync.ts` (single script for push/pull)
  - Add `n8n:push` and `n8n:pull` npm scripts
- [x] **Environment Setup**
  - Add `N8N_BASE_URL` and `N8N_API_KEY` to `.env.example` (Mylo Added these)
  - Test connection to n8n cloud

### Step 3.2: Aggressive Workflow Migration ⏱️ 2 days

**Objective**: Replace ALL Supabase calls with our server endpoints

**Migration Strategy:**

- [ ] **Inventory Supabase Calls**
  - Map every `supabase.*` node across all 11 workflows
  - Create direct replacement mapping to our REST endpoints
- [ ] **Mass Replace Operations**
  - `supabase.get(runs)` → `GET /api/runs/:id`
  - `supabase.getAll(videos)` → `GET /api/videos?project=X`
  - `supabase.update(runs)` → `PUT /api/runs/:id`
  - `supabase.create(videos)` → `POST /api/videos`
- [ ] **Replace Prompt Loading**
  - All prompt queries → MCP `prompt.get` with project/persona
  - Remove any file path references
  - Standardize on project/persona resolution only

**Aggressive Timeline**: Transform all workflows in 2 days, test rapidly, fix issues immediately

### Step 3.3: Validate Clean System ⏱️ 0.5 days

**Objective**: Ensure no legacy dependencies remain

**Validation Tasks:**

- [ ] **Dependency Audit**
  - Grep codebase for "supabase" - should find zero results
  - Grep workflows for "supabase" - should find zero results
  - Verify all n8n workflows use our server only
- [ ] **End-to-End Test**
  - Run complete AISMR workflow
  - Verify data flows only through our MCP/REST server
  - Test prompt resolution with project/persona parameters

**Exit Criteria**: Zero external dependencies, clean system working end-to-end

---

## Phase 4: Polish & Documentation (Week 3)

### Step 4.1: Code Cleanup ⏱️ 1 day

**Objective**: Remove any remaining legacy code and optimize

**Tasks:**

- [ ] **Delete Unused Files**
  - Remove any leftover legacy tool files
  - Delete unused utility functions
  - Clean up imports and dependencies
- [ ] **Optimize Performance**
  - Review database queries for efficiency
  - Simplify any overcomplicated logic
  - Ensure clean error handling throughout

### Step 4.2: Essential Documentation ⏱️ 1 day

**Objective**: Document the clean V1 system

**Documents to Create:**

- [ ] **`README.md`** - How to run the V1 system
- [ ] **`docs/API.md`** - REST endpoint documentation
- [ ] **`docs/MCP_TOOLS.md`** - MCP tool specifications
- [ ] **`docs/WORKFLOWS.md`** - n8n integration guide

**Documentation Principles:**

- Keep it short and practical
- Focus on the current V1 implementation only
- No legacy references or migration notes
- Clear examples for each endpoint/tool

---

## Success Criteria: V1 Complete

### ✅ **Technical Goals**

1. **Clean Codebase** - No legacy code, no backward compatibility, no dead files
2. **`prompt.get` Works** - Resolves prompts by `project_name + persona_name` only
3. **REST API Complete** - All operations via `/api/*` endpoints
4. **Zero Supabase** - No external database dependencies in any workflows
5. **n8n Sync** - `n8n:push` and `n8n:pull` work correctly

### ✅ **Operational Goals**

1. **Single Command Startup** - `npm run dev` starts everything needed
2. **Fast Development** - Clean, focused codebase easy to modify
3. **Clear Documentation** - New developers can understand system quickly
4. **Working Workflows** - All n8n workflows use our server exclusively

---

## Timeline: Aggressive V1 Schedule

| Phase                        | Duration | Key Deliverables                       |
| ---------------------------- | -------- | -------------------------------------- |
| **Phase 1: Core Rebuild**    | Week 1   | Clean MCP tools, vector DB only        |
| **Phase 2: REST API**        | Week 1-2 | Complete operations API, remove legacy |
| **Phase 3: n8n Integration** | Week 2   | All workflows migrated, no Supabase    |
| **Phase 4: Polish**          | Week 3   | Clean codebase, essential docs         |

**Total Time: 3 weeks maximum**

---

## V1 Development Principles

1. **Delete First** - Remove old code before building new
2. **No Backward Compatibility** - Build for the future, not the past
3. **Single Responsibility** - Each component does one thing well
4. **Fail Fast** - Catch issues early with aggressive testing
5. **Clean Interfaces** - Simple, predictable APIs and tools
6. **Documentation Last** - Document what we built, not what we planned

**Tasks:**

- [ ] **Validate JSON Structure**
  - Audit existing JSON files for consistent metadata schema
  - Ensure all files have `agent`, `persona`, `project` metadata fields
  - Standardize field names and structure across all prompts
- [ ] **Enhance Metadata Extraction**
  - Update `src/ingestion/metadata.ts` to parse enhanced JSON structure
  - Extract project/persona identifiers into searchable metadata fields
  - Ensure metadata includes normalized project_name and persona_name
- [ ] **Re-ingest Prompts**
  - Run full ingestion: `npm run ingest`
  - Verify metadata JSONB contains project/persona fields
  - Test semantic search with metadata filters

**Exit Criteria**: All prompts in vector DB with searchable project/persona metadata

### Step 1.3: Implement Enhanced `prompt.get` Tool ⏱️ 1 day

**Objective**: Enable `prompt.get` to accept `project_name` + `persona_name` instead of just `filePath`

**Current Tool Limitation:**

```typescript
// Current: requires filePath
{ filePath: "persona-chat.json", includeMetadata?: boolean }

// Target: should support project/persona resolution
{ project_name?: string, persona_name?: string, filePath?: string }
```

**Tasks:**

- [ ] **Extend Tool Interface**
  - Update `src/server/tools/getPromptTool.ts` input schema
  - Add `project_name` and `persona_name` optional parameters
  - Maintain backward compatibility with `filePath` parameter
- [ ] **Implement Resolution Logic**
  - Add metadata-based lookup in `PromptEmbeddingsRepository`
  - Implement deterministic prompt selection for project+persona combinations
  - Handle fallback scenarios (persona-only, project-only, exact filePath)
  - Return error for ambiguous matches with candidate list
- [ ] **Add Comprehensive Tests**
  - Test persona-only queries (`persona_name: "chat"`)
  - Test project-only queries (`project_name: "aismr"`)
  - Test combination queries (`persona_name: "ideagenerator", project_name: "aismr"`)
  - Test backward compatibility with `filePath`
  - Test error scenarios (no matches, multiple matches)

**Resolution Logic:**

```typescript
// Priority order:
1. filePath (if provided) - exact match
2. persona + project combination - specific prompt
3. persona-only - general persona prompt
4. project-only - general project prompt
5. Error if multiple candidates or no matches
```

**Exit Criteria**: `prompt.get` tool accepts project/persona parameters and resolves correctly

---

## Phase 2: REST API & Operations Integration (Week 1-2)

### Step 2.1: Design REST API Specification ⏱️ 0.5 days

**Objective**: Define comprehensive REST API for operations data access

**Tasks:**

- [ ] **Create API Specification**
  - Document `docs/api/REST_ENDPOINTS.md` with full API contract
  - Define request/response schemas for all endpoints
  - Specify authentication, rate limiting, error handling

**Target Endpoints:**

```typescript
// Operations endpoints (replace Supabase)
GET /api/runs/:id              - Get run by ID
GET /api/runs                  - List runs with filters
POST /api/runs                 - Create new run
PUT /api/runs/:id              - Update run
GET /api/videos/:id            - Get video by ID
GET /api/videos                - List videos with filters
POST /api/videos               - Create new video
PUT /api/videos/:id            - Update video

// Prompt endpoints (complement MCP)
GET /api/prompts/search        - Semantic search (HTTP version of MCP tool)
GET /api/prompts/:identifier   - Get prompt by project/persona or filePath
```

### Step 2.2: Implement REST Endpoints ⏱️ 2 days

**Objective**: Create HTTP API layer for operations database access

**Tasks:**

- [ ] **Create Router Structure**
  - Create `src/server/routes/` directory
  - Implement `operationsRouter.ts` for runs/videos endpoints
  - Implement `promptsRouter.ts` for prompt endpoints
  - Add router registration in `src/server.ts`
- [ ] **Operations Endpoints Implementation**
  - Leverage existing `OperationsRepository` methods
  - Add missing repository methods: `createRun`, `updateRun`, `createVideo`, `updateVideo`
  - Implement proper HTTP status codes and error handling
  - Add request validation using Zod schemas
- [ ] **Authentication & Security**
  - Extend existing API key authentication to REST routes
  - Apply same rate limiting as MCP endpoints
  - Add CORS configuration for REST endpoints
- [ ] **Response Formatting**
  - Standardize JSON response format
  - Convert timestamps to ISO 8601 strings
  - Include pagination metadata where applicable
  - Ensure consistent error response format

**Repository Extensions Needed:**

```typescript
// Add to OperationsRepository
async createRun(data: NewRun): Promise<Run>
async updateRun(id: string, data: Partial<Run>): Promise<Run | null>
async listRuns(filters: ListRunsOptions): Promise<Run[]>
async createVideo(data: NewVideo): Promise<Video>
async updateVideo(id: string, data: Partial<Video>): Promise<Video | null>
```

### Step 2.3: Integration Testing ⏱️ 1 day

**Objective**: Ensure REST endpoints work correctly and provide same data as MCP tools

**Tasks:**

- [ ] **Create Integration Test Suite**
  - Set up test database with sample data
  - Test all REST endpoints with supertest
  - Verify response schemas match specifications
  - Test authentication and authorization
- [ ] **Parity Testing**
  - Ensure `GET /api/runs/:id` returns same data as `runs_get` MCP tool
  - Ensure `GET /api/videos` returns same data as `videos_list` MCP tool
  - Test error scenarios and edge cases
- [ ] **Performance Testing**
  - Benchmark response times for typical queries
  - Test with realistic data volumes
  - Verify rate limiting works correctly

**Exit Criteria**: All REST endpoints functional, tested, and documented

---

## Phase 3: n8n Integration & Migration (Week 2)

### Step 3.1: n8n SDK Setup & Workflow Analysis ⏱️ 1 day

**Objective**: Prepare tooling for n8n workflow synchronization and analysis

**Tasks:**

- [ ] **SDK Installation & Configuration**
  - Research n8n SDK options (@n8n/api, n8n REST API client)
  - Add appropriate dependency to package.json
  - Create `scripts/n8nPull.ts` and `scripts/n8nPush.ts` skeleton
  - Add npm scripts: `n8n:pull`, `n8n:push`
- [ ] **Environment Setup**
  - Add `N8N_BASE_URL` and `N8N_API_KEY` to `.env.example`
  - Document n8n connection requirements
  - Test connection to n8n cloud instance
- [ ] **Workflow Inventory**
  - Create `docs/N8N_MIGRATION_ANALYSIS.md`
  - Catalog all Supabase nodes across 11 workflow files
  - Map each Supabase operation to equivalent REST endpoint
  - Identify transformation requirements (response format changes)

**Current Workflows to Analyze:**

```
✅ 11 workflow files identified:
- aismr.workflow.json
- chat.workflow.json
- edit-aismr.workflow.json
- generate-video.workflow.json
- hitl-temp.workflow.json
- idea-generator-v2.workflow.json
- idea-generator.workflow.json
- load-persona.workflow.json
- poll-db.workflow.json
- screen-writer.workflow.json
- upload-file-to-google-drive.workflow.json
- upload-to-tiktok.workflow.json
```

### Step 3.2: Workflow Migration Strategy ⏱️ 1 day

**Objective**: Plan systematic migration of workflows from Supabase to MCP/REST

**Migration Pattern Analysis:**

```typescript
// Current Supabase patterns:
"supabase.get" -> "GET /api/runs/:id"
"supabase.getAll" -> "GET /api/videos?projectId=x"
"supabase.update" -> "PUT /api/runs/:id"
"supabase.create" -> "POST /api/videos"

// Prompt loading patterns:
Supabase prompt queries -> MCP "prompt.get" tool calls
```

**Tasks:**

- [ ] **Create Migration Templates**
  - Design HTTP Request node templates for each operation type
  - Create data transformation Set nodes for response format changes
  - Prepare authentication configuration templates
- [ ] **Priority Workflow Selection**
  - Identify 2-3 critical workflows for initial migration
  - Choose workflows with simple Supabase dependencies first
  - Plan migration order to minimize disruption
- [ ] **Testing Strategy**
  - Plan how to test migrated workflows with pinned data
  - Set up parallel testing (old vs new endpoints)
  - Prepare rollback procedures

### Step 3.3: Critical Workflow Migration ⏱️ 2 days

**Objective**: Migrate priority workflows to use MCP server instead of Supabase

**High-Priority Workflows for Migration:**

1. `load-persona.workflow.json` - Core prompt loading
2. `idea-generator-v2.workflow.json` - Uses runs/videos operations
3. `poll-db.workflow.json` - Simple operations testing

**Tasks:**

- [ ] **Migrate `load-persona` Workflow**
  - Replace Supabase prompt queries with MCP `prompt.get` calls
  - Update to use `project_name` and `persona_name` parameters
  - Test prompt resolution works correctly
- [ ] **Migrate `idea-generator-v2` Workflow**
  - Replace `supabase.get` (runs) with `GET /api/runs/:id`
  - Replace `supabase.update` (runs) with `PUT /api/runs/:id`
  - Update data transformation for new response format
- [ ] **Migrate `poll-db` Workflow**
  - Replace `supabase.get` (videos) with `GET /api/videos/:id`
  - Test polling functionality with new endpoint
- [ ] **Environment Configuration**
  - Set up centralized MCP server base URL configuration
  - Configure API key authentication for workflows
  - Test connectivity from n8n cloud to MCP server
- [ ] **Validation Testing**
  - Test each migrated workflow with real data
  - Compare outputs with original Supabase versions
  - Document any behavioral differences

**Exit Criteria**: 3 priority workflows successfully migrated and tested

---

## Phase 4: Full System Integration (Week 3)

### Step 4.1: Complete Workflow Migration ⏱️ 2 days

**Objective**: Migrate all remaining workflows to use MCP/REST architecture

**Remaining Workflows:**

- `aismr.workflow.json`
- `chat.workflow.json`
- `edit-aismr.workflow.json`
- `generate-video.workflow.json`
- `hitl-temp.workflow.json`
- `idea-generator.workflow.json`
- `screen-writer.workflow.json`
- `upload-file-to-google-drive.workflow.json`
- `upload-to-tiktok.workflow.json`

**Tasks:**

- [ ] **Systematic Migration**
  - Migrate 2-3 workflows per batch
  - Test each batch before proceeding
  - Update `docs/N8N_MIGRATION_ANALYSIS.md` with progress
- [ ] **Complex Workflow Handling**
  - Handle workflows with multiple Supabase operations
  - Ensure proper error handling and fallback logic
  - Test workflow chains and dependencies
- [ ] **Prompt Loading Standardization**
  - Ensure all workflows use `prompt.get` with project/persona parameters
  - Remove any direct file path references
  - Standardize prompt composition patterns

### Step 4.2: n8n Synchronization Implementation ⏱️ 1 day

**Objective**: Complete n8n SDK integration for bidirectional sync

**Tasks:**

- [ ] **Complete SDK Scripts**
  - Implement `scripts/n8nPull.ts` to download workflows from n8n cloud
  - Implement `scripts/n8nPush.ts` to upload local workflows to n8n cloud
  - Add conflict resolution and --force flag support
- [ ] **Sync Validation**
  - Test round-trip sync: `npm run n8n:pull && npm run n8n:push`
  - Ensure idempotent operation (no changes after round-trip)
  - Verify all workflow metadata preserved
- [ ] **Documentation**
  - Create `docs/N8N_SYNC_GUIDE.md` with usage instructions
  - Document conflict resolution procedures
  - Add troubleshooting section

### Step 4.3: System Validation & Testing ⏱️ 1 day

**Objective**: End-to-end system testing to ensure alignment works

**Test Scenarios:**

1. **Prompt Resolution Flow**
   - n8n calls `prompt.get` with project/persona
   - MCP server resolves correct prompt from vector DB
   - Response includes full prompt content and metadata
2. **Operations Data Flow**
   - n8n calls REST endpoints for runs/videos operations
   - Data consistency between MCP tools and REST endpoints
   - Error handling and recovery scenarios
3. **Full Workflow Execution**
   - Execute complete aismr workflow end-to-end
   - Verify all data flows through MCP/REST architecture
   - Confirm no Supabase dependencies remain

**Tasks:**

- [ ] **Integration Test Suite**
  - Create comprehensive test scenarios
  - Test with realistic data volumes
  - Verify performance meets requirements
- [ ] **Monitoring Setup**
  - Configure structured logging for MCP server
  - Set up metrics collection for REST endpoints
  - Create dashboards for system health monitoring
- [ ] **Rollback Testing**
  - Verify rollback procedures work correctly
  - Test system recovery from various failure modes
  - Document incident response procedures

**Exit Criteria**: Full system integration working, all tests passing, monitoring active

---

## Phase 5: Documentation & Production Readiness (Week 3-4)

### Step 5.1: Comprehensive Documentation ⏱️ 1 day

**Objective**: Complete system documentation for operators and developers

**Tasks:**

- [ ] **System Architecture Documentation**
  - Update `README.md` with new architecture overview
  - Document MCP + REST dual interface design
  - Create system diagrams showing data flows
- [ ] **API Documentation**
  - Complete `docs/api/MCP_TOOLS.md` with all tool specifications
  - Complete `docs/api/REST_ENDPOINTS.md` with full API reference
  - Include authentication, rate limiting, error handling details
- [ ] **Operational Guides**
  - Create `docs/OPERATIONS_GUIDE.md` for system administrators
  - Document deployment procedures and environment setup
  - Include monitoring, backup, and recovery procedures
- [ ] **Developer Guide**
  - Create `docs/DEVELOPER_GUIDE.md` for contributors
  - Document development workflow and testing procedures
  - Include troubleshooting and debugging guides

### Step 5.2: Production Deployment Preparation ⏱️ 1 day

**Objective**: Prepare system for production deployment

**Tasks:**

- [ ] **Production Configuration**
  - Review and harden security settings
  - Configure production database settings
  - Set up production monitoring and alerting
- [ ] **Performance Optimization**
  - Optimize database queries and indexes
  - Configure connection pooling for production load
  - Set appropriate rate limits and timeouts
- [ ] **Backup and Recovery**
  - Set up automated database backups
  - Test backup restoration procedures
  - Document disaster recovery procedures
- [ ] **CI/CD Pipeline**
  - Set up automated testing and deployment
  - Configure environment promotion procedures
  - Test rollback and rollforward procedures

### Step 5.3: Final Validation & Handoff ⏱️ 0.5 days

**Objective**: Final system validation and knowledge transfer

**Tasks:**

- [ ] **Production Readiness Checklist**
  - Complete security audit
  - Verify all documentation is current
  - Test all monitoring and alerting systems
- [ ] **Knowledge Transfer**
  - Conduct system walkthrough with operators
  - Provide training on new architecture and tools
  - Establish support procedures and escalation paths
- [ ] **Go-Live Preparation**
  - Schedule production deployment
  - Prepare communication plan for users
  - Set up post-deployment monitoring and support

**Exit Criteria**: System ready for production deployment with full documentation and support

---

## Success Metrics & Validation

### Technical Success Criteria

1. **✅ MCP Server Functionality**
   - `/mcp` endpoint responds with 6+ functional tools
   - `prompt.get` resolves prompts by project_name + persona_name
   - All tools return consistent, documented responses
   - Response times < 500ms for 95% of requests

2. **✅ Vector Database Integration**
   - All prompts stored with searchable project/persona metadata
   - Semantic search works with metadata filters
   - Incremental updates work correctly
   - Database queries optimized for performance

3. **✅ REST API Functionality**
   - All operations endpoints functional and documented
   - Authentication and rate limiting working
   - Response schemas consistent and validated
   - Error handling comprehensive and helpful

4. **✅ n8n Integration**
   - All workflows migrated from Supabase to MCP/REST
   - `n8n:pull` and `n8n:push` scripts working
   - Workflow synchronization is idempotent
   - No Supabase dependencies remain

5. **✅ System Alignment**
   - Single source of truth: Vector DB for prompts, SQL DB for runs/videos
   - Consistent data access patterns across all interfaces
   - Monitoring and alerting functional
   - Documentation complete and current

### Operational Success Criteria

1. **✅ Reliability**
   - System uptime > 99.5%
   - Error rates < 1% for normal operations
   - Recovery time < 5 minutes for common failures
   - All failure modes documented with recovery procedures

2. **✅ Performance**
   - MCP tool responses < 500ms p95
   - REST API responses < 200ms p95
   - Vector search results < 1 second p95
   - System handles 100+ concurrent requests

3. **✅ Maintainability**
   - All components have comprehensive tests
   - Documentation kept current with system changes
   - Development workflow clearly defined
   - Rollback procedures tested and documented

---

## Risk Mitigation

### High-Risk Areas

1. **Data Migration Integrity**
   - **Risk**: Loss of prompt data or metadata during migration
   - **Mitigation**: Comprehensive backups, incremental testing, validation scripts
   - **Rollback**: Maintain original prompt files and database backups

2. **n8n Workflow Breaking Changes**
   - **Risk**: Migrated workflows fail in production
   - **Mitigation**: Parallel testing, gradual rollout, extensive validation
   - **Rollback**: Quick revert to Supabase endpoints if needed

3. **Performance Degradation**
   - **Risk**: New architecture slower than current system
   - **Mitigation**: Performance testing, optimization, monitoring
   - **Rollback**: Performance budgets and automatic rollback triggers

4. **API Compatibility Issues**
   - **Risk**: n8n integration breaks due to API changes
   - **Mitigation**: Comprehensive testing, API versioning, error handling
   - **Rollback**: Maintain compatibility layer for transition period

### Contingency Plans

1. **Hybrid Operation Mode**: Run both old and new systems in parallel during transition
2. **Staged Rollout**: Migrate workflows in batches with validation checkpoints
3. **Quick Rollback**: Maintain ability to quickly revert to Supabase-based workflows
4. **Monitoring Alerts**: Automated detection of system issues with escalation procedures

---

## Timeline Summary

| Phase                      | Duration | Key Deliverables                                             |
| -------------------------- | -------- | ------------------------------------------------------------ |
| **Phase 1: Foundation**    | Week 1   | Enhanced prompt.get, structured prompts, metadata extraction |
| **Phase 2: REST API**      | Week 1-2 | Complete REST endpoints, operations integration              |
| **Phase 3: n8n Migration** | Week 2   | SDK setup, priority workflow migration                       |
| **Phase 4: Integration**   | Week 3   | Full workflow migration, system validation                   |
| **Phase 5: Production**    | Week 3-4 | Documentation, deployment preparation                        |

**Total Estimated Time: 3-4 weeks**

---

## Dependencies & Prerequisites

### External Dependencies

- [ ] n8n cloud instance access and API credentials
- [ ] OpenAI API access for embeddings
- [ ] PostgreSQL instances (vector and operations databases)
- [ ] Cloudflare tunnel configuration

### Internal Prerequisites

- [ ] Current system baseline established and documented
- [ ] All existing tests passing
- [ ] Development environment properly configured
- [ ] Team trained on new architecture concepts

---

## Conclusion

This plan provides a comprehensive roadmap to achieve full system alignment with the MCP-based architecture. The sequential approach ensures minimal risk while systematically addressing all gaps identified in the current implementation.

The key transformation is moving from a Supabase-dependent system to a unified MCP+REST architecture where:

- **Vector database** serves as the source of truth for prompts with semantic search capabilities
- **SQL database** handles operational data (runs/videos) only
- **MCP server** provides AI-friendly tool interfaces
- **REST API** provides standard HTTP interfaces for automation
- **n8n workflows** use the unified server instead of direct database access

Upon completion, we will have a robust, aligned system that supports both AI agent interactions through MCP and standard automation through REST APIs, with comprehensive tooling for maintaining workflow synchronization.

---

**Document Version:** 1.0  
**Last Updated:** 2025-10-29  
**Status:** Ready for Implementation
