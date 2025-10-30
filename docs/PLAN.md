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

- [ ] **Add tsvector column to schema**
  - [ ] Create migration `0002_add_fulltext_search.sql`
  - [ ] Add `textsearch tsvector` column to `prompt_embeddings` table
  - [ ] Add GIN index for full-text search: `CREATE INDEX idx_textsearch ON prompt_embeddings USING gin(textsearch)`
  - [ ] Add trigger to auto-update tsvector on insert/update:
    ```sql
    CREATE TRIGGER tsvector_update BEFORE INSERT OR UPDATE
    ON prompt_embeddings FOR EACH ROW EXECUTE FUNCTION
    tsvector_update_trigger(textsearch, 'pg_catalog.english', chunk_text, raw_markdown);
    ```

- [ ] **Update schema types**
  - [ ] Add `textsearch` field to `PromptEmbedding` interface in `src/db/schema.ts`
  - [ ] Update Drizzle schema definition
  - [ ] Run migration and verify index creation

- [ ] **Test full-text search**
  - [ ] Write test query: `SELECT * FROM prompt_embeddings WHERE textsearch @@ to_tsquery('screenwriter & aismr')`
  - [ ] Verify results match expected prompts
  - [ ] Test ranking with `ts_rank(textsearch, query)`

**Files to modify:**

- `drizzle/0002_add_fulltext_search.sql` (new)
- `src/db/schema.ts`
- `drizzle.config.ts` (verify migration path)

**Exit Criteria:** Full-text search returns relevant results for keyword queries

---

#### Step 1.1.2: Implement BM25 Keyword Search Repository Method

- [ ] **Add keyword search method to repository**
  - [ ] Create `keywordSearch(query: string, filters: MetadataFilters): Promise<SearchResult[]>` in `PromptEmbeddingsRepository`
  - [ ] Implement ts_query parsing from natural language query
  - [ ] Use `ts_rank_cd` for relevance scoring
  - [ ] Apply persona/project metadata filters
  - [ ] Return normalized results matching `SearchResult` interface

- [ ] **Add configuration options**
  - [ ] Add `FULLTEXT_SEARCH_WEIGHTS` to config (A: 1.0, B: 0.4, C: 0.2, D: 0.1)
  - [ ] Add `FULLTEXT_MIN_SCORE` threshold (default: 0.1)
  - [ ] Make language configurable (default: 'english')

- [ ] **Write unit tests**
  - [ ] Test exact phrase matching
  - [ ] Test multi-word queries
  - [ ] Test stop word handling
  - [ ] Test with metadata filters
  - [ ] Test empty results handling

**Files to modify:**

- `src/db/repository.ts`
- `src/config/index.ts`
- `src/db/repository.test.ts` (new tests)

**Exit Criteria:** Keyword search method passes all tests and returns ranked results

---

#### Step 1.1.3: Implement Reciprocal Rank Fusion (RRF)

- [ ] **Create RRF utility function**
  - [ ] Create `src/vector/hybridSearch.ts`
  - [ ] Implement RRF algorithm:
    ```typescript
    function reciprocalRankFusion(results: SearchResult[][], k: number = 60): SearchResult[];
    ```
  - [ ] Formula: `score = sum(1 / (k + rank_i))` across all result lists
  - [ ] Handle duplicate results (merge by chunk_id)
  - [ ] Preserve metadata from highest-scoring source

- [ ] **Add configuration**
  - [ ] Add `HYBRID_RRF_K` parameter (default: 60)
  - [ ] Add `HYBRID_VECTOR_WEIGHT` (default: 0.6)
  - [ ] Add `HYBRID_KEYWORD_WEIGHT` (default: 0.4)

- [ ] **Write comprehensive tests**
  - [ ] Test with identical result sets (should equal input)
  - [ ] Test with disjoint result sets (should merge)
  - [ ] Test with overlapping results (should favor consensus)
  - [ ] Test empty input handling
  - [ ] Test single-source input

**Files to create:**

- `src/vector/hybridSearch.ts`
- `src/vector/hybridSearch.test.ts`

**Exit Criteria:** RRF correctly merges vector and keyword results with proper scoring

---

#### Step 1.1.4: Update Search Tool with Hybrid Mode

- [ ] **Add hybrid search mode to promptSearchTool**
  - [ ] Add `searchMode: 'vector' | 'keyword' | 'hybrid'` parameter (default: 'hybrid')
  - [ ] Update input schema validation
  - [ ] Implement mode switching logic:
    - Vector: existing cosine similarity search
    - Keyword: new BM25 search
    - Hybrid: both + RRF fusion

- [ ] **Update search execution**
  - [ ] For hybrid mode, run vector and keyword searches in parallel
  - [ ] Apply RRF to merge results
  - [ ] Filter by combined score threshold
  - [ ] Return top-k after fusion

- [ ] **Update tool documentation**
  - [ ] Document searchMode parameter
  - [ ] Add usage examples for each mode
  - [ ] Document when to use each mode

- [ ] **Write integration tests**
  - [ ] Test all three modes with same query
  - [ ] Verify hybrid returns better results than either alone
  - [ ] Test with technical terms (should favor keyword)
  - [ ] Test with semantic queries (should favor vector)

**Files to modify:**

- `src/server/tools/promptSearchTool.ts`
- `src/server/tools/promptSearchTool.test.ts`

**Exit Criteria:** Hybrid search demonstrably improves precision over vector-only

---

### Milestone 1.2: Query Intent Classification

