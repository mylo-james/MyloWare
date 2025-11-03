# MCP Tool Inventory

This document catalogs all MCP tools available in the system, extracted from source code and tests.

## Tools Overview

| Tool Name | File | Namespace | Pattern | Description |
|-----------|------|-----------|---------|-------------|
| `prompts_search_adaptive` | `adaptiveSearchTool.ts` | `prompts` | `knowledge_base` | Adaptive prompt search with iterative retrieval and confidence scoring |
| `conversation_latest` | `conversationLatestTool.ts` | `memory` | `structured_data_retrieval` | Fetch recent conversation turns without semantic search |
| `conversation_remember` | `conversationMemoryTool.ts` | `memory` | `knowledge_base` | Semantic search across episodic conversation memory |
| `conversation_store` | `conversationStoreTool.ts` | `memory` | `external_api` | Store conversation turns into episodic memory |
| `memory_add` | `memoryAddTool.ts` | `memory` | `external_api` | Add runtime memory chunk with moderation |
| `memory_update` | `memoryAddTool.ts` | `memory` | `external_api` | Update existing memory chunk with version history |
| `memory_delete` | `memoryAddTool.ts` | `memory` | `external_api` | Soft-delete memory chunk (mark inactive) |
| `prompt_get` | `promptGetTool.ts` | `prompts` | `structured_data_retrieval` | Resolve prompt document by persona/project metadata |
| `prompt_list` | `promptListTool.ts` | `prompts` | `structured_data_retrieval` | List available prompts with metadata filters |
| `prompt_search` | `promptSearchTool.ts` | `prompts` | `knowledge_base` | Semantic/keyword/hybrid search across prompt corpus |

## Detailed Tool Metadata

### prompts_search_adaptive

**File**: `src/server/tools/adaptiveSearchTool.ts`  
**MCP Name**: `prompts_search_adaptive`  
**Category**: `search`

**Description**: Runs adaptive retrieval controller to decide if and how to search for prompts. Supports iterative refinement, hybrid search modes, multi-hop expansion, and telemetry for each iteration. Use when a query may require multiple retrieval passes or confidence scoring.

**Input Schema**: Complex object with query, optional context (summary, knownFacts, missingInformation), filters (persona, project, memoryTypes), search parameters (limit, minSimilarity, initialMode, searchModes), and multi-hop options.

**Output Schema**: Includes decision (yes/no/maybe with confidence), retrieved boolean, finalUtility score, totalDurationMs, iterations array, and results array with matches.

**Constraints**:
- Default timeout: 30 seconds
- Max iterations: 5
- Max limit: 50
- Default max iterations: 3

**Dependencies**: PromptEmbeddingsRepository, embedTexts, adaptiveSearch orchestrator

**Side Effects**: Reads from vector database, generates embeddings

---

### conversation_latest

**File**: `src/server/tools/conversationLatestTool.ts`  
**MCP Name**: `conversation_latest`  
**Category**: `memory`

**Description**: Pull the most recent conversation turns for a session without doing semantic search. Perfect when you just need the latest context window before making a decision. Defaults to 10 newest turns (descending order).

**Input Schema**: 
- sessionId (UUID, required)
- limit (1-50, default: 10)
- order ('asc' | 'desc', default: 'desc')

**Output Schema**: Turns array, sessionId, fetched count, limit, order

**Constraints**:
- Max limit: 50
- Default limit: 10

**Dependencies**: EpisodicMemoryRepository

**Side Effects**: Reads from episodic memory database

---

### conversation_remember

**File**: `src/server/tools/conversationMemoryTool.ts`  
**MCP Name**: `conversation_remember`  
**Category**: `memory`

**Description**: Instantly pull the most relevant past conversation turns using semantic search, session/user filters, and time ranges. Choose chat, narrative, or bullet formatting so you can drop the recall straight into a response plan. Perfect for grounding follow-up answers without manually paging through history.

**Input Schema**:
- query (string, required)
- sessionId (UUID, optional)
- userId (string, optional)
- limit (1-50, default: 10)
- minSimilarity (0-1, default: 0.25)
- timeRange (start/end ISO dates, optional)
- format ('chat' | 'narrative' | 'bullets', default: 'chat')

**Output Schema**: Turns array with similarity scores, context string (formatted), appliedFilters object

**Constraints**:
- Max limit: 50
- Default limit: 10
- Default minSimilarity: 0.25
- Max preview length: 220 chars
- Max approximate tokens: 600

