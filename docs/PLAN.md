# RAG Modernization Plan: From Static to Adaptive Agentic Memory

**Date:** October 30, 2025  
**Based On:** REVIEW.md + REVIEW-CODEX.md analysis  
**Goal:** Transform current static RAG into adaptive agentic memory system  
**Timeline:** 12 weeks (3 phases)

---

## Executive Summary

This plan transforms our B+ static RAG implementation into a production-grade adaptive agentic memory system aligned with 2024-2025 research standards. We'll build incrementally on our solid foundation (pgvector, OpenAI embeddings, MCP architecture) without requiring a complete rewrite.

**Current State:** Static vector search with metadata filtering  
**Target State:** Multi-component adaptive memory with hybrid search, episodic storage, and runtime learning

---

## Phase 1: Foundation Enhancements (Weeks 1-4)

### Milestone 1.1: Hybrid Search Implementation

**Goal:** Add keyword search alongside vector similarity for better precision on technical terms and exact matches.

#### Step 1.1.1: Add Full-Text Search Capabilities

- [x] **Add tsvector column to schema**
  - [x] Create migration `0002_add_fulltext_search.sql`
  - [x] Add `textsearch tsvector` column to `prompt_embeddings` table
  - [x] Add GIN index for full-text search: `CREATE INDEX idx_textsearch ON prompt_embeddings USING gin(textsearch)`
  - [x] Add trigger to auto-update tsvector on insert/update:
    ```sql
    CREATE TRIGGER tsvector_update BEFORE INSERT OR UPDATE
    ON prompt_embeddings FOR EACH ROW EXECUTE FUNCTION
    tsvector_update_trigger(textsearch, 'pg_catalog.english', chunk_text, raw_markdown);
    ```

- [x] **Update schema types**
  - [x] Add `textsearch` field to `PromptEmbedding` interface in `src/db/schema.ts`
  - [x] Update Drizzle schema definition
  - [x] Run migration and verify index creation

- [x] **Test full-text search**
  - [x] Write test query: `SELECT * FROM prompt_embeddings WHERE textsearch @@ to_tsquery('screenwriter & aismr')`
  - [x] Verify results match expected prompts
  - [x] Test ranking with `ts_rank(textsearch, query)`

**Files to modify:**

- `drizzle/0002_add_fulltext_search.sql` (new)
- `src/db/schema.ts`
- `drizzle.config.ts` (verify migration path)

**Exit Criteria:** Full-text search returns relevant results for keyword queries

---

#### Step 1.1.2: Implement BM25 Keyword Search Repository Method

- [x] **Add keyword search method to repository**
  - [x] Create `keywordSearch(query: string, filters: MetadataFilters): Promise<SearchResult[]>` in `PromptEmbeddingsRepository`
  - [x] Implement ts_query parsing from natural language query
  - [x] Use `ts_rank_cd` for relevance scoring
  - [x] Apply persona/project metadata filters
  - [x] Return normalized results matching `SearchResult` interface

- [x] **Add configuration options**
  - [x] Add `FULLTEXT_SEARCH_WEIGHTS` to config (A: 1.0, B: 0.4, C: 0.2, D: 0.1)
  - [x] Add `FULLTEXT_MIN_SCORE` threshold (default: 0.1)
  - [x] Make language configurable (default: 'english')

- [x] **Write unit tests**
  - [x] Test exact phrase matching
  - [x] Test multi-word queries
  - [x] Test stop word handling
  - [x] Test with metadata filters
  - [x] Test empty results handling

**Files to modify:**

- `src/db/repository.ts`
- `src/config/index.ts`
- `src/db/repository.test.ts` (new tests)

**Exit Criteria:** Keyword search method passes all tests and returns ranked results

---

#### Step 1.1.3: Implement Reciprocal Rank Fusion (RRF)

- [x] **Create RRF utility function**
  - [x] Create `src/vector/hybridSearch.ts`
  - [x] Implement RRF algorithm:
    ```typescript
    function reciprocalRankFusion(results: SearchResult[][], k: number = 60): SearchResult[];
    ```
  - [x] Formula: `score = sum(1 / (k + rank_i))` across all result lists
  - [x] Handle duplicate results (merge by chunk_id)
  - [x] Preserve metadata from highest-scoring source

- [x] **Add configuration**
  - [x] Add `HYBRID_RRF_K` parameter (default: 60)
  - [x] Add `HYBRID_VECTOR_WEIGHT` (default: 0.6)
  - [x] Add `HYBRID_KEYWORD_WEIGHT` (default: 0.4)

- [x] **Write comprehensive tests**
  - [x] Test with identical result sets (should equal input)
  - [x] Test with disjoint result sets (should merge)
  - [x] Test with overlapping results (should favor consensus)
  - [x] Test empty input handling
  - [x] Test single-source input

**Files to create:**

- `src/vector/hybridSearch.ts`
- `src/vector/hybridSearch.test.ts`

**Exit Criteria:** RRF correctly merges vector and keyword results with proper scoring

---

#### Step 1.1.4: Update Search Tool with Hybrid Mode

- [x] **Add hybrid search mode to promptSearchTool**
  - [x] Add `searchMode: 'vector' | 'keyword' | 'hybrid'` parameter (default: 'hybrid')
  - [x] Update input schema validation
  - [x] Implement mode switching logic:
    - Vector: existing cosine similarity search
    - Keyword: new BM25 search
    - Hybrid: both + RRF fusion

- [x] **Update search execution**
  - [x] For hybrid mode, run vector and keyword searches in parallel
  - [x] Apply RRF to merge results
  - [x] Filter by combined score threshold
  - [x] Return top-k after fusion

- [x] **Update tool documentation**
  - [x] Document searchMode parameter
  - [x] Add usage examples for each mode
  - [x] Document when to use each mode

- [x] **Write integration tests**
  - [x] Test all three modes with same query
  - [x] Verify hybrid returns better results than either alone
  - [x] Test with technical terms (should favor keyword)
  - [x] Test with semantic queries (should favor vector)

**Files to modify:**

- `src/server/tools/promptSearchTool.ts`
- `src/server/tools/promptSearchTool.test.ts`

**Exit Criteria:** Hybrid search demonstrably improves precision over vector-only

---

### Milestone 1.2: Query Intent Classification

**Goal:** Automatically route queries to appropriate search modes and filters without manual specification.

#### Step 1.2.1: Create Query Intent Classifier