**Goal:** Automatically route queries to appropriate search modes and filters without manual specification.

#### Step 1.2.1: Create Query Intent Classifier

- [ ] **Design intent taxonomy**
  - [ ] Define intents: `persona_lookup`, `project_lookup`, `combination_lookup`, `general_knowledge`, `workflow_step`, `example_request`
  - [ ] Map intents to filter strategies
  - [ ] Document intent → filter rules

- [ ] **Implement LLM-based classifier**
  - [ ] Create `src/vector/queryClassifier.ts`
  - [ ] Implement classifier function:
    ```typescript
    async function classifyQueryIntent(query: string): Promise<{
      intent: QueryIntent;
      extractedPersona?: string;
      extractedProject?: string;
      confidence: number;
    }>;
    ```
  - [ ] Use GPT-4o-mini for cost efficiency
  - [ ] Design classification prompt with few-shot examples
  - [ ] Parse structured output (JSON mode)

- [ ] **Add caching layer**
  - [ ] Implement in-memory LRU cache (max 1000 entries)
  - [ ] Cache key: hash of query string
  - [ ] TTL: 1 hour
  - [ ] Add cache hit metrics

- [ ] **Write tests**
  - [ ] Test persona intent: "What is the screenwriter persona?"
  - [ ] Test project intent: "Tell me about the AISMR project"
  - [ ] Test combination: "How does screenwriter work with AISMR?"
  - [ ] Test general: "What are the best practices for video generation?"
  - [ ] Test edge cases (empty query, very long query)

**Files to create:**

- `src/vector/queryClassifier.ts`
- `src/vector/queryClassifier.test.ts`

**Exit Criteria:** Classifier achieves >90% accuracy on test set of 50 queries

---

#### Step 1.2.2: Implement Automatic Filter Application

- [ ] **Create query enhancer**
  - [ ] Create `src/vector/queryEnhancer.ts`
  - [ ] Implement `enhanceQuery(query: string): Promise<EnhancedQuery>`
  - [ ] Extract persona/project from natural language:
    - "screenwriter" → persona filter
    - "aismr" → project filter
  - [ ] Normalize extracted terms to slugs
  - [ ] Validate against known personas/projects

- [ ] **Update search tool to use classifier**
  - [ ] Add `autoFilter: boolean` parameter (default: true)
  - [ ] If autoFilter=true and no explicit filters:
    - Call queryClassifier
    - Apply extracted filters
    - Log auto-applied filters in response
  - [ ] If explicit filters provided, skip classification
  - [ ] Add `appliedFilters.auto: boolean` to output

- [ ] **Add fallback logic**
  - [ ] If classifier fails (error/timeout), proceed without filters
  - [ ] Log classification failures for monitoring
  - [ ] Add retry logic (max 1 retry with exponential backoff)

- [ ] **Write integration tests**
  - [ ] Test auto-filtering on persona query
  - [ ] Test auto-filtering on project query
  - [ ] Test override behavior (explicit filters take precedence)
  - [ ] Test fallback on classifier failure

**Files to modify:**

- `src/vector/queryEnhancer.ts` (new)
- `src/server/tools/promptSearchTool.ts`
- `src/server/tools/promptSearchTool.test.ts`

**Exit Criteria:** Search tool automatically applies correct filters 85%+ of the time

---

#### Step 1.2.3: Implement Search Mode Auto-Selection

- [ ] **Create mode selector**
  - [ ] Add `selectSearchMode(query: string, intent: QueryIntent): SearchMode`
  - [ ] Rules:
    - Technical terms / IDs → keyword mode
    - Semantic concepts → vector mode
    - Default → hybrid mode
  - [ ] Use simple heuristics (presence of quotes, technical patterns)

- [ ] **Update search tool**
  - [ ] If `searchMode` not specified and `autoFilter=true`:
    - Detect best mode from query
    - Apply automatically
    - Log selected mode in response
  - [ ] Add `appliedFilters.searchMode: 'auto' | 'manual'`

- [ ] **Add configuration**
  - [ ] `AUTO_MODE_ENABLED` (default: true)
  - [ ] `TECHNICAL_PATTERN_REGEX` (configurable patterns)
  - [ ] Mode selection weights/thresholds

- [ ] **Write tests**
  - [ ] Test keyword selection for technical queries
  - [ ] Test vector selection for conceptual queries
  - [ ] Test hybrid as default
  - [ ] Test manual override

**Files to modify:**

- `src/vector/queryEnhancer.ts`
- `src/server/tools/promptSearchTool.ts`
- `src/config/index.ts`

**Exit Criteria:** Auto-selected mode matches optimal mode in 80%+ of test cases

---

### Milestone 1.3: Temporal Weighting

**Goal:** Boost recent content in search results to prioritize up-to-date information.

#### Step 1.3.1: Add Temporal Decay Function

- [ ] **Implement decay algorithms**
  - [ ] Create `src/vector/temporalScoring.ts`
  - [ ] Implement exponential decay: `score * exp(-lambda * age_days)`
  - [ ] Implement linear decay: `score * max(0, 1 - age_days / max_age)`
  - [ ] Make decay function configurable

- [ ] **Add configuration**
  - [ ] `TEMPORAL_DECAY_ENABLED` (default: false for now)
  - [ ] `TEMPORAL_DECAY_FUNCTION` ('exponential' | 'linear' | 'none')
  - [ ] `TEMPORAL_DECAY_HALFLIFE_DAYS` (default: 90)
  - [ ] `TEMPORAL_DECAY_MAX_AGE_DAYS` (default: 365)

