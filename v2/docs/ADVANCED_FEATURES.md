# Advanced Features

This document describes the advanced intelligence features implemented in Phase 5 of the MCP Prompts V2 system.

## Table of Contents

- [Memory Graph Expansion](#memory-graph-expansion)
- [Error Handling](#error-handling)
- [Metrics Collection](#metrics-collection)
- [Performance Characteristics](#performance-characteristics)

## Memory Graph Expansion

### Overview

Memory graph expansion enhances search results by traversing linked memories. When searching with `expandGraph=true`, the system follows relationships stored in the `relatedTo` array to discover related memories across multiple hops.

### Usage

```typescript
const results = await searchMemories({
  query: 'generate AISMR ideas',
  expandGraph: true,
  maxHops: 2,
  limit: 10
});
```

### Parameters

- **expandGraph** (boolean, optional): Enable graph expansion. Default: `false`
- **maxHops** (number, optional): Maximum number of hops to traverse. Default: `2`
- **limit** (number, optional): Maximum number of results to return. Default: `10`

### How It Works

1. Initial search returns seed memories using hybrid vector + keyword retrieval
2. System follows `relatedTo` links from seed memories
3. Expands to linked memories up to `maxHops` distance
4. Prevents circular references using visited set
5. Limits total expanded memories to prevent explosion

### Example

```typescript
// Memory A is linked to Memory B
// Memory B is linked to Memory C
// Searching with expandGraph=true, maxHops=2 will return A, B, and C
```

### Best Practices

- Use `maxHops=1` for closely related memories
- Use `maxHops=2` for broader context (default)
- Avoid `maxHops>3` to prevent performance degradation
- Combine with `temporalBoost` for time-aware expansion

## Error Handling

### Custom Error Classes

The system uses a hierarchy of custom error classes for better error handling:

```typescript
MCPError (base class)
├── DatabaseError
├── OpenAIError
├── WorkflowError
└── ValidationError
```

### Error Types

#### DatabaseError

Thrown when database operations fail:

```typescript
throw new DatabaseError('Failed to insert memory', cause);
```

#### OpenAIError

Thrown when OpenAI API calls fail:

```typescript
throw new OpenAIError('Rate limit exceeded', 429);
```

#### WorkflowError

Thrown when workflow execution fails:

```typescript
throw new WorkflowError('Workflow not found', workflowId);
```

#### ValidationError

Thrown when input validation fails:

```typescript
throw new ValidationError('Query contains newlines', 'query');
```

### Retry Logic

OpenAI API calls are wrapped with exponential backoff retry:

```typescript
import { withRetry } from '@/utils/retry.js';

const result = await withRetry(
  async () => {
    return await openai.embeddings.create({ ... });
  },
  {
    maxRetries: 3,
    initialDelay: 1000,
    backoffMultiplier: 2,
    shouldRetry: (error) => {
      return error.message.includes('rate_limit') || 
             error.message.includes('network');
    }
  }
);
```

### Retry Configuration

- **maxRetries**: Maximum number of retry attempts (default: 3)
- **initialDelay**: Initial delay in milliseconds (default: 1000)
- **backoffMultiplier**: Multiplier for exponential backoff (default: 2)
- **shouldRetry**: Predicate function to determine if error should be retried

### Retry Behavior

- Retries on rate limit errors
- Retries on network errors
- Retries on timeout errors
- Does not retry on validation errors
- Exponential backoff: 1s, 2s, 4s for 3 retries

## Metrics Collection

### Prometheus Integration

The system exposes Prometheus metrics at `/metrics` endpoint. All metrics follow Prometheus naming conventions.

### Available Metrics

#### Tool Call Metrics

- **mcp_tool_call_duration_ms**: Histogram of tool call durations
  - Labels: `tool_name`, `status` (success/error)
  - Buckets: 10, 50, 100, 200, 500, 1000, 2000, 5000ms

- **mcp_tool_call_errors_total**: Counter of tool call errors
  - Labels: `tool_name`, `error_type`

#### Memory Search Metrics

- **memory_search_duration_ms**: Histogram of search durations
  - Labels: `search_mode` (hybrid), `memory_type`
  - Buckets: 10, 25, 50, 75, 100, 150, 200ms

- **memory_search_results_count**: Histogram of result counts
  - Labels: `memory_type`
  - Buckets: 0, 1, 5, 10, 20, 50, 100

#### Workflow Metrics

- **workflow_executions_total**: Counter of workflow executions
  - Labels: `workflow_name`, `status` (running/completed/failed)

- **workflow_duration_ms**: Histogram of workflow durations
  - Labels: `workflow_name`
  - Buckets: 100, 500, 1000, 2000, 5000, 10000, 30000ms

#### Database Metrics

- **db_query_duration_ms**: Histogram of database query durations
  - Labels: `operation`
  - Buckets: 1, 5, 10, 25, 50, 100, 200ms

#### Session Metrics

- **active_sessions_count**: Gauge of active sessions

### Querying Metrics

```bash
# Get all metrics
curl http://localhost:3000/metrics

# Query specific metric (requires Prometheus)
memory_search_duration_ms{memory_type="episodic"}
```

### Example Queries

```promql
# Average search duration by memory type
rate(memory_search_duration_ms_sum[5m]) / rate(memory_search_duration_ms_count[5m])

# Error rate by tool
rate(mcp_tool_call_errors_total[5m])

# P95 search duration
histogram_quantile(0.95, memory_search_duration_ms_bucket)
```

## Performance Characteristics

### Benchmarks

Performance targets verified by automated tests:

#### Memory Search

- **Vector search**: < 100ms (p95)
- **Keyword search**: < 50ms (p95)
- **Graph expansion**: < 200ms (p95)
- **Concurrent searches**: 10+ handled in < 500ms

#### Workflow Discovery

- **Discovery**: < 200ms (p95)
- **Concurrent discoveries**: 5+ handled in < 800ms

#### Database Queries

- **Query duration**: < 50ms (p95)
- **Vector similarity**: Optimized with pgvector indexes

### Optimization Tips

1. **Use appropriate limits**: Don't request more results than needed
2. **Filter early**: Use `memoryTypes`, `project`, `persona` filters
3. **Limit graph expansion**: Use `maxHops=1` when possible
4. **Use minSimilarity**: Filter low-quality results early
5. **Enable temporal boost**: Only when recency matters

### Performance Monitoring

Monitor these metrics for performance issues:

- `memory_search_duration_ms` - Should stay < 100ms
- `db_query_duration_ms` - Should stay < 50ms
- `mcp_tool_call_duration_ms` - Track per-tool performance

### Scaling Considerations

- Database connections: Connection pooling handles concurrent requests
- Vector search: pgvector indexes optimize similarity queries
- OpenAI API: Retry logic handles rate limits gracefully
- Memory: Graph expansion limited to prevent memory explosion

## Similarity Threshold Filtering

### Overview

The `minSimilarity` parameter filters search results by minimum cosine similarity threshold.

### Usage

```typescript
const results = await searchMemories({
  query: 'generate ideas',
  minSimilarity: 0.7, // Only return memories with >= 70% similarity
  limit: 10
});
```

### How It Works

- Cosine similarity calculated as `1 - cosine_distance`
- Results with similarity < `minSimilarity` are filtered out
- Applied during vector search query for efficiency

### Best Practices

- Use `minSimilarity=0.7` for high-quality results
- Use `minSimilarity=0.5` for broader results
- Lower thresholds may return irrelevant results
- Higher thresholds may return too few results

## Temporal Boosting

### Overview

Temporal boosting increases relevance scores for recent memories using exponential decay.

### Usage

```typescript
const results = await searchMemories({
  query: 'AISMR ideas',
  temporalBoost: true,
  limit: 10
});
```

### How It Works

- Exponential decay: `decayFactor = exp(-decayRate * ageInDays)`
- Default decay rate: `0.1` (10% per day)
- Recent memories get higher temporal scores
- Results sorted by combined relevance + temporal score

### Configuration

Decay rate can be adjusted in `applyTemporalDecay`:

- `0.05` - Slow decay (memories stay relevant longer)
- `0.1` - Default decay (balanced)
- `0.2` - Fast decay (strong preference for recent)

## Auto-Summarization

### Overview

Memories longer than 100 characters are automatically summarized using GPT-4o-mini.

### Behavior

- Summaries generated during memory storage
- Single-line format optimized for AI consumption
- Stored in `summary` field
- Used for fast keyword search

### Configuration

- Model: `gpt-4o-mini`
- Max tokens: `100`
- Temperature: `0.3` (low for consistency)

## Auto-Linking

### Overview

New memories are automatically linked to related existing memories based on semantic similarity.

### Behavior

- Detects up to 5 most similar memories
- Links stored in `relatedTo` array
- Filters by `project` and `persona` when provided
- Enables graph expansion in searches

### Configuration

- Default limit: 5 related memories
- Uses vector similarity search
- Can be customized via `detectRelatedMemories` options