- [x] **Design intent taxonomy**
  - [x] Define intents: `persona_lookup`, `project_lookup`, `combination_lookup`, `general_knowledge`, `workflow_step`, `example_request`
  - [x] Map intents to filter strategies
  - [x] Document intent → filter rules

- [x] **Implement LLM-based classifier**
  - [x] Create `src/vector/queryClassifier.ts`
  - [x] Implement classifier function:
    ```typescript
    async function classifyQueryIntent(query: string): Promise<{
      intent: QueryIntent;
      extractedPersona?: string;
      extractedProject?: string;
      confidence: number;
    }>;
    ```
  - [x] Use GPT-4o-mini for cost efficiency
  - [x] Design classification prompt with few-shot examples
  - [x] Parse structured output (JSON mode)

- [x] **Add caching layer**
  - [x] Implement in-memory LRU cache (max 1000 entries)
  - [x] Cache key: hash of query string
  - [x] TTL: 1 hour
  - [x] Add cache hit metrics

- [x] **Write tests**
  - [x] Test persona intent: "What is the screenwriter persona?"
  - [x] Test project intent: "Tell me about the AISMR project"
  - [x] Test combination: "How does screenwriter work with AISMR?"
  - [x] Test general: "What are the best practices for video generation?"
  - [x] Test edge cases (empty query, very long query)

**Files to create:**

- `src/vector/queryClassifier.ts`
- `src/vector/queryClassifier.test.ts`

**Exit Criteria:** Classifier achieves >90% accuracy on test set of 50 queries

---

### Milestone 1.3: Episodic Memory Persistence (Weeks 3-4)

**Goal:** Capture conversational turns in episodic storage so downstream tools can recall recent interactions.

#### Step 1.3.1: Provision Episodic Schema

- [x] **Create migration `0004_add_episodic_memory.sql`**
  - [x] Define `conversation_role` enum
  - [x] Create `conversation_turns` table with UUID keys and metadata JSONB
  - [x] Add unique `(session_id, turn_index)` constraint plus supporting indexes
  - [x] Register migration hash in `drizzle.__drizzle_migrations` and `_journal.json`
- [x] **Verify deployment**
  - [x] Run `npm run db:migrate` locally (no-op after manual apply)
  - [x] Inspect table via `\d conversation_turns`
  - [x] Document prod/staging rollout procedure

#### Step 1.3.2: Wire Store Tool Output

- [x] Ensure `conversation_store` fills in metadata defaults (`source`, `tags`)
- [x] Normalize `storedAt` to ISO 8601 with offset to satisfy MCP validation
- [x] Add structured metadata for request checksum / client identity (follow-up)

#### Step 1.3.3: End-to-End Validation & Follow-ups

- [x] Smoke-test with `ts-node` script calling `storeConversationTurn`
- [x] Confirm n8n workflow uses longer HTTP timeout (15s) to avoid premature aborts
- [x] Add automated regression covering repository insert + embedding write
- [x] Backfill existing runs into episodic memory (pending size estimate)
  - Implemented via `scripts/backfillRunsToEpisodic.ts` with `npm run episodic:backfill`.

**Exit Criteria:** `conversation_store` reliably creates episodic chunks and recall benchmarks can read them end-to-end

---

#### Step 1.2.2: Implement Automatic Filter Application

- [x] **Create query enhancer**
  - [x] Create `src/vector/queryEnhancer.ts`
  - [x] Implement `enhanceQuery(query: string): Promise<EnhancedQuery>`
  - [x] Extract persona/project from natural language:
    - "screenwriter" → persona filter
    - "aismr" → project filter
  - [x] Normalize extracted terms to slugs
  - [x] Validate against known personas/projects

- [x] **Update search tool to use classifier**
  - [x] Add `autoFilter: boolean` parameter (default: true)
  - [x] If autoFilter=true and no explicit filters:
    - Call queryClassifier
    - Apply extracted filters
    - Log auto-applied filters in response
  - [x] If explicit filters provided, skip classification
  - [x] Add `appliedFilters.auto: boolean` to output

- [x] **Add fallback logic**
  - [x] If classifier fails (error/timeout), proceed without filters
  - [x] Log classification failures for monitoring
  - [x] Add retry logic (max 1 retry with exponential backoff)

- [x] **Write integration tests**
  - [x] Test auto-filtering on persona query
  - [x] Test auto-filtering on project query
  - [x] Test override behavior (explicit filters take precedence)
  - [x] Test fallback on classifier failure

**Files to modify:**

- `src/vector/queryEnhancer.ts` (new)
- `src/server/tools/promptSearchTool.ts`
- `src/server/tools/promptSearchTool.test.ts`

**Exit Criteria:** Search tool automatically applies correct filters 85%+ of the time

---

#### Step 1.2.3: Implement Search Mode Auto-Selection

- [x] **Create mode selector**
  - [x] Add `selectSearchMode(query: string, intent: QueryIntent): SearchMode`
  - [x] Rules:
    - Technical terms / IDs → keyword mode
    - Semantic concepts → vector mode
    - Default → hybrid mode
  - [x] Use simple heuristics (presence of quotes, technical patterns)

- [x] **Update search tool**
  - [x] If `searchMode` not specified and `autoFilter=true`:
    - Detect best mode from query
    - Apply automatically
    - Log selected mode in response
  - [x] Add `appliedFilters.searchMode: 'auto' | 'manual'`

- [x] **Add configuration**
  - [x] `AUTO_MODE_ENABLED` (default: true)
  - [x] `TECHNICAL_PATTERN_REGEX` (configurable patterns)
  - [x] Mode selection weights/thresholds

- [x] **Write tests**
  - [x] Test keyword selection for technical queries
  - [x] Test vector selection for conceptual queries
  - [x] Test hybrid as default
  - [x] Test manual override

**Files to modify:**

- `src/vector/queryEnhancer.ts`
- `src/server/tools/promptSearchTool.ts`
- `src/config/index.ts`

**Exit Criteria:** Auto-selected mode matches optimal mode in 80%+ of test cases

---

### Milestone 1.3: Temporal Weighting

**Goal:** Boost recent content in search results to prioritize up-to-date information.

#### Step 1.3.1: Add Temporal Decay Function

- [x] **Implement decay algorithms**
  - [x] Create `src/vector/temporalScoring.ts`
  - [x] Implement exponential decay: `score * exp(-lambda * age_days)`
  - [x] Implement linear decay: `score * max(0, 1 - age_days / max_age)`
  - [x] Make decay function configurable