- [ ] **Write tests**
  - [ ] Test exponential decay formula
  - [ ] Test linear decay formula
  - [ ] Test edge cases (age = 0, age > max)
  - [ ] Test score preservation when disabled

**Files to create:**

- `src/vector/temporalScoring.ts`
- `src/vector/temporalScoring.test.ts`

---

#### Step 1.3.2: Update Repository Search to Apply Temporal Boost

- [ ] **Modify search query**
  - [ ] Calculate age in days: `EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400`
  - [ ] Apply decay formula in SQL:
    ```sql
    (1 - (embedding <=> embedding_literal)) *
    EXP(-0.007 * EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400) AS similarity
    ```
  - [ ] Make decay factor configurable
  - [ ] Only apply when `TEMPORAL_DECAY_ENABLED=true`

- [ ] **Add temporal parameters**
  - [ ] Add `applyTemporalDecay: boolean` to `SearchParameters`
  - [ ] Add `temporalDecayConfig` optional parameter
  - [ ] Default to config values if not specified

- [ ] **Test with real data**
  - [ ] Create test prompts with different ages
  - [ ] Verify newer prompts rank higher with same semantic similarity
  - [ ] Verify old prompts can still win with much higher similarity
  - [ ] Test disable mode (should behave as before)

**Files to modify:**

- `src/db/repository.ts`
- `src/db/repository.test.ts`

**Exit Criteria:** Temporal decay correctly boosts recent content without eliminating relevant old content

---

#### Step 1.3.3: Expose Temporal Control in Search Tool

- [ ] **Add temporal parameters to search tool**
  - [ ] Add optional `temporalBoost: boolean` parameter
  - [ ] Add optional `temporalConfig` parameter
  - [ ] Pass through to repository search

- [ ] **Update documentation**
  - [ ] Document temporal boosting behavior
  - [ ] Provide examples of when to enable/disable
  - [ ] Document configuration options

- [ ] **Add to output metadata**
  - [ ] Include `temporalDecayApplied: boolean` in response
  - [ ] Include decay config used
  - [ ] Add age_days to each result (optional)

**Files to modify:**

- `src/server/tools/promptSearchTool.ts`

**Exit Criteria:** Temporal boosting available and controllable via MCP tool

---

## Phase 2: Memory Architecture Evolution (Weeks 5-8)

### Milestone 2.1: Multi-Component Memory System

**Goal:** Separate memory into distinct components (persona, project, episodic, semantic) with dedicated storage and routing.

#### Step 2.1.1: Design Memory Component Architecture

- [ ] **Document memory taxonomy**
  - [ ] Create `docs/MEMORY_ARCHITECTURE.md`
  - [ ] Define memory types:
    - **Persona Memory**: Identity, role, style, capabilities
    - **Project Memory**: Project context, goals, specifications
    - **Semantic Memory**: General knowledge, workflows, best practices
    - **Episodic Memory**: Conversation history, user interactions (new)
    - **Procedural Memory**: Workflow steps, action sequences (new)
  - [ ] Define routing rules for each type
  - [ ] Document cross-component relationships

- [ ] **Design database schema**
  - [ ] Option A: Separate tables per memory type
  - [ ] Option B: Single table with memory_type column + filtered indices
  - [ ] Option C: Separate databases (over-engineering)
  - [ ] **Decision:** Go with Option B for simplicity with dedicated indices

- [ ] **Create migration plan**
  - [ ] Map existing prompts to new memory types
  - [ ] Define data transformation logic
  - [ ] Plan zero-downtime migration strategy

**Files to create:**

- `docs/MEMORY_ARCHITECTURE.md`

**Exit Criteria:** Memory architecture documented and reviewed

---

#### Step 2.1.2: Create Memory Component Tables/Indices

- [ ] **Add memory_type to schema**
  - [ ] Create migration `0003_add_memory_components.sql`
  - [ ] Add `memory_type` enum: `persona | project | semantic | episodic | procedural`
  - [ ] Add `memory_type` column with default 'semantic'
  - [ ] Create partial indices per memory type:
    ```sql
    CREATE INDEX idx_persona_memory ON prompt_embeddings(updated_at)
    WHERE memory_type = 'persona';
    ```
  - [ ] Add GIN index on metadata per type for faster filtering

- [ ] **Update existing data**
  - [ ] Write data migration script
  - [ ] Classify existing prompts:
    - `metadata.type = 'persona'` → memory_type = 'persona'
    - `metadata.type = 'project'` → memory_type = 'project'
    - `metadata.type = 'combination'` → memory_type = 'semantic'
  - [ ] Run migration in transaction with rollback

- [ ] **Update schema types**
  - [ ] Add `memoryType` field to schema.ts
  - [ ] Update repository types
  - [ ] Update ingestion types

**Files to modify:**

- `drizzle/0003_add_memory_components.sql` (new)
- `src/db/schema.ts`
- `scripts/migrateMemoryTypes.ts` (new)

**Exit Criteria:** All prompts classified into memory types with proper indices

---

#### Step 2.1.3: Implement Memory Component Repository

- [ ] **Create component-specific search methods**
  - [ ] `searchPersonaMemory(query, filters): Promise<SearchResult[]>`
  - [ ] `searchProjectMemory(query, filters): Promise<SearchResult[]>`
  - [ ] `searchSemanticMemory(query, filters): Promise<SearchResult[]>`
  - [ ] `searchEpisodicMemory(query, filters, timeRange?): Promise<SearchResult[]>`
  - [ ] Each method filters by memory_type automatically

