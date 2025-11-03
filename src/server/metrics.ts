import promClient from 'prom-client';

// Register default metrics (memory, CPU, GC, etc.)
promClient.collectDefaultMetrics({ prefix: 'mcp_prompts_' });

export const httpRequestDuration = new promClient.Histogram({
  name: 'mcp_prompts_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5, 10],
});

export const httpRequestTotal = new promClient.Counter({
  name: 'mcp_prompts_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
});

export const dbQueryDuration = new promClient.Histogram({
  name: 'mcp_prompts_db_query_duration_seconds',
  help: 'Duration of database queries',
  labelNames: ['query_name', 'status'] as const,
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
});

export const vectorSearchDuration = new promClient.Histogram({
  name: 'mcp_prompts_vector_search_duration_seconds',
  help: 'Duration of vector searches',
  labelNames: ['search_type', 'memory_type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

export const embedBatchDuration = new promClient.Histogram({
  name: 'mcp_prompts_embed_batch_duration_seconds',
  help: 'Duration of OpenAI embedding batches',
  labelNames: ['batch_size'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

export const metricsRegistry = promClient.register;