- [x] **Add configuration**
  - [x] `TEMPORAL_DECAY_ENABLED` (default: false for now)
  - [x] `TEMPORAL_DECAY_FUNCTION` ('exponential' | 'linear' | 'none')
  - [x] `TEMPORAL_DECAY_HALFLIFE_DAYS` (default: 90)
  - [x] `TEMPORAL_DECAY_MAX_AGE_DAYS` (default: 365)

- [x] **Write tests**
  - [x] Test exponential decay formula
  - [x] Test linear decay formula
  - [x] Test edge cases (age = 0, age > max)
  - [x] Test score preservation when disabled

**Files to create:**

- `src/vector/temporalScoring.ts`
- `src/vector/temporalScoring.test.ts`

---

#### Step 1.3.2: Update Repository Search to Apply Temporal Boost

- [x] **Modify search query**
  - [x] Calculate age in days: `EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400`
  - [x] Apply decay formula in SQL:
    ```sql
    (1 - (embedding <=> embedding_literal)) *
    EXP(-0.007 * EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400) AS similarity
    ```
  - [x] Make decay factor configurable
  - [x] Only apply when `TEMPORAL_DECAY_ENABLED=true`

- [x] **Add temporal parameters**
  - [x] Add `applyTemporalDecay: boolean` to `SearchParameters`
  - [x] Add `temporalDecayConfig` optional parameter
  - [x] Default to config values if not specified

- [x] **Test with real data**
  - [x] Create test prompts with different ages
  - [x] Verify newer prompts rank higher with same semantic similarity
  - [x] Verify old prompts can still win with much higher similarity
  - [x] Test disable mode (should behave as before)

**Files to modify:**

- `src/db/repository.ts`
- `src/db/repository.test.ts`

**Exit Criteria:** Temporal decay correctly boosts recent content without eliminating relevant old content

---

#### Step 1.3.3: Expose Temporal Control in Search Tool

- [x] **Add temporal parameters to search tool**
  - [x] Add optional `temporalBoost: boolean` parameter
  - [x] Add optional `temporalConfig` parameter
  - [x] Pass through to repository search

- [x] **Update documentation**
  - [x] Document temporal boosting behavior
  - [x] Provide examples of when to enable/disable
  - [x] Document configuration options

- [x] **Add to output metadata**
  - [x] Include `temporalDecayApplied: boolean` in response
  - [x] Include decay config used
  - [x] Add age_days to each result (optional)

**Files to modify:**

- `src/server/tools/promptSearchTool.ts`

**Exit Criteria:** Temporal boosting available and controllable via MCP tool

---

## Phase 2: Memory Architecture Evolution (Weeks 5-8)

### Milestone 2.1: Multi-Component Memory System

**Goal:** Separate memory into distinct components (persona, project, episodic, semantic) with dedicated storage and routing.

#### Step 2.1.1: Design Memory Component Architecture

- [x] **Document memory taxonomy**
  - [x] Create `docs/MEMORY_ARCHITECTURE.md`
  - [x] Define memory types:
    - **Persona Memory**: Identity, role, style, capabilities
    - **Project Memory**: Project context, goals, specifications
    - **Semantic Memory**: General knowledge, workflows, best practices
    - **Episodic Memory**: Conversation history, user interactions (new)
    - **Procedural Memory**: Workflow steps, action sequences (new)
  - [x] Define routing rules for each type
  - [x] Document cross-component relationships

- [x] **Design database schema**
  - [x] Option A: Separate tables per memory type
  - [x] Option B: Single table with memory_type column + filtered indices
  - [x] Option C: Separate databases (over-engineering)
  - [x] **Decision:** Go with Option B for simplicity with dedicated indices

- [x] **Create migration plan**
  - [x] Map existing prompts to new memory types
  - [x] Define data transformation logic
  - [x] Plan zero-downtime migration strategy

**Files to create:**

- `docs/MEMORY_ARCHITECTURE.md`

**Exit Criteria:** Memory architecture documented and reviewed

---

#### Step 2.1.2: Create Memory Component Tables/Indices

- [x] **Add memory_type to schema**
  - [x] Create migration `0003_add_memory_components.sql`
  - [x] Add `memory_type` enum: `persona | project | semantic | episodic | procedural`
  - [x] Add `memory_type` column with default 'semantic'
  - [x] Create partial indices per memory type:
    ```sql
    CREATE INDEX idx_persona_memory ON prompt_embeddings(updated_at)
    WHERE memory_type = 'persona';
    ```
  - [x] Add GIN index on metadata per type for faster filtering

- [x] **Update existing data**
  - [x] Write data migration script
  - [x] Classify existing prompts:
    - `metadata.type = 'persona'` → memory_type = 'persona'
    - `metadata.type = 'project'` → memory_type = 'project'
    - `metadata.type = 'combination'` → memory_type = 'semantic'
  - [x] Run migration in transaction with rollback

- [x] **Update schema types**
  - [x] Add `memoryType` field to schema.ts
  - [x] Update repository types
  - [x] Update ingestion types

**Files to modify:**

- `drizzle/0003_add_memory_components.sql` (new)
- `src/db/schema.ts`
- `scripts/migrateMemoryTypes.ts` (new)

**Exit Criteria:** All prompts classified into memory types with proper indices

---

#### Step 2.1.3: Implement Memory Component Repository

- [x] **Create component-specific search methods**
  - [x] `searchPersonaMemory(query, filters): Promise<SearchResult[]>`
  - [x] `searchProjectMemory(query, filters): Promise<SearchResult[]>`
  - [x] `searchSemanticMemory(query, filters): Promise<SearchResult[]>`
  - [x] `searchEpisodicMemory(query, filters, timeRange?): Promise<SearchResult[]>`
  - [x] Each method filters by memory_type automatically

- [x] **Implement cross-component search**
  - [x] `searchAllMemory(query, types: MemoryType[]): Promise<MemorySearchResult[]>`
  - [x] Return results grouped by memory type
  - [x] Apply type-specific ranking weights
  - [x] Merge results with component attribution

- [x] **Add memory type to search parameters**
  - [x] Add `memoryTypes?: MemoryType[]` to SearchParameters
  - [x] Filter query by memory types if specified
  - [x] Default to all types if not specified

**Files to modify:**

- `src/db/repository.ts`
- `src/db/repository.test.ts`

**Exit Criteria:** Can search specific memory components independently

---

#### Step 2.1.4: Create Memory Router