- [ ] **Implement cross-component search**
  - [ ] `searchAllMemory(query, types: MemoryType[]): Promise<MemorySearchResult[]>`
  - [ ] Return results grouped by memory type
  - [ ] Apply type-specific ranking weights
  - [ ] Merge results with component attribution

- [ ] **Add memory type to search parameters**
  - [ ] Add `memoryTypes?: MemoryType[]` to SearchParameters
  - [ ] Filter query by memory types if specified
  - [ ] Default to all types if not specified

**Files to modify:**

- `src/db/repository.ts`
- `src/db/repository.test.ts`

**Exit Criteria:** Can search specific memory components independently

---

#### Step 2.1.4: Create Memory Router

- [ ] **Implement routing logic**
  - [ ] Create `src/vector/memoryRouter.ts`
  - [ ] Implement `routeQuery(query: string, intent: QueryIntent): MemoryType[]`
  - [ ] Routing rules:
    - "Who am I?" / "What's my role?" → persona
    - "What is project X?" → project
    - "How do I..." / "Best practices for..." → semantic
    - "What did we discuss?" / "Yesterday I said..." → episodic
    - "What are the steps for..." → procedural
  - [ ] Return ordered list of memory types to search

- [ ] **Implement multi-component query orchestration**
  - [ ] Create `orchestrateMemorySearch(query: string): Promise<MultiComponentResult>`
  - [ ] Classify query intent
  - [ ] Route to appropriate memory components
  - [ ] Execute searches in parallel
  - [ ] Merge and rank results
  - [ ] Return with component attribution

- [ ] **Add routing metrics**
  - [ ] Log routing decisions
  - [ ] Track search count per memory type
  - [ ] Measure cross-component query latency

- [ ] **Write tests**
  - [ ] Test persona query routing
  - [ ] Test project query routing
  - [ ] Test multi-component queries
  - [ ] Test fallback to all components

**Files to create:**

- `src/vector/memoryRouter.ts`
- `src/vector/memoryRouter.test.ts`

**Exit Criteria:** Router correctly identifies target memory components for 90%+ of queries

---

#### Step 2.1.5: Update Search Tool with Memory Routing

- [ ] **Add memory-aware search mode**
  - [ ] Add `useMemoryRouting: boolean` parameter (default: false initially)
  - [ ] When enabled, use memoryRouter instead of single search
  - [ ] Return component-attributed results
  - [ ] Include routing decision in response metadata

- [ ] **Update output schema**
  - [ ] Add `memoryComponent: MemoryType` to each result
  - [ ] Add `routingDecision` to metadata
  - [ ] Add `componentsSearched: MemoryType[]`

- [ ] **Add gradual rollout control**
  - [ ] Feature flag: `MEMORY_ROUTING_ENABLED`
  - [ ] Percentage rollout: `MEMORY_ROUTING_ROLLOUT_PCT`
  - [ ] Allow per-request override

- [ ] **Write integration tests**
  - [ ] Test routing with persona queries
  - [ ] Test routing with project queries
  - [ ] Test multi-component result merging
  - [ ] Test fallback when routing disabled

**Files to modify:**

- `src/server/tools/promptSearchTool.ts`
- `src/config/index.ts`

**Exit Criteria:** Memory routing available behind feature flag, testable in production

---

### Milestone 2.2: Episodic Memory System

**Goal:** Store and retrieve conversation history to enable long-term dialogue coherence.

#### Step 2.2.1: Design Episodic Memory Schema

- [ ] **Define conversation data model**
  - [ ] Create `docs/EPISODIC_MEMORY_DESIGN.md`
  - [ ] Design schema:
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
  - [ ] Design indexing strategy (timestamp, session, user)
  - [ ] Plan embedding strategy (full turn vs. summary)

- [ ] **Create database migration**
  - [ ] Create `0004_add_episodic_memory.sql`
  - [ ] Create `conversation_turns` table
  - [ ] Add to `prompt_embeddings` or separate? **Decision: Add to prompt_embeddings with memory_type='episodic'**
  - [ ] Add session index, user index, timestamp index
  - [ ] Add vector index for conversation embeddings

- [ ] **Design retention policy**
  - [ ] Define TTL: keep 90 days, summarize and archive older
  - [ ] Plan summarization strategy
  - [ ] Define storage limits per user/session

**Files to create:**

- `docs/EPISODIC_MEMORY_DESIGN.md`
- `drizzle/0004_add_episodic_memory.sql` (new)

**Exit Criteria:** Episodic memory schema designed and migration created

---

#### Step 2.2.2: Implement Conversation Storage

- [ ] **Create episodic memory repository**
  - [ ] Create `src/db/episodicRepository.ts`
  - [ ] Implement `storeConversationTurn(turn: ConversationTurn): Promise<void>`
  - [ ] Implement `getSessionHistory(sessionId: uuid): Promise<ConversationTurn[]>`
  - [ ] Implement `searchConversationHistory(query: string, filters): Promise<ConversationTurn[]>`
  - [ ] Use same vector search but filtered to memory_type='episodic'

- [ ] **Implement auto-embedding**
  - [ ] Embed conversation turn content on store
  - [ ] Generate contextual summary for metadata
  - [ ] Extract keywords/entities from conversation
  - [ ] Store with session context

- [ ] **Add session management**
  - [ ] Create session on first interaction
  - [ ] Track session start/end times
  - [ ] Associate turns with sessions
  - [ ] Support session retrieval by ID or time range

