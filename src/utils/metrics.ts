import { Counter, Histogram, Gauge, register } from 'prom-client';

// Tool call metrics
export const toolCallDuration = new Histogram({
  name: 'mcp_tool_call_duration_ms',
  help: 'MCP tool call duration in milliseconds',
  labelNames: ['tool_name', 'status'],
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
});

export const toolCallErrors = new Counter({
  name: 'mcp_tool_call_errors_total',
  help: 'Total MCP tool call errors',
  labelNames: ['tool_name', 'error_type'],
});

// Memory search metrics
export const memorySearchDuration = new Histogram({
  name: 'memory_search_duration_ms',
  help: 'Memory search duration',
  labelNames: ['search_mode', 'memory_type'],
  buckets: [10, 25, 50, 75, 100, 150, 200],
});

export const memorySearchResults = new Histogram({
  name: 'memory_search_results_count',
  help: 'Number of memories returned',
  labelNames: ['memory_type'],
  buckets: [0, 1, 5, 10, 20, 50, 100],
});

// Workflow metrics
export const workflowExecutions = new Counter({
  name: 'workflow_executions_total',
  help: 'Total workflow executions',
  labelNames: ['workflow_name', 'status'],
});

export const workflowDuration = new Histogram({
  name: 'workflow_duration_ms',
  help: 'Workflow execution duration',
  labelNames: ['workflow_name'],
  buckets: [100, 500, 1000, 2000, 5000, 10000, 30000],
});

// Database metrics
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_ms',
  help: 'Database query duration',
  labelNames: ['operation'],
  buckets: [1, 5, 10, 25, 50, 100, 200],
});

// Session metrics
export const activeSessions = new Gauge({
  name: 'active_sessions_count',
  help: 'Number of active sessions',
});

export { register };