- [x] **Implement routing logic**
  - [x] Create `src/vector/memoryRouter.ts`
  - [x] Implement `routeQuery(query: string, intent: QueryIntent): MemoryType[]`
  - [x] Routing rules:
    - "Who am I?" / "What's my role?" → persona
    - "What is project X?" → project
    - "How do I..." / "Best practices for..." → semantic
    - "What did we discuss?" / "Yesterday I said..." → episodic
    - "What are the steps for..." → procedural
  - [x] Return ordered list of memory types to search

- [x] **Implement multi-component query orchestration**
  - [x] Create `orchestrateMemorySearch(query: string): Promise<MultiComponentResult>`
  - [x] Classify query intent
  - [x] Route to appropriate memory components
  - [x] Execute searches in parallel
  - [x] Merge and rank results
  - [x] Return with component attribution

- [x] **Add routing metrics**
  - [x] Log routing decisions
  - [x] Track search count per memory type
  - [x] Measure cross-component query latency

- [x] **Write tests**
  - [x] Test persona query routing
  - [x] Test project query routing
  - [x] Test multi-component queries
  - [x] Test fallback to all components

**Files to create:**

- `src/vector/memoryRouter.ts`
- `src/vector/memoryRouter.test.ts`

**Exit Criteria:** Router correctly identifies target memory components for 90%+ of queries

---

#### Step 2.1.5: Update Search Tool with Memory Routing

- [x] **Add memory-aware search mode**
  - [x] Add `useMemoryRouting: boolean` parameter (default: false initially)
  - [x] When enabled, use memoryRouter instead of single search
  - [x] Return component-attributed results
  - [x] Include routing decision in response metadata

- [x] **Update output schema**
  - [x] Add `memoryComponent: MemoryType` to each result
  - [x] Add `routingDecision` to metadata
  - [x] Add `componentsSearched: MemoryType[]`

- [x] **Add gradual rollout control**
  - [x] Feature flag: `MEMORY_ROUTING_ENABLED`
  - [x] Percentage rollout: `MEMORY_ROUTING_ROLLOUT_PCT`
  - [x] Allow per-request override

- [x] **Write integration tests**
  - [x] Test routing with persona queries
  - [x] Test routing with project queries
  - [x] Test multi-component result merging
  - [x] Test fallback when routing disabled

**Files to modify:**

- `src/server/tools/promptSearchTool.ts`
- `src/config/index.ts`

**Exit Criteria:** Memory routing available behind feature flag, testable in production

---

### Milestone 2.2: Episodic Memory System

**Goal:** Store and retrieve conversation history to enable long-term dialogue coherence.

#### Step 2.2.1: Design Episodic Memory Schema

- [x] **Define conversation data model**
  - [x] Create `docs/EPISODIC_MEMORY_DESIGN.md`
  - [x] Design schema:
    ```typescript
    interface ConversationTurn {
      id: uuid;
      session_id: uuid;
      user_id?: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: timestamptz;
      metadata: jsonb;
    }
    ```
  - [x] Design indexing strategy (timestamp, session, user)
  - [x] Plan embedding strategy (full turn vs. summary)

- [x] **Create database migration**
  - [x] Create `0004_add_episodic_memory.sql`
  - [x] Create `conversation_turns` table
  - [x] Add to `prompt_embeddings` or separate? **Decision: Add to prompt_embeddings with memory_type='episodic'**
  - [x] Add session index, user index, timestamp index
  - [x] Add vector index for conversation embeddings

- [x] **Design retention policy**
  - [x] Define TTL: keep 90 days, summarize and archive older
  - [x] Plan summarization strategy
  - [x] Define storage limits per user/session

**Files to create:**

- `docs/EPISODIC_MEMORY_DESIGN.md`
- `drizzle/0004_add_episodic_memory.sql` (new)

**Exit Criteria:** Episodic memory schema designed and migration created

---

#### Step 2.2.2: Implement Conversation Storage

- [x] **Create episodic memory repository**
  - [x] Create `src/db/episodicRepository.ts`
  - [x] Implement `storeConversationTurn(turn: ConversationTurn): Promise<void>`
  - [x] Implement `getSessionHistory(sessionId: uuid): Promise<ConversationTurn[]>`
  - [x] Implement `searchConversationHistory(query: string, filters): Promise<ConversationTurn[]>`
  - [x] Use same vector search but filtered to memory_type='episodic'

- [x] **Implement auto-embedding**
  - [x] Embed conversation turn content on store
  - [x] Generate contextual summary for metadata
  - [x] Extract keywords/entities from conversation
  - [x] Store with session context

- [x] **Add session management**
  - [x] Create session on first interaction
  - [x] Track session start/end times
  - [x] Associate turns with sessions
  - [x] Support session retrieval by ID or time range

- [x] **Write tests**
  - [x] Test single turn storage
  - [x] Test multi-turn conversation storage
  - [x] Test session history retrieval
  - [x] Test conversation search
  - [x] Test embedding generation

**Files to create:**

- `src/db/episodicRepository.ts`
- `src/db/episodicRepository.test.ts`

**Exit Criteria:** Can store and retrieve conversation history with embeddings

---

#### Step 2.2.3: Create Conversation Memory MCP Tool

- [x] **Design tool interface**
  - [x] Tool name: `conversation.remember`
  - [x] Inputs:
    - `query: string` - what to search for in history
    - `sessionId?: uuid` - limit to specific session
    - `timeRange?: { start, end }` - time window
    - `limit?: number` - max results
  - [x] Outputs:
    - `turns: ConversationTurn[]` - matching conversation history
    - `context: string` - summarized context
    - `appliedFilters: object`

- [x] **Implement tool**
  - [x] Create `src/server/tools/conversationMemoryTool.ts`
  - [x] Implement search logic using episodicRepository
  - [x] Add relevance filtering
  - [x] Generate context summary from results
  - [x] Register with MCP server

- [x] **Add context injection helper**
  - [x] Create utility to format conversation history for prompts
  - [x] Support different formats (chat, narrative, bullets)
  - [x] Add token counting to avoid context overflow
  - [x] Implement smart truncation (keep most relevant)

- [x] **Write integration tests**
  - [x] Test retrieval of specific conversation
  - [x] Test semantic search over history
  - [x] Test time range filtering
  - [x] Test session isolation

**Files to create:**

- `src/server/tools/conversationMemoryTool.ts`
- `src/server/tools/conversationMemoryTool.test.ts`

**Exit Criteria:** Agents can search and retrieve conversation history via MCP