- [ ] **Write tests**
  - [ ] Test single turn storage
  - [ ] Test multi-turn conversation storage
  - [ ] Test session history retrieval
  - [ ] Test conversation search
  - [ ] Test embedding generation

**Files to create:**

- `src/db/episodicRepository.ts`
- `src/db/episodicRepository.test.ts`

**Exit Criteria:** Can store and retrieve conversation history with embeddings

---

#### Step 2.2.3: Create Conversation Memory MCP Tool

- [ ] **Design tool interface**
  - [ ] Tool name: `conversation.remember`
  - [ ] Inputs:
    - `query: string` - what to search for in history
    - `sessionId?: uuid` - limit to specific session
    - `timeRange?: { start, end }` - time window
    - `limit?: number` - max results
  - [ ] Outputs:
    - `turns: ConversationTurn[]` - matching conversation history
    - `context: string` - summarized context
    - `appliedFilters: object`

- [ ] **Implement tool**
  - [ ] Create `src/server/tools/conversationMemoryTool.ts`
  - [ ] Implement search logic using episodicRepository
  - [ ] Add relevance filtering
  - [ ] Generate context summary from results
  - [ ] Register with MCP server

- [ ] **Add context injection helper**
  - [ ] Create utility to format conversation history for prompts
  - [ ] Support different formats (chat, narrative, bullets)
  - [ ] Add token counting to avoid context overflow
  - [ ] Implement smart truncation (keep most relevant)

- [ ] **Write integration tests**
  - [ ] Test retrieval of specific conversation
  - [ ] Test semantic search over history
  - [ ] Test time range filtering
  - [ ] Test session isolation

**Files to create:**

- `src/server/tools/conversationMemoryTool.ts`
- `src/server/tools/conversationMemoryTool.test.ts`

**Exit Criteria:** Agents can search and retrieve conversation history via MCP

---

#### Step 2.2.4: Add Conversation Logging to Agent Workflows