**Dependencies**: EpisodicMemoryRepository, embedTexts

**Side Effects**: Reads from episodic memory database, generates embeddings for query

---

### conversation_store

**File**: `src/server/tools/conversationStoreTool.ts`  
**MCP Name**: `conversation_store`  
**Category**: `memory`

**Description**: Persist any conversation turn—user, assistant, system, or tool—into episodic memory with full metadata. Automatically enriches entries with embeddings and returns IDs you can reuse for recall, analytics, or chaining workflows. Provide your own sessionId to append to a thread or omit it to spawn a fresh conversation on the fly.

**Input Schema**:
- sessionId (UUID, optional - auto-generated if omitted)
- role ('user' | 'assistant' | 'system' | 'tool', required)
- content (string, required, non-empty)
- userId (string, optional)
- metadata (object, optional)
- summary (object, optional)
- embeddingText (string, optional - uses content if omitted)
- occurredAt (ISO date-time, optional)
- tags (array of strings, max 20, optional)

**Output Schema**: sessionId, turnId, chunkId, promptKey, isNewSession boolean, storedAt ISO timestamp

**Dependencies**: EpisodicMemoryRepository

**Side Effects**: Writes to episodic memory database, generates embeddings

---

### memory_add

**File**: `src/server/tools/memoryAddTool.ts`  
**MCP Name**: `memory_add`  
**Category**: `memory`

**Description**: Adds a new memory chunk to the adaptive memory store, generating embeddings and metadata automatically. Includes moderation and permission checks before persisting the memory.

**Input Schema**:
- content (string, required, 1-2048 chars)
- memoryType ('persona' | 'project' | 'semantic' | 'procedural' | 'episodic', required)
- title (string, max 120 chars, required for non-episodic)
- summary (string, max 280 chars, optional)
- tags (array, max 10, optional)
- source ('agent' | 'user' | 'workflow' | 'system', optional)
- visibility ('public' | 'team' | 'private', optional)
- metadata (object, optional)
- relatedChunkIds (array, max 20, optional)
- confidence (0-1, optional)
- sessionId (UUID, required if episodic)
- actor (object with type and id, required)
- force (boolean, optional - override moderation)

**Output Schema**: memoryId, memoryType, promptKey, status ('created'), moderationStatus ('accepted' | 'pending_review'), createdAt

**Constraints**:
- Content max length: 2048 chars
- Title max length: 120 chars
- Summary max length: 280 chars
- Max tags: 10
- Max relatedChunkIds: 20
- Title required for non-episodic memories
- sessionId required for episodic memories

**Permissions**:
- System/operator: all memory types
- Agent: all except episodic
- Integration: project and semantic only
- User: episodic only

**Dependencies**: PromptEmbeddingsRepository, MemoryLinkRepository, embedTexts, OpenAI moderation API

**Side Effects**: Writes to vector database, creates memory links, calls moderation API

---

### memory_update

**File**: `src/server/tools/memoryAddTool.ts`  
**MCP Name**: `memory_update`  
**Category**: `memory`

**Description**: Updates an existing memory chunk, re-embedding content when modified and recording version history.

**Input Schema**:
- memoryId (string, required)
- content (string, 1-2048 chars, optional)
- title (string, max 120 chars, optional)
- summary (string, max 280 chars, optional)
- tags (array, max 10, optional)
- visibility ('public' | 'team' | 'private', optional)
- metadata (object, optional)
- relatedChunkIds (array, max 20, optional)
- confidence (0-1, optional)
- actor (object with type and id, required)
- force (boolean, optional)

**Output Schema**: memoryId, memoryType, promptKey, status ('updated'), version (integer), contentChanged (boolean), updatedAt

**Constraints**: At least one update field must be provided

**Permissions**: Similar to memory_add, with additional check that actor created the memory (for agents/integrations/users)

**Dependencies**: PromptEmbeddingsRepository, MemoryLinkRepository, embedTexts

**Side Effects**: Updates vector database, updates memory links, regenerates embeddings if content changed

---

### memory_delete

**File**: `src/server/tools/memoryAddTool.ts`  
**MCP Name**: `memory_delete`  
**Category**: `memory`

**Description**: Soft-deletes a memory chunk, marking it inactive and removing associated links while preserving audit history.

**Input Schema**:
- memoryId (string, required)
- actor (object with type and id, required)
- reason (string, max 280 chars, optional)
- force (boolean, optional)