---

#### Step 2.2.4: Add Conversation Logging to Agent Workflows

- [x] **Create logging middleware**
  - [x] Add conversation logging to MCP transport layer
  - [x] Capture user messages and assistant responses
  - [x] Extract session ID from request context
  - [x] Log asynchronously (don't block requests)

- [x] **Update n8n workflows**
  - [x] Add conversation.store call after agent responses
  - [x] Pass session ID through workflow context
  - [x] Handle logging failures gracefully

- [x] **Add opt-out mechanism**
  - [x] Environment variable: `EPISODIC_MEMORY_ENABLED`
  - [x] Per-user opt-out flag
  - [x] Privacy controls

- [x] **Implement summarization cron**
  - [x] Create scheduled job to summarize old conversations
  - [x] Run weekly, process conversations >30 days old
  - [x] Replace detailed turns with summary embeddings
  - [x] Archive original data

**Files to modify:**

- `src/server/httpTransport.ts`
- `workflows/mylo-mcp-agent.workflow.json`
- `scripts/summarizeEpisodicMemory.ts` (new)

**Exit Criteria:** Conversations automatically logged and retrievable

---

### Milestone 2.3: Memory Graph Implementation

**Goal:** Create semantic links between related memories for graph traversal and cluster retrieval.

#### Step 2.3.1: Design Memory Graph Schema

- [x] **Define graph data model**
  - [x] Create `docs/MEMORY_GRAPH_DESIGN.md`
  - [x] Design node: existing prompt_embeddings rows
  - [x] Design edges:
    ```sql
    CREATE TABLE memory_links (
      id uuid PRIMARY KEY,
      source_chunk_id text REFERENCES prompt_embeddings(chunk_id),
      target_chunk_id text REFERENCES prompt_embeddings(chunk_id),
      link_type text, -- 'similar', 'prerequisite', 'related', 'followup'
      strength float,  -- 0-1 similarity score
      created_at timestamptz
    );
    ```
  - [x] Define link types and semantics
  - [x] Plan automatic vs. manual link creation

- [x] **Create migration**
  - [x] Create `0005_add_memory_graph.sql`
  - [x] Create `memory_links` table
  - [x] Add indices on source and target
  - [x] Add index on link_type for filtering

**Files to create:**

- `docs/MEMORY_GRAPH_DESIGN.md`
- `drizzle/0005_add_memory_graph.sql`

**Exit Criteria:** Memory graph schema defined and created

---

#### Step 2.3.2: Implement Automatic Link Generation

- [x] **Create link detector**
  - [x] Create `src/vector/linkDetector.ts`
  - [x] Implement `generateCandidates(chunkId: string): Promise<LinkCandidate[]>`
  - [x] Find similar chunks via cosine similarity
  - [x] Threshold: similarity > 0.75 for 'similar' link
  - [x] Threshold: similarity 0.5-0.75 for 'related' link
  - [x] Filter out self-links

- [x] **Add to ingestion pipeline**
  - [x] After embedding new chunks, generate links
  - [x] Run link generation asynchronously
  - [x] Batch process to avoid N² complexity
  - [x] Update existing chunks' links when new content added

- [x] **Implement link repository**
  - [x] Create `src/db/linkRepository.ts`
  - [x] `createLink(source, target, type, strength): Promise<void>`
  - [x] `getLinkedChunks(chunkId): Promise<LinkedChunk[]>`
  - [x] `findCluster(chunkId, depth): Promise<ChunkCluster>`

- [x] **Write tests**
  - [x] Test link generation for similar prompts
  - [x] Test link filtering by threshold
  - [x] Test bidirectional linking
  - [x] Test cluster discovery

**Files to create:**

- `src/vector/linkDetector.ts`
- `src/db/linkRepository.ts`
- `src/db/linkRepository.test.ts`

**Exit Criteria:** Links automatically generated between similar memories

---

#### Step 2.3.3: Implement Graph Traversal Search

- [x] **Create graph search algorithm**
  - [x] Create `src/vector/graphSearch.ts`
  - [x] Implement BFS graph traversal from seed chunk
  - [x] Implement weighted graph walk (prioritize strong links)
  - [x] Implement cluster expansion (get all chunks within N hops)
  - [x] Add cycle detection safeguards

- [x] **Add to search repository**
  - [x] Implement `searchWithGraphExpansion(...)` wrapper
  - [x] Seed with semantic vector results
  - [x] Expand via memory links with scoring formula `(seed * 0.7) + (link * 0.3 / hop)`
  - [x] Return ranked results annotated with graph path metadata

- [x] **Add graph search parameters**
  - [x] `expandGraph: boolean` toggle in tool/repository
  - [x] `maxHops: number` depth control (default 2)
  - [x] `minLinkStrength: float` thresholding (default 0.45)

- [x] **Write tests**
  - [x] Test single-hop expansion
  - [x] Test multi-hop expansion
  - [x] Test cycle handling
  - [x] Test weak link filtering

**Files to create:**

- `src/vector/graphSearch.ts`
- `src/vector/graphSearch.test.ts`

**Files to modify:**

- `src/db/repository.ts`

**Exit Criteria:** Graph traversal returns related memories through link relationships

---

#### Step 2.3.4: Update Search Tool with Graph Expansion

- [x] **Add graph expansion to search tool**
  - [x] Add `expandGraph: boolean` parameter
  - [x] Add `graphMaxHops: number` parameter (default: 2)
  - [x] Pass configuration through to repository search
  - [x] Include graph path context in serialized matches

- [x] **Update output schema**
  - [x] Add `graphContext` details (path, weights, hop count)
  - [x] Add `graphExpansion` metadata (enabled, depth, min strength)

- [x] **Add visualization support**
  - [x] Return graph structure as JSON for visualization
  - [x] Include nodes (chunks) and edges (links)
  - [x] Add link types and strengths

**Files to modify:**

- `src/server/tools/promptSearchTool.ts`

**Exit Criteria:** Search can discover related prompts via graph links

---

## Phase 3: Adaptive RAG Implementation (Weeks 9-12)

### Milestone 3.1: Adaptive Retrieval Controller

**Goal:** Enable agents to decide when and how to retrieve information dynamically.

#### Step 3.1.1: Design Adaptive Retrieval Framework

-
- [x] **Create architecture document**
  - [x] Create `docs/ADAPTIVE_RETRIEVAL.md`
  - [x] Define retrieval decision workflow:
    1. Agent receives query
    2. Self-assess: "Do I need more information?"
    3. If yes, formulate retrieval query
    4. Execute search
    5. Evaluate result utility
    6. Decide: iterate, refine, or stop
  - [x] Design confidence scoring
  - [x] Plan iteration limits and termination conditions

- [x] **Define retrieval strategies**
  - [x] **Single-shot**: Traditional one-time search
  - [x] **Iterative**: Multi-round with query refinement
  - [x] **Hypothesis-driven**: Generate hypothetical query, search, validate
  - [x] **Multi-hop**: Follow references across searches
  - [x] **Fallback**: Try different search modes if initial fails

**Files to create:**

- `docs/ADAPTIVE_RETRIEVAL.md`

**Exit Criteria:** Adaptive retrieval framework documented

---

#### Step 3.1.2: Implement Retrieval Decision Agent

- [x] **Create retrieval decision module**
  - [x] Create `src/vector/retrievalDecisionAgent.ts`
  - [x] Implement `shouldRetrieve(context: AgentContext): Promise<RetrievalDecision>`
  - [x] (openAI sdk) Use LLM to assess information need:
    ```
    Given query: {query}
    Current knowledge: {summary}
    Do you need external information? (yes/no/maybe)
    If yes, what specific information would help?
    ```
  - [x] Return structured decision with confidence score

- [x] **Implement query formulation**
  - [x] `formulateRetrievalQuery(query: string, context: QueryFormulationContext): Promise<string>`
  - [x] Generate search query from agent's information need
  - [x] Optimize for vector search (descriptive, semantic)
  - [x] Generate multiple query variations if confidence low

- [x] **Add utility evaluation**
  - [x] `evaluateResultUtility(results: SearchResult[], query: string): number`
  - [x] Score 0-1 based on relevance
  - [x] Use LLM or heuristics (similarity threshold, result count)
  - [x] Decide if refinement needed

- [x] **Write tests**
  - [x] Test decision on query with missing context
  - [x] Test decision on query with sufficient context
  - [x] Test query formulation quality
  - [x] Test utility evaluation

**Files to create:**

- `src/vector/retrievalDecisionAgent.ts`
- `src/vector/retrievalDecisionAgent.test.ts`

**Exit Criteria:** Decision agent correctly identifies when retrieval needed

---

#### Step 3.1.3: Implement Iterative Retrieval Loop

- [x] **Create retrieval orchestrator**
  - [x] Create `src/vector/retrievalOrchestrator.ts`
  - [x] Implement `adaptiveSearch(query: string, context: AdaptiveSearchParams): Promise<AdaptiveSearchResult>`
  - [x] Workflow:
    1. Assess retrieval need
    2. If needed, formulate query
    3. Execute search
    4. Evaluate utility
    5. If utility low, refine and iterate (max 3 iterations)
    6. Return aggregated results

- [x] **Implement query refinement**
  - [x] `refineQuery(originalQuery: string, results: SearchResult[]): string`
  - [x] Analyze gaps in results
  - [x] Generate improved query
  - [x] Try different search modes or filters

- [x] **Add iteration tracking**
  - [x] Track iteration count
  - [x] Log refinement decisions
  - [x] Measure cumulative latency
  - [x] Limit max iterations (default: 3)

- [x] **Implement result aggregation**
  - [x] Merge results across iterations
  - [x] Deduplicate by chunk_id
  - [x] Rank by combined relevance
  - [x] Track provenance (which iteration found each result)

- [x] **Write tests**
  - [x] Test single iteration (high utility)
  - [x] Test multiple iterations (refinement)
  - [x] Test iteration limit
  - [x] Test result deduplication

**Files to create:**

- `src/vector/retrievalOrchestrator.ts`
- `src/vector/retrievalOrchestrator.test.ts`

**Exit Criteria:** Iterative retrieval successfully refines queries until utility threshold met

---

#### Step 3.1.4: Create Adaptive Search MCP Tool

- [x] **Design tool interface**
  - [x] Tool name: `prompts_search_adaptive`
  - [x] Inputs:
    - `query: string`
    - `context?: string` - current agent knowledge
    - `maxIterations?: number` - iteration limit
    - `utilityThreshold?: number` - stop if exceeded
  - [x] Outputs:
    - `results: SearchResult[]`
    - `iterations: IterationLog[]` - decision history
    - `totalDuration: number`
    - `finalUtility: number`

- [x] **Implement tool**
  - [x] Create `src/server/tools/adaptiveSearchTool.ts`
  - [x] Use retrievalOrchestrator
  - [x] Add timeout protection (max 30s)
  - [x] Include detailed logging for debugging
  - [x] Register with MCP server

- [x] **Add monitoring**
  - [x] Track adaptive search usage
  - [x] Measure iteration distribution
  - [x] Monitor latency P50/P95/P99
  - [x] Alert on excessive iterations

- [x] **Write integration tests**
  - [x] Test simple query (should not iterate)
  - [x] Test complex query (should iterate)
  - [x] Test timeout handling
  - [x] Test error recovery

**Files to create:**

- `src/server/tools/adaptiveSearchTool.ts`
- `src/server/tools/adaptiveSearchTool.test.ts`

**Exit Criteria:** Adaptive search tool available via MCP with iteration control

---

### Milestone 3.2: Multi-Hop Search

**Goal:** Enable following references and relationships across multiple search steps.

#### Step 3.2.1: Implement Reference Extraction

- [x] **Create reference detector**
  - [x] Create `src/vector/referenceExtractor.ts`
  - [x] Extract references from search results:
    - Persona names
    - Project names
    - Workflow step references
    - External documentation links
  - [x] Use regex + NLP (entity recognition)
  - [x] Return structured reference list

- [x] **Add reference resolution**
  - [x] `resolveReference(ref: Reference): Promise<SearchResult[]>`
  - [x] Look up referenced entity in appropriate memory component
  - [x] Return full context for reference

- [x] **Write tests**
  - [x] Test persona reference extraction
  - [x] Test project reference extraction
  - [x] Test reference resolution

**Files to create:**

- `src/vector/referenceExtractor.ts`
- `src/vector/referenceExtractor.test.ts`

**Exit Criteria:** Can extract and resolve references from search results

---

#### Step 3.2.2: Implement Multi-Hop Search Algorithm

- [x] **Create multi-hop searcher**
  - [x] Create `src/vector/multiHopSearch.ts`
  - [x] Implement `multiHopSearch(query: string, maxHops: number): Promise<MultiHopResult>`
  - [x] Algorithm:
    1. Initial search (hop 0)
    2. Extract references from results
    3. Search for each reference (hop 1)
    4. Repeat up to maxHops
    5. Aggregate all results with hop provenance

- [x] **Add hop scoring**
  - [x] Score decay per hop: `score / (hop + 1)`
  - [x] Prioritize direct results over transitive
  - [x] Track hop path for each result

- [x] **Implement pruning**
  - [x] Limit results per hop (e.g., top 5)
  - [x] Skip low-relevance hops
  - [x] Deduplicate across hops

- [x] **Write tests**
  - [x] Test single-hop search
  - [x] Test two-hop search with references
  - [x] Test hop limit enforcement
  - [x] Test result deduplication

**Files to create:**

- `src/vector/multiHopSearch.ts`
- `src/vector/multiHopSearch.test.ts`

**Exit Criteria:** Multi-hop search follows references across prompts

---

#### Step 3.2.3: Add Multi-Hop to Adaptive Search

- [x] **Integrate multi-hop with adaptive search**
  - [x] Add `enableMultiHop: boolean` to adaptive search
  - [x] If enabled, apply multi-hop expansion after initial retrieval
  - [x] Include hop information in results
  - [x] Count hops toward iteration limit

- [x] **Update adaptive search tool**
  - [x] Add `maxHops: number` parameter
  - [x] Add hop path to output
  - [x] Document multi-hop behavior

**Files to modify:**

- `src/vector/retrievalOrchestrator.ts`
- `src/server/tools/adaptiveSearchTool.ts`

**Exit Criteria:** Adaptive search can follow multi-hop references

---

### Milestone 3.3: Runtime Memory Addition

**Goal:** Allow agents to store new knowledge during conversations.

#### Step 3.3.1: Design Runtime Memory API

- [x] **Define memory write permissions**
  - [x] Create `docs/RUNTIME_MEMORY_PERMISSIONS.md`
  - [x] Define who can write to memory:
    - System (always allowed)
    - Agents (with restrictions)
    - Users (with restrictions)
  - [x] Define moderation requirements
  - [x] Plan abuse prevention

- [x] **Design memory addition API**
  - [x] MCP tool: `memory_add`
  - [x] Inputs:
    - `content: string` - what to remember
    - `memoryType: MemoryType` - where to store
    - `metadata: object` - context
    - `tags?: string[]` - categorization
  - [x] Validation rules
  - [x] Embedding generation

**Files to create:**

- `docs/RUNTIME_MEMORY_PERMISSIONS.md`

**Exit Criteria:** Runtime memory API designed with security controls

---

#### Step 3.3.2: Implement Memory Addition Tool

- [x] **Create memory writer**
  - [x] Create `src/server/tools/memoryAddTool.ts`
  - [x] Implement `addMemory(params: AddMemoryParams): Promise<MemoryId>`
  - [x] Validate inputs
  - [x] Generate embeddings
  - [x] Store in appropriate memory component
  - [x] Generate links to related memories
  - [x] Return memory ID

- [x] **Add moderation layer**
  - [x] Check content for harmful/inappropriate content
  - [x] Use OpenAI moderation API
  - [x] Reject or flag problematic content
  - [x] Log moderation decisions

- [x] **Implement memory update**
  - [x] Tool: `memory_update`
  - [x] Allow modifying existing memories
  - [x] Preserve version history
  - [x] Re-generate embeddings if content changed
  - [x] Update links

- [x] **Add memory deletion**
  - [x] Tool: `memory_delete`
  - [x] Soft delete (mark inactive)
  - [x] Preserve for audit trail
  - [x] Remove from search results
  - [x] Cascade to links (mark orphaned)

- [x] **Write tests**
  - [x] Test valid memory addition
  - [x] Test validation rejection
  - [x] Test moderation filtering
  - [x] Test memory update
  - [x] Test memory deletion

**Files to create:**

- `src/server/tools/memoryAddTool.ts`
- `src/server/tools/memoryAddTool.test.ts`

**Exit Criteria:** Agents can add, update, and delete memories at runtime

---

#### Step 3.3.3: Add Memory Addition to Agent Workflows

- [x] **Update workflow to use memory_add**
  - [x] Modify `mylo-mcp-bot.workflow.json`
  - [x] Add memory_add call after learning new facts
  - [x] Store project decisions as project memory
  - [x] Store user preferences as episodic memory

- [x] **Implement memory synthesis**
  - [x] After conversation, synthesize key learnings
  - [x] Use LLM to extract important facts
  - [x] Store as semantic memory
  - [x] Link to conversation (episodic memory)

- [x] **Add memory review process**
  - [x] Periodic review of agent-added memories
  - [x] Human-in-the-loop approval for sensitive data
  - [x] Dashboard for memory management

**Files to modify:**

- `workflows/mylo-mcp-agent.workflow.json`

**Exit Criteria:** Agents automatically store new learnings during conversations

---

### Milestone 3.4: Integration and Testing - SKIP

**Goal:** Integrate all adaptive features and validate end-to-end.

#### Step 3.4.1: Feature Flag Management

- [x] **Implement feature flag system**
  - [x] Add configuration for all new features:
    - `HYBRID_SEARCH_ENABLED`
    - `MEMORY_ROUTING_ENABLED`
    - `EPISODIC_MEMORY_ENABLED`
    - `MEMORY_GRAPH_ENABLED`
    - `ADAPTIVE_RETRIEVAL_ENABLED`
    - `RUNTIME_MEMORY_ENABLED`
  - [x] Support environment variables
  - [x] Support runtime configuration
  - [x] Add admin API to toggle flags

- [ ] **Create gradual rollout plan**
  - [ ] Phase 1: Enable hybrid search (50% traffic)
  - [ ] Phase 2: Enable memory routing (25% traffic)
  - [ ] Phase 3: Enable adaptive retrieval (10% traffic)
  - [ ] Phase 4: Enable runtime memory (off by default, manual enable)
  - [ ] Monitor each phase for issues

**Files to modify:**

- `src/config/index.ts`

---

#### Step 3.4.2: Comprehensive Integration Testing - SKIP

- [ ] **Create end-to-end test suite**
  - [ ] Test full adaptive search workflow
  - [ ] Test memory component routing
  - [ ] Test episodic memory with conversations
  - [ ] Test graph traversal across components
  - [ ] Test runtime memory addition

- [ ] **Performance testing**
  - [ ] Benchmark search latency with all features enabled
  - [ ] Load test: 100 concurrent searches
  - [ ] Measure memory usage under load
  - [ ] Test database connection pooling

- [ ] **Failure testing**
  - [ ] Test graceful degradation when features fail
  - [ ] Test timeout handling
  - [ ] Test partial result handling
  - [ ] Test fallback to simpler search modes

**Files to create:**

- `src/test/integration/adaptiveRag.test.ts`
- `src/test/performance/searchBenchmark.test.ts`

---

#### Step 3.4.3: Documentation and Training - update all documentation

- [ ] **Update documentation**
  - [ ] Update README.md with new features
  - [ ] Create `docs/ADAPTIVE_RAG_GUIDE.md` - user guide
  - [ ] Create `docs/MEMORY_COMPONENTS.md` - architecture guide
  - [ ] Create `docs/API_REFERENCE.md` - complete API docs
  - [ ] Add migration guide from old to new search tools

- [ ] **Create examples**
  - [ ] Example: Basic hybrid search
  - [ ] Example: Memory-routed search
  - [ ] Example: Adaptive multi-hop search
  - [ ] Example: Adding runtime memories
  - [ ] Example: Conversation memory retrieval

- [ ] **Update n8n workflow templates**
  - [ ] Add adaptive search node examples
  - [ ] Add memory addition workflows
  - [ ] Add conversation logging templates

**Files to create:**

- `docs/ADAPTIVE_RAG_GUIDE.md`
- `docs/MEMORY_COMPONENTS.md`
- `docs/API_REFERENCE.md`
- `examples/adaptive-search.ts`
- `examples/memory-addition.ts`

---

#### Step 3.4.4: Monitoring and Observability

- [ ] **Add metrics collection**
  - [ ] Search latency per mode (vector, keyword, hybrid, adaptive)
  - [ ] Retrieval decision outcomes (retrieve/skip)
  - [ ] Iteration count distribution
  - [ ] Memory component usage
  - [ ] Cache hit rates
  - [ ] Error rates

- [ ] **Create dashboards**
  - [ ] Grafana dashboard: Search performance
  - [ ] Grafana dashboard: Memory usage by component
  - [ ] Grafana dashboard: Adaptive retrieval behavior
  - [ ] Alert on high latency or error rates

- [ ] **Add structured logging**
  - [ ] Log adaptive search decisions
  - [ ] Log memory routing decisions
  - [ ] Log graph traversal paths
  - [ ] Log runtime memory additions

**Files to create:**

- `src/monitoring/metrics.ts`
- `dashboards/search-performance.json`

---

## Phase 4: Optimization and Production Readiness (Weeks 13-14)

### Final Polish

- [ ] **Performance optimization**
  - [ ] Optimize vector search queries (consider HNSW if ivfflat is slow)
  - [ ] Add query result caching (Redis or in-memory)
  - [ ] Implement connection pooling optimization
  - [ ] Add database query profiling

- [ ] **Security hardening**
  - [ ] Rate limiting on memory addition
  - [ ] Input validation and sanitization
  - [ ] SQL injection protection audit
  - [ ] Access control for memory deletion

- [ ] **Production deployment**
  - [ ] Update Docker configurations
  - [ ] Update environment variable documentation
  - [ ] Create deployment runbook
  - [ ] Set up monitoring alerts
  - [ ] Plan zero-downtime migration

- [ ] **Final testing**
  - [ ] User acceptance testing
  - [ ] Load testing at production scale
  - [ ] Disaster recovery testing
  - [ ] Rollback procedure testing

---

## Success Metrics

### Technical Metrics

- [ ] Search latency P95 < 500ms (adaptive search < 2s)
- [ ] Hybrid search precision > vector-only by 15%
- [ ] Memory routing accuracy > 90%
- [ ] Adaptive retrieval reduces unnecessary searches by 30%
- [ ] Graph expansion finds 20% more relevant content

### Quality Metrics

- [ ] Query intent classification accuracy > 90%
- [ ] Episodic memory retrieval relevance > 0.8
- [ ] Runtime memory approval rate > 95%
- [ ] Zero data loss incidents
- [ ] 99.9% uptime

### User Experience

- [ ] Agent response quality improvement (measured by user ratings)
- [ ] Reduced need for query reformulation
- [ ] Improved multi-turn conversation coherence
- [ ] Better handling of complex, multi-part queries

---

## Risk Management

### High Risk Items

1. **Adaptive retrieval latency** - Could slow down all queries
   - Mitigation: Aggressive timeouts, feature flags, caching
2. **Memory component complexity** - Could confuse users
   - Mitigation: Good defaults, clear documentation, gradual rollout
3. **Runtime memory abuse** - Could pollute knowledge base
   - Mitigation: Moderation, rate limits, approval workflows

### Rollback Plan

- [ ] Keep old search tools available during transition
- [ ] Feature flags allow instant disable of new features
- [ ] Database migrations reversible (tested rollback)
- [ ] Monitoring alerts trigger automatic rollback if error rate spikes

---

## Timeline Summary

| Phase                 | Duration    | Key Deliverables                                  |
| --------------------- | ----------- | ------------------------------------------------- |
| Phase 1: Foundation   | Weeks 1-4   | Hybrid search, query intent, temporal weighting   |
| Phase 2: Architecture | Weeks 5-8   | Memory components, episodic memory, memory graphs |
| Phase 3: Adaptive RAG | Weeks 9-12  | Adaptive retrieval, multi-hop, runtime memory     |
| Phase 4: Polish       | Weeks 13-14 | Optimization, security, production deployment     |

**Total Duration:** 14 weeks  
**Team Size:** 2-3 developers  
**Effort:** ~400-600 engineering hours

---

## Getting Started

### Week 1 Sprint

**Priority Tasks:**

1. ✅ Review and approve this plan
2. ✅ Create Phase 1 branch
3. ✅ Set up feature flag infrastructure
4. ✅ Implement Step 1.1.1: Add full-text search schema
5. ✅ Implement Step 1.1.2: Add keyword search method
6. ⬜ Daily standups to track progress

**Success Criteria:**

- Full-text search working in dev environment
- First integration test passing
- Team aligned on architecture

---

## Conclusion

This plan transforms our static RAG system into a modern adaptive agentic memory system while maintaining backward compatibility and production stability. We build incrementally, test thoroughly, and deploy gradually behind feature flags.

**The journey from B+ to A+ starts with Week 1, Step 1.1.1. Let's ship it! 🚀**