- [ ] **Create logging middleware**
  - [ ] Add conversation logging to MCP transport layer
  - [ ] Capture user messages and assistant responses
  - [ ] Extract session ID from request context
  - [ ] Log asynchronously (don't block requests)

- [ ] **Update n8n workflows**
  - [ ] Add conversation.store call after agent responses
  - [ ] Pass session ID through workflow context
  - [ ] Handle logging failures gracefully

- [ ] **Add opt-out mechanism**
  - [ ] Environment variable: `EPISODIC_MEMORY_ENABLED`
  - [ ] Per-user opt-out flag
  - [ ] Privacy controls

- [ ] **Implement summarization cron**
  - [ ] Create scheduled job to summarize old conversations
  - [ ] Run weekly, process conversations >30 days old
  - [ ] Replace detailed turns with summary embeddings
  - [ ] Archive original data

**Files to modify:**

- `src/server/httpTransport.ts`
- `workflows/mylo-mcp-agent.workflow.json`
- `scripts/summarizeEpisodicMemory.ts` (new)

**Exit Criteria:** Conversations automatically logged and retrievable

---

### Milestone 2.3: Memory Graph Implementation

**Goal:** Create semantic links between related memories for graph traversal and cluster retrieval.

#### Step 2.3.1: Design Memory Graph Schema

- [ ] **Define graph data model**
  - [ ] Create `docs/MEMORY_GRAPH_DESIGN.md`
  - [ ] Design node: existing prompt_embeddings rows
  - [ ] Design edges:
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
  - [ ] Define link types and semantics
  - [ ] Plan automatic vs. manual link creation

- [ ] **Create migration**
  - [ ] Create `0005_add_memory_graph.sql`
  - [ ] Create `memory_links` table
  - [ ] Add indices on source and target
  - [ ] Add index on link_type for filtering

**Files to create:**

- `docs/MEMORY_GRAPH_DESIGN.md`
- `drizzle/0005_add_memory_graph.sql`

**Exit Criteria:** Memory graph schema defined and created

---

#### Step 2.3.2: Implement Automatic Link Generation

- [ ] **Create link detector**
  - [ ] Create `src/vector/linkDetector.ts`
  - [ ] Implement `generateLinks(chunkId: string): Promise<MemoryLink[]>`
  - [ ] Find similar chunks via cosine similarity
  - [ ] Threshold: similarity > 0.75 for 'similar' link
  - [ ] Threshold: similarity 0.5-0.75 for 'related' link
  - [ ] Filter out self-links

- [ ] **Add to ingestion pipeline**
  - [ ] After embedding new chunks, generate links
  - [ ] Run link generation asynchronously
  - [ ] Batch process to avoid N² complexity
  - [ ] Update existing chunks' links when new content added

- [ ] **Implement link repository**
  - [ ] Create `src/db/linkRepository.ts`
  - [ ] `createLink(source, target, type, strength): Promise<void>`
  - [ ] `getLinkedChunks(chunkId): Promise<LinkedChunk[]>`
  - [ ] `findCluster(chunkId, depth): Promise<ChunkCluster>`

- [ ] **Write tests**
  - [ ] Test link generation for similar prompts
  - [ ] Test link filtering by threshold
  - [ ] Test bidirectional linking
  - [ ] Test cluster discovery

**Files to create:**

- `src/vector/linkDetector.ts`
- `src/db/linkRepository.ts`
- `src/db/linkRepository.test.ts`

**Exit Criteria:** Links automatically generated between similar memories

---

#### Step 2.3.3: Implement Graph Traversal Search

- [ ] **Create graph search algorithm**
  - [ ] Create `src/vector/graphSearch.ts`
  - [ ] Implement BFS graph traversal from seed chunk
  - [ ] Implement weighted graph walk (prioritize strong links)
  - [ ] Implement cluster expansion (get all chunks within N hops)
  - [ ] Add cycle detection

- [ ] **Add to search repository**
  - [ ] `searchWithGraphExpansion(query, maxHops): Promise<GraphSearchResult[]>`
  - [ ] Initial semantic search for seed nodes
  - [ ] Expand via graph links
  - [ ] Score by: (initial_similarity _ 0.7) + (link_strength _ 0.3 / hop_distance)
  - [ ] Return ranked results with graph path

- [ ] **Add graph search parameters**
  - [ ] `expandGraph: boolean` - enable graph expansion
  - [ ] `maxHops: number` - traversal depth (default: 2)
  - [ ] `minLinkStrength: float` - filter weak links (default: 0.5)

- [ ] **Write tests**
  - [ ] Test single-hop expansion
  - [ ] Test multi-hop expansion
  - [ ] Test cycle handling
  - [ ] Test weak link filtering

**Files to create:**

- `src/vector/graphSearch.ts`
- `src/vector/graphSearch.test.ts`

**Files to modify:**

- `src/db/repository.ts`

**Exit Criteria:** Graph traversal returns related memories through link relationships

---

#### Step 2.3.4: Update Search Tool with Graph Expansion

- [ ] **Add graph expansion to search tool**
  - [ ] Add `expandGraph: boolean` parameter
  - [ ] Add `graphDepth: number` parameter (default: 2)
  - [ ] Pass to repository search
  - [ ] Include graph path in results

- [ ] **Update output schema**
  - [ ] Add `relatedChunks: ChunkReference[]` to each result
  - [ ] Add `linkPath: LinkEdge[]` showing graph traversal
  - [ ] Add `graphExpanded: boolean` to metadata

- [ ] **Add visualization support**
  - [ ] Return graph structure as JSON for visualization
  - [ ] Include nodes (chunks) and edges (links)
  - [ ] Add link types and strengths

**Files to modify:**

- `src/server/tools/promptSearchTool.ts`

**Exit Criteria:** Search can discover related prompts via graph links

---

## Phase 3: Adaptive RAG Implementation (Weeks 9-12)

### Milestone 3.1: Adaptive Retrieval Controller

**Goal:** Enable agents to decide when and how to retrieve information dynamically.

#### Step 3.1.1: Design Adaptive Retrieval Framework

- [ ] **Create architecture document**
  - [ ] Create `docs/ADAPTIVE_RETRIEVAL.md`
  - [ ] Define retrieval decision workflow:
    1. Agent receives query
    2. Self-assess: "Do I need more information?"
    3. If yes, formulate retrieval query
    4. Execute search
    5. Evaluate result utility
    6. Decide: iterate, refine, or stop
  - [ ] Design confidence scoring
  - [ ] Plan iteration limits and termination conditions

- [ ] **Define retrieval strategies**
  - [ ] **Single-shot**: Traditional one-time search
  - [ ] **Iterative**: Multi-round with query refinement
  - [ ] **Hypothesis-driven**: Generate hypothetical query, search, validate
  - [ ] **Multi-hop**: Follow references across searches
  - [ ] **Fallback**: Try different search modes if initial fails

**Files to create:**

- `docs/ADAPTIVE_RETRIEVAL.md`

**Exit Criteria:** Adaptive retrieval framework documented

---

#### Step 3.1.2: Implement Retrieval Decision Agent

- [ ] **Create retrieval decision module**
  - [ ] Create `src/vector/retrievalDecisionAgent.ts`
  - [ ] Implement `shouldRetrieve(context: AgentContext): Promise<RetrievalDecision>`
  - [ ] Use LLM to assess information need:
    ```
    Given query: {query}
    Current knowledge: {summary}
    Do you need external information? (yes/no/maybe)
    If yes, what specific information would help?
    ```
  - [ ] Return structured decision with confidence score

- [ ] **Implement query formulation**
  - [ ] `formulateRetrievalQuery(query: string, context: string): Promise<string>`
  - [ ] Generate search query from agent's information need
  - [ ] Optimize for vector search (descriptive, semantic)
  - [ ] Generate multiple query variations if confidence low

- [ ] **Add utility evaluation**
  - [ ] `evaluateResultUtility(results: SearchResult[], query: string): number`
  - [ ] Score 0-1 based on relevance
  - [ ] Use LLM or heuristics (similarity threshold, result count)
  - [ ] Decide if refinement needed

- [ ] **Write tests**
  - [ ] Test decision on query with missing context
  - [ ] Test decision on query with sufficient context
  - [ ] Test query formulation quality
  - [ ] Test utility evaluation

**Files to create:**

- `src/vector/retrievalDecisionAgent.ts`
- `src/vector/retrievalDecisionAgent.test.ts`

**Exit Criteria:** Decision agent correctly identifies when retrieval needed

---

#### Step 3.1.3: Implement Iterative Retrieval Loop

- [ ] **Create retrieval orchestrator**
  - [ ] Create `src/vector/retrievalOrchestrator.ts`
  - [ ] Implement `adaptiveSearch(query: string, context: Context): Promise<RetrievalResult>`
  - [ ] Workflow:
    1. Assess retrieval need
    2. If needed, formulate query
    3. Execute search
    4. Evaluate utility
    5. If utility low, refine and iterate (max 3 iterations)
    6. Return aggregated results

- [ ] **Implement query refinement**
  - [ ] `refineQuery(originalQuery: string, results: SearchResult[]): string`
  - [ ] Analyze gaps in results
  - [ ] Generate improved query
  - [ ] Try different search modes or filters

- [ ] **Add iteration tracking**
  - [ ] Track iteration count
  - [ ] Log refinement decisions
  - [ ] Measure cumulative latency
  - [ ] Limit max iterations (default: 3)

- [ ] **Implement result aggregation**
  - [ ] Merge results across iterations
  - [ ] Deduplicate by chunk_id
  - [ ] Rank by combined relevance
  - [ ] Track provenance (which iteration found each result)

- [ ] **Write tests**
  - [ ] Test single iteration (high utility)
  - [ ] Test multiple iterations (refinement)
  - [ ] Test iteration limit
  - [ ] Test result deduplication

**Files to create:**

- `src/vector/retrievalOrchestrator.ts`
- `src/vector/retrievalOrchestrator.test.ts`

**Exit Criteria:** Iterative retrieval successfully refines queries until utility threshold met

---

#### Step 3.1.4: Create Adaptive Search MCP Tool

- [ ] **Design tool interface**
  - [ ] Tool name: `prompts.search_adaptive`
  - [ ] Inputs:
    - `query: string`
    - `context?: string` - current agent knowledge
    - `maxIterations?: number` - iteration limit
    - `utilityThreshold?: number` - stop if exceeded
  - [ ] Outputs:
    - `results: SearchResult[]`
    - `iterations: IterationLog[]` - decision history
    - `totalDuration: number`
    - `finalUtility: number`

- [ ] **Implement tool**
  - [ ] Create `src/server/tools/adaptiveSearchTool.ts`
  - [ ] Use retrievalOrchestrator
  - [ ] Add timeout protection (max 30s)
  - [ ] Include detailed logging for debugging
  - [ ] Register with MCP server

- [ ] **Add monitoring**
  - [ ] Track adaptive search usage
  - [ ] Measure iteration distribution
  - [ ] Monitor latency P50/P95/P99
  - [ ] Alert on excessive iterations

- [ ] **Write integration tests**
  - [ ] Test simple query (should not iterate)
  - [ ] Test complex query (should iterate)
  - [ ] Test timeout handling
  - [ ] Test error recovery

**Files to create:**

- `src/server/tools/adaptiveSearchTool.ts`
- `src/server/tools/adaptiveSearchTool.test.ts`

**Exit Criteria:** Adaptive search tool available via MCP with iteration control

---

### Milestone 3.2: Multi-Hop Search

**Goal:** Enable following references and relationships across multiple search steps.

#### Step 3.2.1: Implement Reference Extraction

- [ ] **Create reference detector**
  - [ ] Create `src/vector/referenceExtractor.ts`
  - [ ] Extract references from search results:
    - Persona names
    - Project names
    - Workflow step references
    - External documentation links
  - [ ] Use regex + NLP (entity recognition)
  - [ ] Return structured reference list

- [ ] **Add reference resolution**
  - [ ] `resolveReference(ref: Reference): Promise<SearchResult[]>`
  - [ ] Look up referenced entity in appropriate memory component
  - [ ] Return full context for reference

- [ ] **Write tests**
  - [ ] Test persona reference extraction
  - [ ] Test project reference extraction
  - [ ] Test reference resolution

**Files to create:**

- `src/vector/referenceExtractor.ts`
- `src/vector/referenceExtractor.test.ts`

**Exit Criteria:** Can extract and resolve references from search results

---

#### Step 3.2.2: Implement Multi-Hop Search Algorithm

- [ ] **Create multi-hop searcher**
  - [ ] Create `src/vector/multiHopSearch.ts`
  - [ ] Implement `multiHopSearch(query: string, maxHops: number): Promise<MultiHopResult>`
  - [ ] Algorithm:
    1. Initial search (hop 0)
    2. Extract references from results
    3. Search for each reference (hop 1)
    4. Repeat up to maxHops
    5. Aggregate all results with hop provenance

- [ ] **Add hop scoring**
  - [ ] Score decay per hop: `score / (hop + 1)`
  - [ ] Prioritize direct results over transitive
  - [ ] Track hop path for each result

- [ ] **Implement pruning**
  - [ ] Limit results per hop (e.g., top 5)
  - [ ] Skip low-relevance hops
  - [ ] Deduplicate across hops

- [ ] **Write tests**
  - [ ] Test single-hop search
  - [ ] Test two-hop search with references
  - [ ] Test hop limit enforcement
  - [ ] Test result deduplication

**Files to create:**

- `src/vector/multiHopSearch.ts`
- `src/vector/multiHopSearch.test.ts`

**Exit Criteria:** Multi-hop search follows references across prompts

---

#### Step 3.2.3: Add Multi-Hop to Adaptive Search

- [ ] **Integrate multi-hop with adaptive search**
  - [ ] Add `enableMultiHop: boolean` to adaptive search
  - [ ] If enabled, apply multi-hop expansion after initial retrieval
  - [ ] Include hop information in results
  - [ ] Count hops toward iteration limit

- [ ] **Update adaptive search tool**
  - [ ] Add `maxHops: number` parameter
  - [ ] Add hop path to output
  - [ ] Document multi-hop behavior

**Files to modify:**

- `src/vector/retrievalOrchestrator.ts`
- `src/server/tools/adaptiveSearchTool.ts`

**Exit Criteria:** Adaptive search can follow multi-hop references

---

### Milestone 3.3: Runtime Memory Addition

**Goal:** Allow agents to store new knowledge during conversations.

#### Step 3.3.1: Design Runtime Memory API

- [ ] **Define memory write permissions**
  - [ ] Create `docs/RUNTIME_MEMORY_PERMISSIONS.md`
  - [ ] Define who can write to memory:
    - System (always allowed)
    - Agents (with restrictions)
    - Users (with restrictions)
  - [ ] Define moderation requirements
  - [ ] Plan abuse prevention

- [ ] **Design memory addition API**
  - [ ] MCP tool: `memory.add`
  - [ ] Inputs:
    - `content: string` - what to remember
    - `memoryType: MemoryType` - where to store
    - `metadata: object` - context
    - `tags?: string[]` - categorization
  - [ ] Validation rules
  - [ ] Embedding generation

**Files to create:**

- `docs/RUNTIME_MEMORY_PERMISSIONS.md`

**Exit Criteria:** Runtime memory API designed with security controls

---

#### Step 3.3.2: Implement Memory Addition Tool

- [ ] **Create memory writer**
  - [ ] Create `src/server/tools/memoryAddTool.ts`
  - [ ] Implement `addMemory(params: AddMemoryParams): Promise<MemoryId>`
  - [ ] Validate inputs
  - [ ] Generate embeddings
  - [ ] Store in appropriate memory component
  - [ ] Generate links to related memories
  - [ ] Return memory ID

- [ ] **Add moderation layer**
  - [ ] Check content for harmful/inappropriate content
  - [ ] Use OpenAI moderation API
  - [ ] Reject or flag problematic content
  - [ ] Log moderation decisions

- [ ] **Implement memory update**
  - [ ] Tool: `memory.update`
  - [ ] Allow modifying existing memories
  - [ ] Preserve version history
  - [ ] Re-generate embeddings if content changed
  - [ ] Update links

- [ ] **Add memory deletion**
  - [ ] Tool: `memory.delete`
  - [ ] Soft delete (mark inactive)
  - [ ] Preserve for audit trail
  - [ ] Remove from search results
  - [ ] Cascade to links (mark orphaned)

- [ ] **Write tests**
  - [ ] Test valid memory addition
  - [ ] Test validation rejection
  - [ ] Test moderation filtering
  - [ ] Test memory update
  - [ ] Test memory deletion

**Files to create:**

- `src/server/tools/memoryAddTool.ts`
- `src/server/tools/memoryAddTool.test.ts`

**Exit Criteria:** Agents can add, update, and delete memories at runtime

---

#### Step 3.3.3: Add Memory Addition to Agent Workflows

- [ ] **Update workflow to use memory.add**
  - [ ] Modify `mylo-mcp-agent.workflow.json`
  - [ ] Add memory.add call after learning new facts
  - [ ] Store project decisions as project memory
  - [ ] Store user preferences as episodic memory

- [ ] **Implement memory synthesis**
  - [ ] After conversation, synthesize key learnings
  - [ ] Use LLM to extract important facts
  - [ ] Store as semantic memory
  - [ ] Link to conversation (episodic memory)

- [ ] **Add memory review process**
  - [ ] Periodic review of agent-added memories
  - [ ] Human-in-the-loop approval for sensitive data
  - [ ] Dashboard for memory management

**Files to modify:**

- `workflows/mylo-mcp-agent.workflow.json`

**Exit Criteria:** Agents automatically store new learnings during conversations

---

### Milestone 3.4: Integration and Testing

**Goal:** Integrate all adaptive features and validate end-to-end.

#### Step 3.4.1: Feature Flag Management

- [ ] **Implement feature flag system**
  - [ ] Add configuration for all new features:
    - `HYBRID_SEARCH_ENABLED`
    - `MEMORY_ROUTING_ENABLED`
    - `EPISODIC_MEMORY_ENABLED`
    - `MEMORY_GRAPH_ENABLED`
    - `ADAPTIVE_RETRIEVAL_ENABLED`
    - `RUNTIME_MEMORY_ENABLED`
  - [ ] Support environment variables
  - [ ] Support runtime configuration
  - [ ] Add admin API to toggle flags

- [ ] **Create gradual rollout plan**
  - [ ] Phase 1: Enable hybrid search (50% traffic)
  - [ ] Phase 2: Enable memory routing (25% traffic)
  - [ ] Phase 3: Enable adaptive retrieval (10% traffic)
  - [ ] Phase 4: Enable runtime memory (off by default, manual enable)
  - [ ] Monitor each phase for issues

**Files to modify:**

- `src/config/index.ts`

---

#### Step 3.4.2: Comprehensive Integration Testing

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

#### Step 3.4.3: Documentation and Training

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
2. ⬜ Create Phase 1 branch
3. ⬜ Set up feature flag infrastructure
4. ⬜ Implement Step 1.1.1: Add full-text search schema
5. ⬜ Implement Step 1.1.2: Add keyword search method
6. ⬜ Daily standups to track progress

**Success Criteria:**

- Full-text search working in dev environment
- First integration test passing
- Team aligned on architecture

---

## Conclusion

This plan transforms our static RAG system into a modern adaptive agentic memory system while maintaining backward compatibility and production stability. We build incrementally, test thoroughly, and deploy gradually behind feature flags.

**The journey from B+ to A+ starts with Week 1, Step 1.1.1. Let's ship it! 🚀**