**Output Schema**: memoryId, status ('inactive'), deletedAt

**Permissions**: System/operator can delete any; users can only delete their own episodic memories

**Dependencies**: PromptEmbeddingsRepository, MemoryLinkRepository

**Side Effects**: Updates vector database (marks inactive), deletes memory links

---

### prompt_get

**File**: `src/server/tools/promptGetTool.ts`  
**MCP Name**: `prompt_get`  
**Category**: `prompts`

**Description**: Fetch the canonical prompt document—complete with markdown content and metadata—for a given persona or project. Pass persona_name, project_name, or both to disambiguate overlapping prompts, and receive resolution diagnostics along the way. Ideal for loading an AI Agent persona's system prompt before answering a user.

**Input Schema**:
- project_name (string, optional)
- persona_name (string, optional)
- tags (array of strings, optional)
- At least one of project_name or persona_name must be provided

**Output Schema**: prompt (object with promptKey, content, metadata, updatedAt or null), resolution (strategy, project, persona, analyzedMatches, tags), candidates array

**Dependencies**: PromptEmbeddingsRepository

**Side Effects**: Reads from vector database

---

### prompt_list

**File**: `src/server/tools/promptListTool.ts`  
**MCP Name**: `prompt_list`  
**Category**: `prompts`

**Description**: Build a bird's-eye map of the prompt library with rich metadata in one call. Filter by persona, project, or combination type to see exactly what content exists and when it was last updated. Perfect for loading every project slug before a conversation or auditing coverage across personas.

**Input Schema**:
- persona (string, optional)
- project (string, optional)
- type ('persona' | 'project' | 'combination', optional)

**Output Schema**: prompts array (promptKey, metadata, chunkCount, updatedAt), appliedFilters object

**Dependencies**: PromptEmbeddingsRepository

**Side Effects**: Reads from vector database

---

### prompt_search

**File**: `src/server/tools/promptSearchTool.ts`  
**MCP Name**: `prompt_search`  
**Category**: `prompts`

**Description**: Swiss-army retrieval across the entire prompt corpus: vector, keyword, or hybrid modes in one tool. Layer on persona/project filters, temporal decay, graph expansion, and memory routing to surface the most relevant snippets. Returns ranked chunks with previews, similarity scores, and diagnostics so you know why each result appeared.

**Input Schema**:
- query (string, required)
- persona (string, optional)
- project (string, optional)
- limit (1-50, default: 10)
- minSimilarity (0-1, optional - defaults vary by mode)
- searchMode ('vector' | 'keyword' | 'hybrid', default: 'hybrid')
- autoFilter (boolean, default: true)
- useMemoryRouting (boolean, optional)
- expandGraph (boolean, optional)
- graphMaxHops (1-5, optional)
- graphMinLinkStrength (0-1, optional)
- temporalBoost (boolean, optional)
- temporalConfig (object with strategy, halfLifeDays, maxAgeDays, optional)

**Output Schema**: matches array (chunkId, promptKey, similarity, metadata, preview, ageDays, temporalDecayApplied, memoryComponent, graphContext), appliedFilters object, graph visualization (nullable)

**Constraints**:
- Max limit: 50
- Default limit: 10
- Max graph hops: 5
- Default minSimilarity: 0.3 for vector, 0 for keyword/hybrid

**Dependencies**: PromptEmbeddingsRepository, embedTexts, queryEnhancer, memoryRouter

**Side Effects**: Reads from vector database, generates embeddings, may perform graph traversal

---

## Registration Location

All tools are registered in `src/server/createMcpServer.ts`:

```typescript
registerPromptGetTool(server);
registerPromptListTool(server);
registerPromptSearchTool(server);
registerAdaptiveSearchTool(server);
registerConversationMemoryTool(server);
registerConversationStoreTool(server);
registerConversationLatestTool(server);
registerMemoryTools(server); // Registers memory_add, memory_update, memory_delete
```

## Common Dependencies

- **PromptEmbeddingsRepository**: Vector database operations for prompts
- **EpisodicMemoryRepository**: Episodic memory storage
- **MemoryLinkRepository**: Memory graph relationships
- **embedTexts**: OpenAI embedding generation
- **config**: Application configuration (search settings, timeouts, etc.)

## Test Coverage

All tools have corresponding `.test.ts` files that provide:
- Example inputs
- Expected outputs
- Error scenarios
- Mocked dependencies

See test files in `src/server/tools/*.test.ts` for detailed examples.
