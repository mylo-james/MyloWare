# MCP Prompts: Code Review Remediation Plan

**Date Created:** November 2, 2025  
**Based On:** REVIEW-CODEX.md and review-claude.md  
**Target Branch:** phase-1  
**Execution Mode:** Sequential, step-by-step for AI agents

---

## 📋 Overview

This plan addresses critical bugs, missing features, and technical debt identified in two comprehensive code reviews. Each task includes explicit, procedural instructions suitable for AI agents with limited reasoning capabilities.

**Total Tasks:** 55  
**Estimated Completion:** 3-4 weeks

---

## ✅ Phase 1: Critical Bug Fixes (Week 1, Days 1-2) — COMPLETED

### Task 1.1: Fix listWorkflowRuns .where(undefined) Bug ✅

**Priority:** CRITICAL  
**File:** `src/db/operations/workflowRunRepository.ts`  
**Issue:** Calling `.where(undefined)` causes runtime error when no filters provided

**Steps:**

- [x] 1.1.1 Open file `src/db/operations/workflowRunRepository.ts`
- [x] 1.1.2 Locate the `listWorkflowRuns` method (around line 158)
- [x] 1.1.3 Find the line `const whereClause = conditions.length > 0 ? and(...conditions) : undefined;` (line 177)
- [x] 1.1.4 Find the query builder section starting at line 179
- [x] 1.1.5 Replace lines 179-183 with this code:

```typescript
const query = this.db.select().from(schema.workflowRuns);

const rows = whereClause
  ? await query.where(whereClause).orderBy(desc(schema.workflowRuns.createdAt))
  : await query.orderBy(desc(schema.workflowRuns.createdAt));

return rows;
```

- [x] 1.1.6 Save the file
- [x] 1.1.7 Run command: `npm test src/db/operations/workflowRunRepository.test.ts`
- [x] 1.1.8 Verify test "returns all workflow runs when no filters provided" passes
- [x] 1.1.9 Run command: `npm run build`
- [x] 1.1.10 Verify build succeeds with no errors

**Acceptance Criteria:**

- ✅ Query executes successfully with empty filters object
- ✅ All existing tests pass
- ✅ No TypeScript errors

---

### Task 1.2: Fix PATCH /api/workflow-runs/:id Error Handling — SUPERSEDED

**Priority:** CRITICAL  
**File:** `src/server/routes/workflow-runs.ts`  
**Issue:** Returns 500 for "not found" instead of 404

**NOTE:** This task was superseded by the typed error approach in Phase 3. Instead of returning null, we implemented `NotFoundError` which provides better type safety and consistency.

**Steps:**

- [~] 1.2.1 Open file `src/db/operations/workflowRunRepository.ts`
- [ ] 1.2.2 Locate the `updateWorkflowRun` method (around line 77)
- [ ] 1.2.3 Check the return type - it currently returns `WorkflowRun` but should handle null
- [ ] 1.2.4 Modify the method to return `WorkflowRun | null`:

```typescript
  async updateWorkflowRun(
    id: string,
    data: UpdateWorkflowRunData,
  ): Promise<WorkflowRun | null> {
```

- [ ] 1.2.5 At the end of `updateWorkflowRun`, after the update query, change:

```typescript
if (!row) {
  return null;
}

return row;
```

- [ ] 1.2.6 Save `src/db/operations/workflowRunRepository.ts`
- [ ] 1.2.7 Open file `src/server/routes/workflow-runs.ts`
- [ ] 1.2.8 Locate the PATCH handler (around line 112)
- [ ] 1.2.9 Replace the try-catch block (lines 125-138) with:

```typescript
try {
  const workflowRun = await workflowRunRepo.updateWorkflowRun(id, {
    status: parsed.data.status,
    currentStage: parsed.data.currentStage as never,
    stages: parsed.data.stages as never,
    output: parsed.data.output,
    workflowDefinitionChunkId: parsed.data.workflowDefinitionChunkId ?? null,
  });

  if (!workflowRun) {
    return sendError(reply, 404, 'NOT_FOUND', `Workflow run with id ${id} not found`);
  }

  void reply.status(200).send({ workflowRun });
} catch (error) {
  app.log.error(error, 'Failed to update workflow run');
  return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to update workflow run');
}
```

- [ ] 1.2.10 Save the file
- [ ] 1.2.11 Run command: `npm run build`
- [ ] 1.2.12 Verify build succeeds

**Acceptance Criteria:**

- Updating non-existent workflow run returns 404
- Updating existing workflow run returns 200
- Other errors still return 500

---

### Task 1.3: Add Workflow Run API Tests ✅

**Priority:** CRITICAL  
**File:** `src/server/routes/workflow-runs.test.ts` (new file)

**Steps:**

- [x] 1.3.1 Create new file `src/server/routes/workflow-runs.test.ts`
- [x] 1.3.2 Copy the following complete test file:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../server';
import { WorkflowRunRepository } from '../../db/operations/workflowRunRepository';
import type { WorkflowRun } from '../../db/operations/schema';

describe('Workflow Run Routes', () => {
  let app: FastifyInstance;
  let mockRepo: {
    createWorkflowRun: ReturnType<typeof vi.fn>;
    getWorkflowRunById: ReturnType<typeof vi.fn>;
    updateWorkflowRun: ReturnType<typeof vi.fn>;
    listWorkflowRuns: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRepo = {
      createWorkflowRun: vi.fn(),
      getWorkflowRunById: vi.fn(),
      updateWorkflowRun: vi.fn(),
      listWorkflowRuns: vi.fn(),
    };

    // Mock the repository
    vi.spyOn(WorkflowRunRepository.prototype, 'createWorkflowRun').mockImplementation(
      mockRepo.createWorkflowRun,
    );
    vi.spyOn(WorkflowRunRepository.prototype, 'getWorkflowRunById').mockImplementation(
      mockRepo.getWorkflowRunById,
    );
    vi.spyOn(WorkflowRunRepository.prototype, 'updateWorkflowRun').mockImplementation(
      mockRepo.updateWorkflowRun,
    );
    vi.spyOn(WorkflowRunRepository.prototype, 'listWorkflowRuns').mockImplementation(
      mockRepo.listWorkflowRuns,
    );

    app = await createServer();
  });

  describe('GET /api/workflow-runs', () => {
    it('should list workflow runs without filters', async () => {
      const mockRuns: WorkflowRun[] = [
        {
          id: 'run-1',
          projectId: 'aismr',
          sessionId: 'session-1',
          currentStage: 'idea_generation',
          status: 'running',
          stages: {},
          input: {},
          output: null,
          workflowDefinitionChunkId: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
      ];

      mockRepo.listWorkflowRuns.mockResolvedValue(mockRuns);

      const response = await app.inject({
        method: 'GET',
        url: '/api/workflow-runs',
      });

      expect(response.statusCode).toBe(200);
      expect(mockRepo.listWorkflowRuns).toHaveBeenCalledWith({});
    });

    it('should list workflow runs with filters', async () => {
      mockRepo.listWorkflowRuns.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/workflow-runs?status=running&projectId=aismr',
      });

      expect(response.statusCode).toBe(200);
      expect(mockRepo.listWorkflowRuns).toHaveBeenCalledWith({
        status: ['running'],
        projectId: 'aismr',
      });
    });
  });

  describe('PATCH /api/workflow-runs/:id', () => {
    it('should return 404 when workflow run not found', async () => {
      mockRepo.updateWorkflowRun.mockResolvedValue(null);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/workflow-runs/non-existent-id',
        payload: {
          status: 'completed',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 200 when workflow run updated successfully', async () => {
      const mockRun: WorkflowRun = {
        id: 'run-1',
        projectId: 'aismr',
        sessionId: 'session-1',
        currentStage: 'idea_generation',
        status: 'completed',
        stages: {},
        input: {},
        output: null,
        workflowDefinitionChunkId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockRepo.updateWorkflowRun.mockResolvedValue(mockRun);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/workflow-runs/run-1',
        payload: {
          status: 'completed',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.workflowRun.status).toBe('completed');
    });

    it('should return 500 on unexpected error', async () => {
      mockRepo.updateWorkflowRun.mockRejectedValue(new Error('Database error'));

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/workflow-runs/run-1',
        payload: {
          status: 'completed',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
```

- [x] 1.3.3 Save the file
- [x] 1.3.4 Run command: `npm test workflow-runs.test.ts`
- [x] 1.3.5 Verify all 10 tests pass (expanded coverage)
- [x] 1.3.6 If tests fail, debug and fix issues

**Acceptance Criteria:**

- ✅ All tests pass (10 tests total)
- ✅ 404 error is tested
- ✅ 200 success is tested
- ✅ 500 error is tested
- ✅ Empty filters are tested
- ✅ Added GET /api/workflow-runs route with tests

---

## ⚠️ Phase 2: Apply Pending Migrations (Week 1, Day 3) — COMPLETED

### Task 2.1: Apply Operations Database Migrations ✅

**Priority:** CRITICAL  
**Issue:** HITL tables may not exist in database

**Steps:**

- [x] 2.1.1 Check if file `drizzle-operations/0003_add_hitl_tables.sql` exists
- [x] 2.1.2 If it exists, run command: `npm run db:operations:migrate`
- [x] 2.1.3 Check output for "Applied X migrations" message
- [x] 2.1.4 If error occurs, read error message carefully
- [x] 2.1.5 If error is "migration already applied", that's OK, continue
- [x] 2.1.6 If error is "connection failed", check OPERATIONS_DATABASE_URL in .env
- [x] 2.1.7 If error is "table already exists", that's OK, continue
- [x] 2.1.8 Stage the migration file: `git add drizzle-operations/0003_add_hitl_tables.sql`
- [x] 2.1.9 Stage the journal: `git add drizzle-operations/meta/_journal.json`
- [x] 2.1.10 Verify staging: `git status` should show both files staged

**Acceptance Criteria:**

- ✅ Migration files already committed
- ✅ Tables `workflow_runs` and `hitl_approvals` exist in schema
- ✅ Migration file is in git (already committed)

---

### Task 2.2: Add Migration Check on Server Startup ✅

**Priority:** HIGH  
**File:** `src/server.ts`  
**Issue:** Server starts even with pending migrations

**Steps:**

- [x] 2.2.1 Create new file `src/db/migrations.ts`
- [x] 2.2.2 Add the following code:

```typescript
import { readdir } from 'fs/promises';
import { join } from 'path';
import { getDb } from './client';
import { sql } from 'drizzle-orm';

export async function checkPendingMigrations(): Promise<string[]> {
  const db = getDb();

  try {
    // Get applied migrations from database
    const result = await db.execute(sql`
      SELECT name FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
    `);

    const appliedMigrations = new Set(
      (result.rows as Array<{ name: string }>).map((row) => row.name),
    );

    // Get migration files from filesystem
    const migrationsDir = join(process.cwd(), 'drizzle');
    const files = await readdir(migrationsDir);
    const migrationFiles = files.filter((f) => f.endsWith('.sql'));

    // Find pending migrations
    const pending = migrationFiles.filter((f) => !appliedMigrations.has(f));

    return pending;
  } catch (error) {
    console.error('Error checking migrations:', error);
    return [];
  }
}
```

- [x] 2.2.3 Save the file
- [x] 2.2.4 Open `src/server.ts`
- [x] 2.2.5 Add import at top: `import { checkPendingMigrations } from './db/migrations';`
- [x] 2.2.6 Locate the `start()` function (around line 68)
- [x] 2.2.7 After `const app = await createServer();` (line 69), add:

```typescript
// Check for pending migrations
if (!config.isTest) {
  const pending = await checkPendingMigrations();
  if (pending.length > 0) {
    app.log.error({ pending }, 'Pending migrations detected');
    app.log.error('Please run: npm run db:migrate');
    process.exit(1);
  }
}
```

- [x] 2.2.8 Save the file
- [x] 2.2.9 Run command: `npm run build`
- [x] 2.2.10 Verify build succeeds

**Acceptance Criteria:**

- ✅ Server checks for pending migrations on startup
- ✅ Server exits with error if migrations pending
- ✅ Test environment skips migration check

---

## 🔧 Phase 3: Standardize Error Handling (Week 1, Days 4-5) — COMPLETED

### Task 3.1: Create Standard Error Types ✅

**Priority:** CRITICAL  
**File:** `src/types/errors.ts` (new file)

**Steps:**

- [x] 3.1.1 Create new file `src/types/errors.ts`
- [x] 3.1.2 Add the following code:

```typescript
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
    path: string;
    requestId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

export class DatabaseError extends ApiError {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(503, 'DATABASE_ERROR', message);
    this.name = 'DatabaseError';
  }
}

export class WorkflowError extends ApiError {
  constructor(
    message: string,
    public workflowId: string,
    public stage: string,
  ) {
    super(500, 'WORKFLOW_ERROR', message, { workflowId, stage });
    this.name = 'WorkflowError';
  }
}
```

- [x] 3.1.3 Save the file
- [x] 3.1.4 Run command: `npm run build`
- [x] 3.1.5 Verify no TypeScript errors

**Acceptance Criteria:**

- ✅ Error types are defined
- ✅ All errors extend ApiError
- ✅ Error codes are consistent

---

### Task 3.2: Create Centralized Error Handler ✅

**Priority:** CRITICAL  
**File:** `src/server/errorHandler.ts` (new file)

**Steps:**

- [x] 3.2.1 Create new file `src/server/errorHandler.ts`
- [x] 3.2.2 Add the following code:

```typescript
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, ValidationError, NotFoundError, DatabaseError } from '../types/errors';
import type { ApiErrorResponse } from '../types/errors';

export function errorHandler(
  error: FastifyError | ApiError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const errorResponse: ApiErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: request.id,
    },
  };

  let statusCode = 500;

  if (error instanceof ApiError) {
    statusCode = error.statusCode;
    errorResponse.error.code = error.code;
    errorResponse.error.message = error.message;
    if (error.details) {
      errorResponse.error.details = error.details;
    }

    // Log level based on status code
    if (statusCode >= 500) {
      request.log.error({ err: error, requestId: request.id }, 'Server error');
    } else if (statusCode >= 400) {
      request.log.warn({ err: error, requestId: request.id }, 'Client error');
    }
  } else if ('statusCode' in error && typeof error.statusCode === 'number') {
    // Fastify error
    statusCode = error.statusCode;
    errorResponse.error.code = error.code ?? 'FASTIFY_ERROR';
    errorResponse.error.message = error.message;
    request.log.error({ err: error, requestId: request.id }, 'Fastify error');
  } else {
    // Unknown error
    errorResponse.error.message = error.message || 'Internal server error';
    request.log.error({ err: error, requestId: request.id }, 'Unhandled error');
  }

  void reply.status(statusCode).send(errorResponse);
}
```

- [ ] 3.2.3 Save the file
- [ ] 3.2.4 Open `src/server.ts`
- [ ] 3.2.5 Add import: `import { errorHandler } from './server/errorHandler';`
- [ ] 3.2.6 Locate `app.setErrorHandler` (line 40)
- [ ] 3.2.7 Replace lines 40-44 with:

```typescript
app.setErrorHandler(errorHandler);
```

- [x] 3.2.8 Save the file
- [x] 3.2.9 Run command: `npm run build`
- [x] 3.2.10 Verify build succeeds

**Acceptance Criteria:**

- ✅ All errors use consistent format
- ✅ Request ID included in error response
- ✅ Timestamp included in error response
- ✅ Appropriate HTTP status codes used
- ✅ Added 9 comprehensive error handler tests

---

### Task 3.3: Update Repository to Throw Typed Errors ✅

**Priority:** HIGH  
**File:** `src/db/operations/workflowRunRepository.ts`

**Steps:**

- [x] 3.3.1 Open `src/db/operations/workflowRunRepository.ts`
- [x] 3.3.2 Add import: `import { NotFoundError } from '../../types/errors';`
- [x] 3.3.3 Locate method `getWorkflowRunById` (around line 49)
- [x] 3.3.4 After the query, change the null check:

```typescript
if (!row) {
  throw new NotFoundError(`Workflow run with id ${id} not found`);
}

return row;
```

- [x] 3.3.5 Update the return type from `Promise<WorkflowRun | null>` to `Promise<WorkflowRun>`
- [x] 3.3.6 Save the file
- [x] 3.3.7 Open `src/server/routes/workflow-runs.ts`
- [x] 3.3.8 Locate GET /api/workflow-runs/:id handler (line 87)
- [x] 3.3.9 Remove the null check (lines 99-101) since error is now thrown
- [x] 3.3.10 The error handler will catch NotFoundError automatically
- [x] 3.3.11 Save the file
- [x] 3.3.12 Run command: `npm test`
- [x] 3.3.13 Fix any failing tests

**Acceptance Criteria:**

- ✅ Repository throws NotFoundError instead of returning null
- ✅ Route handler doesn't need null checks
- ✅ 404 errors are handled consistently
- ✅ Also updated `updateWorkflowRun` and `transitionStage` methods

---

## 📊 Phase 4: Add Basic Observability (Week 2, Days 1-3)

### Task 4.1: Install Prometheus Client

**Priority:** CRITICAL

**Steps:**

- [ ] 4.1.1 Run command: `npm install prom-client`
- [ ] 4.1.2 Run command: `npm install --save-dev @types/prom-client` (if available)
- [ ] 4.1.3 Verify installation: check package.json has prom-client

**Acceptance Criteria:**

- prom-client is installed
- Package.json is updated

---

### Task 4.2: Create Metrics Module

**Priority:** CRITICAL  
**File:** `src/server/metrics.ts` (new file)

**Steps:**

- [ ] 4.2.1 Create new file `src/server/metrics.ts`
- [ ] 4.2.2 Add the following code:

```typescript
import promClient from 'prom-client';

// Register default metrics (memory, CPU, etc.)
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

export const hitlApprovalsTotal = new promClient.Counter({
  name: 'mcp_prompts_hitl_approvals_total',
  help: 'Total HITL approvals',
  labelNames: ['stage', 'status'] as const,
});

export const embedBatchDuration = new promClient.Histogram({
  name: 'mcp_prompts_embed_batch_duration_seconds',
  help: 'Duration of OpenAI embedding batches',
  labelNames: ['batch_size'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

export const metricsRegistry = promClient.register;
```

- [ ] 4.2.3 Save the file
- [ ] 4.2.4 Run command: `npm run build`
- [ ] 4.2.5 Verify build succeeds

**Acceptance Criteria:**

- Metrics are defined
- Registry is exported
- Default metrics are enabled

---

### Task 4.3: Add Metrics Endpoint

**Priority:** CRITICAL  
**File:** `src/server.ts`

**Steps:**

- [ ] 4.3.1 Open `src/server.ts`
- [ ] 4.3.2 Add import: `import { metricsRegistry } from './server/metrics';`
- [ ] 4.3.3 Locate health endpoint (line 63)
- [ ] 4.3.4 After the health endpoint, add:

```typescript
app.get('/metrics', async (request, reply) => {
  try {
    const metrics = await metricsRegistry.metrics();
    return reply.type('text/plain').send(metrics);
  } catch (error) {
    app.log.error({ err: error }, 'Failed to generate metrics');
    return reply.status(500).send({ error: 'Failed to generate metrics' });
  }
});
```

- [ ] 4.3.5 Save the file
- [ ] 4.3.6 Run command: `npm run build`
- [ ] 4.3.7 Start server: `npm run dev`
- [ ] 4.3.8 In another terminal, run: `curl http://localhost:3456/metrics`
- [ ] 4.3.9 Verify metrics are returned in Prometheus format
- [ ] 4.3.10 Stop the dev server (Ctrl+C)

**Acceptance Criteria:**

- /metrics endpoint returns Prometheus format metrics
- Endpoint is accessible without authentication
- Default metrics (memory, CPU) are included

---

### Task 4.4: Instrument HTTP Requests

**Priority:** HIGH  
**File:** `src/server.ts`

**Steps:**

- [ ] 4.4.1 Open `src/server.ts`
- [ ] 4.4.2 Add import: `import { httpRequestDuration, httpRequestTotal } from './server/metrics';`
- [ ] 4.4.3 After `await app.register(cors, ...)` (line 22-38), add:

```typescript
// Request instrumentation
app.addHook('onRequest', async (request) => {
  (request as any).startTime = Date.now();
});

app.addHook('onResponse', async (request, reply) => {
  const duration = (Date.now() - (request as any).startTime) / 1000;
  const route = request.routerPath || request.url;
  const labels = {
    method: request.method,
    route,
    status_code: String(reply.statusCode),
  };

  httpRequestDuration.labels(labels).observe(duration);
  httpRequestTotal.labels(labels).inc();
});
```

- [ ] 4.4.4 Save the file
- [ ] 4.4.5 Run command: `npm run build`
- [ ] 4.4.6 Verify build succeeds

**Acceptance Criteria:**

- All HTTP requests are timed
- Metrics include method, route, and status code
- Request counts are tracked

---

### Task 4.5: Enhanced Health Check

**Priority:** HIGH  
**File:** `src/server.ts`

**Steps:**

- [ ] 4.5.1 Open `src/server.ts`
- [ ] 4.5.2 Add imports:

```typescript
import { PromptEmbeddingsRepository } from './db/repository';
import { OperationsRepository } from './db/operations/repository';
```

- [ ] 4.5.3 Locate the simple health endpoint (line 63): `app.get('/health', async () => ({ status: 'ok' }));`
- [ ] 4.5.4 Replace it with:

```typescript
app.get('/health', async (request, reply) => {
  const promptRepo = new PromptEmbeddingsRepository();
  const opsRepo = config.operationsDatabaseUrl ? new OperationsRepository() : null;

  const [dbCheck, opsDbCheck] = await Promise.all([
    promptRepo.checkConnection(),
    opsRepo ? opsRepo.checkConnection() : Promise.resolve({ status: 'disabled' as const }),
  ]);

  const healthy =
    dbCheck.status === 'ok' && (opsDbCheck.status === 'ok' || opsDbCheck.status === 'disabled');

  const response = {
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbCheck,
      operationsDatabase: opsDbCheck,
    },
  };

  return reply.status(healthy ? 200 : 503).send(response);
});
```

- [ ] 4.5.5 Save the file
- [ ] 4.5.6 Run command: `npm run build`
- [ ] 4.5.7 Start server: `npm run dev`
- [ ] 4.5.8 Run: `curl http://localhost:3456/health`
- [ ] 4.5.9 Verify response includes database checks
- [ ] 4.5.10 Stop the dev server

**Acceptance Criteria:**

- Health check tests both databases
- Returns 503 if any database is down
- Returns 200 if all systems operational
- Includes timestamp in response

---

## 🔐 Phase 5: Add Rate Limiting (Week 2, Day 4)

### Task 5.1: Install Rate Limit Plugin

**Priority:** HIGH

**Steps:**

- [ ] 5.1.1 Run command: `npm install @fastify/rate-limit`
- [ ] 5.1.2 Verify installation in package.json

**Acceptance Criteria:**

- @fastify/rate-limit is installed

---

### Task 5.2: Configure Rate Limiting

**Priority:** HIGH  
**File:** `src/server.ts`

**Steps:**

- [ ] 5.2.1 Open `src/server.ts`
- [ ] 5.2.2 Add import: `import rateLimit from '@fastify/rate-limit';`
- [ ] 5.2.3 After helmet registration (line 15-18), add:

```typescript
await app.register(rateLimit, {
  max: config.http.rateLimitMax,
  timeWindow: config.http.rateLimitWindowMs,
  ban: 5, // Ban for 10 minutes after 5 violations
  cache: 10000, // Maximum number of IPs to track
});
```

- [ ] 5.2.4 Save the file
- [ ] 5.2.5 Run command: `npm run build`
- [ ] 5.2.6 Verify build succeeds

**Acceptance Criteria:**

- Rate limiting is enabled
- Configuration uses existing config values
- Ban is applied after repeated violations

---

### Task 5.3: Test Rate Limiting

**Priority:** HIGH

**Steps:**

- [ ] 5.3.1 Start server: `npm run dev`
- [ ] 5.3.2 In another terminal, run this script 110 times:

```bash
for i in {1..110}; do
  curl -s http://localhost:3456/health > /dev/null
  echo "Request $i"
done
```

- [ ] 5.3.3 Verify that after ~100 requests, you get 429 Too Many Requests
- [ ] 5.3.4 Wait 60 seconds
- [ ] 5.3.5 Try again: `curl http://localhost:3456/health`
- [ ] 5.3.6 Verify request succeeds after window expires
- [ ] 5.3.7 Stop the dev server

**Acceptance Criteria:**

- Rate limiting triggers after configured max requests
- Rate limit resets after time window
- 429 status code returned when rate limited

---

## 🔄 Phase 6: CI/CD Pipeline (Week 2, Day 5)

### Task 6.1: Create GitHub Actions Workflow

**Priority:** CRITICAL  
**File:** `.github/workflows/ci.yml` (new file)

**Steps:**

- [ ] 6.1.1 Create directory `.github/workflows`
- [ ] 6.1.2 Create file `.github/workflows/ci.yml`
- [ ] 6.1.3 Add the following code:

```yaml
name: CI

on:
  push:
    branches: [main, phase-1, develop]
  pull_request:
    branches: [main, phase-1, develop]

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest

    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run type check
        run: npx tsc --noEmit

      - name: Run tests
        run: npm test
        env:
          NODE_ENV: test
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          MCP_API_KEY: test-key

      - name: Build
        run: npm run build

  security:
    name: Security Audit
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run npm audit
        run: npm audit --production --audit-level=moderate
```

- [ ] 6.1.4 Save the file
- [ ] 6.1.5 Run command: `git add .github/workflows/ci.yml`
- [ ] 6.1.6 Run command: `git commit -m "Add CI/CD pipeline"`
- [ ] 6.1.7 Note: This will run on next push to GitHub

**Acceptance Criteria:**

- CI workflow is created
- Tests run on every push and PR
- PostgreSQL with pgvector is available
- Linting and type checking are included

---

### Task 6.2: Add Repository Secrets

**Priority:** CRITICAL

**Steps:**

- [ ] 6.2.1 Go to GitHub repository in browser
- [ ] 6.2.2 Click Settings > Secrets and variables > Actions
- [ ] 6.2.3 Click "New repository secret"
- [ ] 6.2.4 Name: `OPENAI_API_KEY`
- [ ] 6.2.5 Value: (paste your OpenAI API key)
- [ ] 6.2.6 Click "Add secret"
- [ ] 6.2.7 Verify secret appears in list

**Acceptance Criteria:**

- OPENAI_API_KEY secret is configured
- Secret is accessible to GitHub Actions

---

## 🧪 Phase 7: Improve Test Coverage (Week 3, Days 1-2)

### Task 7.1: Add Test Coverage Reporting

**Priority:** HIGH  
**File:** `package.json` and `vitest.config.ts`

**Steps:**

- [ ] 7.1.1 Run command: `npm install --save-dev @vitest/coverage-v8`
- [ ] 7.1.2 Open `package.json`
- [ ] 7.1.3 Find the "scripts" section
- [ ] 7.1.4 After the "test" script, add:

```json
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
```

- [ ] 7.1.5 Save `package.json`
- [ ] 7.1.6 Open `vitest.config.ts`
- [ ] 7.1.7 Add coverage configuration:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/**', 'dist/**', '**/*.test.ts', '**/*.config.ts', 'scripts/**'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
```

- [ ] 7.1.8 Save the file
- [ ] 7.1.9 Run command: `npm run test:coverage`
- [ ] 7.1.10 Review coverage report in terminal
- [ ] 7.1.11 Open `coverage/index.html` in browser to see detailed report

**Acceptance Criteria:**

- Coverage command works
- Coverage report is generated
- HTML report is accessible
- Thresholds are set

---

### Task 7.2: Add Error Handler Tests

**Priority:** HIGH  
**File:** `src/server/errorHandler.test.ts` (new file)

**Steps:**

- [ ] 7.2.1 Create file `src/server/errorHandler.test.ts`
- [ ] 7.2.2 Add the following test suite:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { errorHandler } from './errorHandler';
import { ApiError, NotFoundError, ValidationError, DatabaseError } from '../types/errors';

describe('errorHandler', () => {
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;

  beforeEach(() => {
    mockRequest = {
      url: '/test',
      id: 'test-request-id',
      log: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
      } as any,
    };

    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
  });

  it('should handle NotFoundError with 404 status', () => {
    const error = new NotFoundError('Resource not found');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockReply.status).toHaveBeenCalledWith(404);
    expect(mockReply.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'NOT_FOUND',
        message: 'Resource not found',
        requestId: 'test-request-id',
        path: '/test',
      }),
    });
  });

  it('should handle ValidationError with 400 status', () => {
    const error = new ValidationError('Invalid input', { field: 'email' });

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockReply.status).toHaveBeenCalledWith(400);
    expect(mockReply.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { field: 'email' },
      }),
    });
  });

  it('should handle DatabaseError with 503 status', () => {
    const error = new DatabaseError('Connection failed');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockReply.status).toHaveBeenCalledWith(503);
    expect(mockReply.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'DATABASE_ERROR',
        message: 'Connection failed',
      }),
    });
  });

  it('should handle generic Error with 500 status', () => {
    const error = new Error('Unexpected error');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockReply.status).toHaveBeenCalledWith(500);
    expect(mockReply.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'INTERNAL_ERROR',
        message: 'Unexpected error',
      }),
    });
  });

  it('should include timestamp in error response', () => {
    const error = new NotFoundError('Not found');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    const sendArg = (mockReply.send as any).mock.calls[0][0];
    expect(sendArg.error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should log server errors (5xx) as error level', () => {
    const error = new ApiError(500, 'INTERNAL_ERROR', 'Server error');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockRequest.log!.error).toHaveBeenCalled();
  });

  it('should log client errors (4xx) as warn level', () => {
    const error = new NotFoundError('Not found');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockRequest.log!.warn).toHaveBeenCalled();
  });
});
```

- [ ] 7.2.3 Save the file
- [ ] 7.2.4 Run command: `npm test errorHandler.test.ts`
- [ ] 7.2.5 Verify all tests pass

**Acceptance Criteria:**

- Error handler is fully tested
- All error types are covered
- Logging behavior is verified
- Status codes are correct

---

## 🔐 Phase 8: Security Improvements (Week 3, Days 3-4)

### Task 8.1: Add Webhook Authentication

**Priority:** HIGH  
**File:** `src/services/hitl/webhookSigner.ts` (new file)

**Steps:**

- [ ] 8.1.1 Create file `src/services/hitl/webhookSigner.ts`
- [ ] 8.1.2 Add the following code:

```typescript
import { createHmac } from 'crypto';

export function signWebhookPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expectedSignature = signWebhookPayload(payload, secret);
  return signature === expectedSignature;
}
```

- [ ] 8.1.3 Save the file
- [ ] 8.1.4 Open `src/config/index.ts`
- [ ] 8.1.5 Add to envSchema (around line 6):

```typescript
  N8N_WEBHOOK_SECRET: z.string().optional(),
```

- [ ] 8.1.6 Save the file
- [ ] 8.1.7 Open `src/services/hitl/HITLService.ts`
- [ ] 8.1.8 Add import: `import { signWebhookPayload } from './webhookSigner';`
- [ ] 8.1.9 Add import: `import { config } from '../../config';`
- [ ] 8.1.10 Locate the `resumeWorkflow` method (around line 253)
- [ ] 8.1.11 Before the fetch call, add:

```typescript
const body = JSON.stringify(data);
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
};

if (config.N8N_WEBHOOK_SECRET) {
  headers['X-Webhook-Signature'] = signWebhookPayload(body, config.N8N_WEBHOOK_SECRET);
}
```

- [ ] 8.1.12 Update the fetch call to use the variables:

```typescript
const response = await fetch(`${n8nWebhookBase}/hitl/resume/${workflowRunId}`, {
  method: 'POST',
  headers,
  body,
});
```

- [ ] 8.1.13 Save the file
- [ ] 8.1.14 Run command: `npm run build`
- [ ] 8.1.15 Verify build succeeds

**Acceptance Criteria:**

- Webhook payloads are signed with HMAC-SHA256
- Signature is sent in X-Webhook-Signature header
- Signing is optional (works without secret)

---

### Task 8.2: Add Input Validation for JSONB Fields

**Priority:** MEDIUM  
**File:** `src/server/routes/api.ts`

**Steps:**

- [ ] 8.2.1 Open `src/server/routes/api.ts`
- [ ] 8.2.2 Add a JSONB validation schema:

```typescript
const safeJsonbSchema = z.record(z.unknown()).refine((obj) => {
  try {
    const str = JSON.stringify(obj);
    return str.length < 100000; // 100KB limit
  } catch {
    return false;
  }
}, 'JSONB field too large (max 100KB)');
```

- [ ] 8.2.3 Locate the `conversationStoreSchema` (around line 149)
- [ ] 8.2.4 Update metadata and summary fields:

```typescript
  summary: safeJsonbSchema.optional().nullable(),
  metadata: safeJsonbSchema.optional(),
```

- [ ] 8.2.5 Locate the `videoUpdateSchema` (around line 110)
- [ ] 8.2.6 Update metadata field:

```typescript
  metadata: safeJsonbSchema.optional(),
```

- [ ] 8.2.7 Save the file
- [ ] 8.2.8 Run command: `npm run build`
- [ ] 8.2.9 Verify build succeeds

**Acceptance Criteria:**

- JSONB fields have size limits
- Large payloads are rejected with validation error
- 100KB limit prevents abuse

---

### Task 8.3: Add Security Headers

**Priority:** MEDIUM  
**File:** `src/server.ts`

**Steps:**

- [ ] 8.3.1 Open `src/server.ts`
- [ ] 8.3.2 Locate helmet configuration (lines 15-18)
- [ ] 8.3.3 Update with more security headers:

```typescript
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});
```

- [ ] 8.3.4 Save the file
- [ ] 8.3.5 Run command: `npm run build`
- [ ] 8.3.6 Verify build succeeds

**Acceptance Criteria:**

- CSP headers are set
- HSTS is enabled
- Security headers protect against common attacks

---

## 📚 Phase 9: API Documentation (Week 3, Day 5)

### Task 9.1: Install OpenAPI Tools

**Priority:** MEDIUM

**Steps:**

- [ ] 9.1.1 Run command: `npm install --save-dev @fastify/swagger @fastify/swagger-ui`
- [ ] 9.1.2 Verify installation in package.json

**Acceptance Criteria:**

- Swagger packages are installed

---

### Task 9.2: Configure Swagger

**Priority:** MEDIUM  
**File:** `src/server.ts`

**Steps:**

- [ ] 9.2.1 Open `src/server.ts`
- [ ] 9.2.2 Add imports:

```typescript
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
```

- [ ] 9.2.3 After helmet registration (line 15-18), add:

```typescript
if (!config.isProduction) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'MCP Prompts API',
        description: 'RAG-based prompt management with HITL workflows',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://${config.SERVER_HOST}:${config.SERVER_PORT}`,
          description: 'Development server',
        },
      ],
      tags: [
        { name: 'workflows', description: 'Workflow run management' },
        { name: 'hitl', description: 'Human-in-the-loop approvals' },
        { name: 'prompts', description: 'Prompt search and retrieval' },
        { name: 'videos', description: 'Video generation and tracking' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });
}
```

- [ ] 9.2.4 Save the file
- [ ] 9.2.5 Run command: `npm run build`
- [ ] 9.2.6 Start server: `npm run dev`
- [ ] 9.2.7 Open browser to `http://localhost:3456/docs`
- [ ] 9.2.8 Verify Swagger UI loads
- [ ] 9.2.9 Stop the dev server

**Acceptance Criteria:**

- Swagger UI is accessible at /docs
- API documentation is auto-generated
- Only available in non-production environments

---

### Task 9.3: Add OpenAPI Schema to Routes

**Priority:** LOW  
**File:** `src/server/routes/workflow-runs.ts`

**Steps:**

- [ ] 9.3.1 Open `src/server/routes/workflow-runs.ts`
- [ ] 9.3.2 Update the GET /api/workflow-runs route to include schema:

```typescript
app.get(
  '/api/workflow-runs',
  {
    schema: {
      tags: ['workflows'],
      description: 'List workflow runs with optional filters',
      querystring: {
        type: 'object',
        properties: {
          status: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by status',
          },
          projectId: { type: 'string', description: 'Filter by project ID' },
          sessionId: { type: 'string', description: 'Filter by session ID' },
        },
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'object',
          properties: {
            workflowRuns: { type: 'array' },
          },
        },
      },
    },
  },
  async (request, reply) => {
    // ... existing code
  },
);
```

- [ ] 9.3.3 Save the file
- [ ] 9.3.4 Run command: `npm run build`
- [ ] 9.3.5 Note: Add schemas to other routes as time permits

**Acceptance Criteria:**

- Route appears in Swagger UI
- Parameters are documented
- Response schema is defined

---

## 🔄 Phase 10: HITL Integration (Week 4)

### Task 10.1: Verify NotificationService Implementation

**Priority:** HIGH  
**File:** `src/services/hitl/NotificationService.ts`

**Steps:**

- [ ] 10.1.1 Open `src/services/hitl/NotificationService.ts`
- [ ] 10.1.2 Verify the file exists and contains complete implementation
- [ ] 10.1.3 Verify `notify()` method exists
- [ ] 10.1.4 Verify `notifySlack()` method exists
- [ ] 10.1.5 If methods are missing, the file needs implementation - escalate
- [ ] 10.1.6 Add environment variable to `.env` file:

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

- [ ] 10.1.7 Save `.env`

**Acceptance Criteria:**

- NotificationService has all methods implemented
- Slack webhook URL is configured
- Service can be instantiated without errors

---

### Task 10.2: Test HITL Flow End-to-End

**Priority:** HIGH

**Steps:**

- [ ] 10.2.1 Start the server: `npm run dev`
- [ ] 10.2.2 Create a test workflow run:

```bash
curl -X POST http://localhost:3456/api/workflow-runs \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "aismr",
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "input": {"test": true}
  }'
```

- [ ] 10.2.3 Save the returned `workflowRun.id`
- [ ] 10.2.4 Request HITL approval:

```bash
curl -X POST http://localhost:3456/api/hitl/request-approval \
  -H "Content-Type: application/json" \
  -d '{
    "workflowRunId": "YOUR_WORKFLOW_RUN_ID",
    "stage": "idea_generation",
    "content": {"ideas": ["Idea 1", "Idea 2"]},
    "notifyChannels": ["slack"]
  }'
```

- [ ] 10.2.5 Save the returned `approval.id`
- [ ] 10.2.6 Check Slack for notification (if configured)
- [ ] 10.2.7 List pending approvals:

```bash
curl http://localhost:3456/api/hitl/approvals?status=pending
```

- [ ] 10.2.8 Approve the request:

```bash
curl -X POST http://localhost:3456/api/hitl/approve/YOUR_APPROVAL_ID \
  -H "Content-Type: application/json" \
  -d '{
    "reviewedBy": "test-user",
    "feedback": "Looks good"
  }'
```

- [ ] 10.2.9 Verify approval succeeds
- [ ] 10.2.10 Stop the dev server

**Acceptance Criteria:**

- Workflow run is created
- HITL approval is requested
- Notification is sent (or logged if Slack not configured)
- Approval can be granted
- Workflow status is updated

---

### Task 10.3: Create HITL Integration Tests

**Priority:** MEDIUM  
**File:** `src/test/integration/hitl-flow.test.ts` (new file)

**Steps:**

- [ ] 10.3.1 Create directory `src/test/integration` if it doesn't exist
- [ ] 10.3.2 Create file `src/test/integration/hitl-flow.test.ts`
- [ ] 10.3.3 Add the following test:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../server';

describe('HITL Integration Flow', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createServer();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should complete full HITL approval flow', async () => {
    // 1. Create workflow run
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/workflow-runs',
      payload: {
        projectId: 'aismr',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        input: { test: true },
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const { workflowRun } = JSON.parse(createResponse.body);
    const workflowRunId = workflowRun.id;

    // 2. Request approval
    const approvalResponse = await app.inject({
      method: 'POST',
      url: '/api/hitl/request-approval',
      payload: {
        workflowRunId,
        stage: 'idea_generation',
        content: { ideas: ['Idea 1', 'Idea 2'] },
        notifyChannels: ['slack'],
      },
    });

    expect(approvalResponse.statusCode).toBe(201);
    const { approval } = JSON.parse(approvalResponse.body);
    expect(approval.status).toBe('pending');

    // 3. List pending approvals
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/hitl/approvals?status=pending',
    });

    expect(listResponse.statusCode).toBe(200);
    const { approvals } = JSON.parse(listResponse.body);
    expect(approvals).toContainEqual(expect.objectContaining({ id: approval.id }));

    // 4. Approve
    const approveResponse = await app.inject({
      method: 'POST',
      url: `/api/hitl/approve/${approval.id}`,
      payload: {
        reviewedBy: 'test-user',
        feedback: 'Approved in test',
      },
    });

    expect(approveResponse.statusCode).toBe(200);

    // 5. Verify approval status
    const getApprovalResponse = await app.inject({
      method: 'GET',
      url: `/api/hitl/approvals/${approval.id}`,
    });

    expect(getApprovalResponse.statusCode).toBe(200);
    const { approval: updatedApproval } = JSON.parse(getApprovalResponse.body);
    expect(updatedApproval.status).toBe('approved');
    expect(updatedApproval.reviewedBy).toBe('test-user');
  });

  it('should handle rejection flow', async () => {
    // 1. Create workflow run
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/workflow-runs',
      payload: {
        projectId: 'aismr',
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        input: { test: true },
      },
    });

    const { workflowRun } = JSON.parse(createResponse.body);

    // 2. Request approval
    const approvalResponse = await app.inject({
      method: 'POST',
      url: '/api/hitl/request-approval',
      payload: {
        workflowRunId: workflowRun.id,
        stage: 'idea_generation',
        content: { ideas: ['Bad idea'] },
      },
    });

    const { approval } = JSON.parse(approvalResponse.body);

    // 3. Reject
    const rejectResponse = await app.inject({
      method: 'POST',
      url: `/api/hitl/reject/${approval.id}`,
      payload: {
        reviewedBy: 'test-user',
        feedback: 'Ideas not good enough',
      },
    });

    expect(rejectResponse.statusCode).toBe(200);

    // 4. Verify rejection
    const getApprovalResponse = await app.inject({
      method: 'GET',
      url: `/api/hitl/approvals/${approval.id}`,
    });

    const { approval: updatedApproval } = JSON.parse(getApprovalResponse.body);
    expect(updatedApproval.status).toBe('rejected');
  });
});
```

- [ ] 10.3.4 Save the file
- [ ] 10.3.5 Run command: `npm test hitl-flow.test.ts`
- [ ] 10.3.6 Verify tests pass

**Acceptance Criteria:**

- Integration tests cover full HITL flow
- Approval flow is tested
- Rejection flow is tested
- Tests can run in CI

---

## 🚀 Phase 11: Final Cleanup and Documentation (Week 4, Final Days)

### Task 11.1: Update README with New Features

**Priority:** MEDIUM  
**File:** `README.md`

**Steps:**

- [ ] 11.1.1 Open `README.md`
- [ ] 11.1.2 Add a section about new features:

```markdown
## Recent Updates

### Observability

- Prometheus metrics endpoint at `/metrics`
- Enhanced health check at `/health`
- Request duration and count tracking
- Database query instrumentation

### Security

- Rate limiting (configurable)
- Webhook HMAC signing
- Enhanced security headers
- JSONB field validation

### API Documentation

- Swagger UI available at `/docs` (dev only)
- OpenAPI 3.0 schema
- Interactive API exploration

### HITL (Human-in-the-Loop)

- Request approval workflow
- Slack notifications
- Approval/rejection tracking
- Workflow state management
```

- [ ] 11.1.3 Add environment variables section:

```markdown
## Environment Variables

### Required

- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - OpenAI API key

### Optional

- `OPERATIONS_DATABASE_URL` - Separate DB for operations
- `N8N_WEBHOOK_SECRET` - Secret for webhook signing
- `SLACK_WEBHOOK_URL` - Slack incoming webhook URL
- `HTTP_RATE_LIMIT_MAX` - Max requests per window (default: 100)
- `HTTP_RATE_LIMIT_WINDOW_MS` - Rate limit window in ms (default: 60000)
```

- [ ] 11.1.4 Save the file

**Acceptance Criteria:**

- README documents new features
- Environment variables are documented
- Setup instructions are clear

---

### Task 11.2: Create Runbook

**Priority:** LOW  
**File:** `docs/RUNBOOK.md` (new file)

**Steps:**

- [ ] 11.2.1 Create file `docs/RUNBOOK.md`
- [ ] 11.2.2 Add the following content:

````markdown
# MCP Prompts Runbook

## Operational Procedures

### Health Checks

Check system health:

```bash
curl http://localhost:3456/health
```
````

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2025-11-02T12:00:00.000Z",
  "checks": {
    "database": { "status": "ok" },
    "operationsDatabase": { "status": "ok" }
  }
}
```

### Metrics

View Prometheus metrics:

```bash
curl http://localhost:3456/metrics
```

Key metrics to monitor:

- `mcp_prompts_http_request_duration_seconds` - Request latency
- `mcp_prompts_http_requests_total` - Request count
- `mcp_prompts_db_query_duration_seconds` - Database performance
- `mcp_prompts_hitl_approvals_total` - HITL activity

### Common Issues

#### Database Connection Failure

**Symptoms:** `/health` returns 503, database checks fail

**Solution:**

1. Check DATABASE_URL is correct
2. Verify PostgreSQL is running
3. Check network connectivity
4. Review database logs

#### Rate Limiting

**Symptoms:** Requests return 429 Too Many Requests

**Solution:**

1. Increase `HTTP_RATE_LIMIT_MAX` in environment
2. Increase `HTTP_RATE_LIMIT_WINDOW_MS` for longer window
3. Implement API key per-user rate limits

#### Pending Migrations

**Symptoms:** Server exits on startup with "Pending migrations detected"

**Solution:**

```bash
npm run db:migrate
npm run db:operations:migrate
```

#### HITL Webhook Failures

**Symptoms:** Approvals created but workflows don't resume

**Solution:**

1. Check n8n webhook endpoint is accessible
2. Verify N8N_WEBHOOK_SECRET matches on both ends
3. Review n8n workflow wait node configuration
4. Check server logs for webhook errors

### Deployment Checklist

- [ ] Run database migrations
- [ ] Set all required environment variables
- [ ] Run tests: `npm test`
- [ ] Build: `npm run build`
- [ ] Check health endpoint after deploy
- [ ] Verify metrics endpoint accessible
- [ ] Test HITL flow with one workflow
- [ ] Monitor error rates for 1 hour

### Rollback Procedure

If deployment fails:

1. Revert to previous git commit
2. Rollback database migrations if needed
3. Restart application
4. Verify health check passes
5. Investigate failure in staging environment

````
- [ ] 11.2.3 Save the file

**Acceptance Criteria:**
- Runbook documents common operations
- Troubleshooting guide included
- Deployment checklist provided

---

### Task 11.3: Run Full Test Suite

**Priority:** HIGH

**Steps:**
- [ ] 11.3.1 Run command: `npm run lint`
- [ ] 11.3.2 Verify no linting errors
- [ ] 11.3.3 Run command: `npm run build`
- [ ] 11.3.4 Verify build succeeds with no errors
- [ ] 11.3.5 Run command: `npm test`
- [ ] 11.3.6 Verify all tests pass
- [ ] 11.3.7 Run command: `npm run test:coverage`
- [ ] 11.3.8 Verify coverage meets thresholds (70%)
- [ ] 11.3.9 Review coverage report
- [ ] 11.3.10 If any tests fail, debug and fix before proceeding

**Acceptance Criteria:**
- No linting errors
- Build succeeds
- All tests pass
- Coverage meets minimum thresholds

---

### Task 11.4: Git Commit and Push

**Priority:** HIGH

**Steps:**
- [ ] 11.4.1 Run command: `git status`
- [ ] 11.4.2 Review all changed files
- [ ] 11.4.3 Run command: `git add -A`
- [ ] 11.4.4 Run command: `git commit -m "feat: implement code review remediation

- Fix listWorkflowRuns undefined where clause bug
- Fix PATCH workflow-runs 404 error handling
- Add comprehensive API tests
- Standardize error handling with typed errors
- Add Prometheus metrics and observability
- Implement rate limiting
- Add CI/CD pipeline with GitHub Actions
- Enhance health checks
- Add webhook HMAC authentication
- Add API documentation with Swagger
- Complete HITL integration testing
- Update documentation and runbook

Addresses issues from REVIEW-CODEX.md and review-claude.md"`
- [ ] 11.4.5 Run command: `git push origin phase-1`
- [ ] 11.4.6 Wait for CI to run on GitHub
- [ ] 11.4.7 Check GitHub Actions tab
- [ ] 11.4.8 Verify CI passes
- [ ] 11.4.9 If CI fails, review logs and fix issues

**Acceptance Criteria:**
- All changes are committed
- Commit message is descriptive
- Code is pushed to remote
- CI pipeline passes

---

## 📊 Completion Checklist

### Critical Fixes ✅
- [ ] listWorkflowRuns undefined bug fixed
- [ ] PATCH workflow-runs 404 handling fixed
- [ ] Workflow run API tests added
- [ ] Pending migrations applied
- [ ] Migration check on startup added

### Error Handling ✅
- [ ] Standard error types created
- [ ] Centralized error handler implemented
- [ ] Repository throws typed errors
- [ ] Error handler tests added

### Observability ✅
- [ ] Prometheus client installed
- [ ] Metrics module created
- [ ] /metrics endpoint added
- [ ] HTTP requests instrumented
- [ ] Enhanced health check implemented

### Security ✅
- [ ] Rate limiting installed and configured
- [ ] Webhook authentication added
- [ ] JSONB field validation added
- [ ] Security headers enhanced

### CI/CD ✅
- [ ] GitHub Actions workflow created
- [ ] Repository secrets configured
- [ ] CI runs on push and PR

### Testing ✅
- [ ] Test coverage reporting added
- [ ] Error handler tests added
- [ ] HITL integration tests added

### Documentation ✅
- [ ] API documentation with Swagger added
- [ ] README updated
- [ ] Runbook created

### HITL Integration ✅
- [ ] NotificationService verified
- [ ] HITL flow tested end-to-end
- [ ] Integration tests created

### Final Steps ✅
- [ ] Full test suite runs successfully
- [ ] Code committed and pushed
- [ ] CI pipeline passes

---

## 🎯 Success Criteria

Upon completion of all tasks:

1. **Code Quality**
   - All tests pass
   - No linting errors
   - 70%+ code coverage
   - TypeScript builds without errors

2. **Functionality**
   - HITL flow works end-to-end
   - API is fully documented
   - Health checks include database status
   - Metrics are collected and exposed

3. **Security**
   - Rate limiting protects against abuse
   - Webhooks are authenticated
   - Input validation prevents oversized payloads
   - Security headers are properly configured

4. **Operations**
   - CI/CD pipeline runs on every push
   - Runbook documents common operations
   - Migration check prevents bad deployments
   - Monitoring is in place

5. **Documentation**
   - README explains new features
   - API documentation is auto-generated
   - Environment variables are documented
   - Troubleshooting guide exists

---

## 📝 Notes for AI Agents

### When Tasks Fail

1. **Read error messages carefully** - They usually tell you exactly what's wrong
2. **Check file paths** - Ensure you're editing the correct file
3. **Verify imports** - Make sure all imports are correct
4. **Run build after changes** - Always verify TypeScript compiles
5. **Test incrementally** - Don't wait until the end to test

### Common Pitfalls

- **Don't skip tasks** - Each task builds on previous ones
- **Don't modify unrelated code** - Stay focused on the task
- **Don't commit without testing** - Always run tests before committing
- **Don't ignore TypeScript errors** - Fix them immediately

### Getting Help

If stuck on a task:
1. Re-read the task instructions
2. Check the acceptance criteria
3. Look at similar code in the codebase
4. Review the error message for clues
5. Escalate if truly blocked

---

## Phase Review

### Phases 1-3 Implementation Summary

**Completion Date:** November 2, 2025
**Implementation Approach:** Consolidated typed error strategy
**Test Results:** 19/19 tests passing

#### What Was Implemented

**Phase 1: Critical Bug Fixes**
- ✅ Fixed `listWorkflowRuns` undefined bug (conditional where clause)
- ✅ Added comprehensive workflow-runs API tests (10 tests)
- ✅ Added GET /api/workflow-runs route (bonus - not in original plan)
- ⚠️ Task 1.2 superseded by Phase 3 typed error approach

**Phase 2: Migrations**
- ✅ Verified HITL migration files exist and committed
- ✅ Created `checkPendingMigrations()` function
- ✅ Integrated migration check into server startup
- ✅ Skips check in test environment

**Phase 3: Error Handling**
- ✅ Created 5 typed error classes (ApiError, NotFoundError, ValidationError, DatabaseError, WorkflowError)
- ✅ Implemented centralized error handler with consistent response format
- ✅ Updated repository to throw NotFoundError instead of returning null
- ✅ Updated route handlers to remove null checks
- ✅ Added 9 comprehensive error handler tests

#### Improvements Over Original Plan

1. **Better Error Approach**: Skipped null-return pattern (Task 1.2) and went directly to typed errors, avoiding rework
2. **Enhanced Test Coverage**: 10 workflow tests (vs planned 4) and 9 error handler tests
3. **Additional Route**: Implemented GET /api/workflow-runs for listing (missing from routes)
4. **Consistent Error Format**: All errors include requestId, timestamp, path, and proper HTTP status codes

#### Files Created
- `src/types/errors.ts` - Typed error classes
- `src/server/errorHandler.ts` - Centralized error handler
- `src/server/errorHandler.test.ts` - Error handler tests (9 tests)
- `src/server/routes/workflow-runs.test.ts` - Route tests (10 tests)
- `src/db/migrations.ts` - Migration check utility

#### Files Modified
- `src/db/operations/workflowRunRepository.ts` - Conditional where clause + typed errors
- `src/server/routes/workflow-runs.ts` - Removed null checks + added GET route
- `src/server.ts` - Integrated error handler + migration check

### Recommendations for Next Phases

#### Phase 4: Observability (HIGH PRIORITY)

The current implementation lacks monitoring. Before proceeding to Phase 4:

1. **Install prom-client** - Already in config but not implemented
2. **Key Metrics to Track**:
   - HTTP request duration/count (by route, method, status)
   - Database query duration
   - Vector search duration
   - HITL approval counts
   - Error rates by type

3. **Enhanced Health Check** - Should test both databases and return structured response

#### Phase 5: HITL Integration (BLOCKED - NEEDS ATTENTION)

NotificationService implementation is incomplete. Before Phase 10:

1. **Verify NotificationService** - File exists but may need Slack integration
2. **Test HITL Flow** - End-to-end with actual n8n webhooks
3. **Add Webhook Signature** - Security enhancement from Phase 8

#### Consolidation Opportunities

**Error Handler Duplication**
Multiple `sendError()` functions exist across route files:
- `src/server/routes/api.ts`
- `src/server/routes/hitl.ts`
- `src/server/routes/workflow-runs.ts`

**Recommendation**: Create shared error utilities or use centralized handler everywhere

**Test Setup Patterns**
Similar mock setup code in:
- `src/server/routes/hitl.test.ts`
- `src/server/routes/workflow-runs.test.ts`

**Recommendation**: Create shared test utilities for Fastify app setup

### Technical Debt Identified

1. **Pre-existing TypeScript errors** - In `src/db/operations/schema.test.ts` (unrelated to our changes)
2. **Missing GET route** - Now implemented, but indicates gaps in API documentation
3. **OPERATIONS_DATABASE_URL** - Required for migrations but may not be configured in all environments

### Next Steps Priority Order

1. ✅ **Phases 1-3 Complete** - Error handling foundation is solid
2. 🔴 **Phase 4 (Observability)** - CRITICAL before production
3. 🟡 **Phase 5 (Rate Limiting)** - HIGH - Already configured, just needs registration
4. 🟡 **Phase 6 (CI/CD)** - HIGH - Automate testing and prevent regressions
5. 🟢 **Phase 7-9** - Can proceed in parallel with Phase 10 HITL work

---

**End of Plan**

Total Tasks: 55 (3 phases completed: ~11 tasks)
Estimated Time: 3-4 weeks
Priority: CRITICAL fixes first, then HIGH, then MEDIUM/LOW

---

## Tools Documentation

All MCP tools are documented with YAML specifications in [`docs/tool-specs/`](./tool-specs/). See the [Tool Specs README](./tool-specs/README.md) for:

- Complete list of available tools
- How to add new tool specs
- How to update existing specs
- Validation and maintenance guidelines

Tool specifications follow the schema defined in [`docs/tool-description.schema.json`](./tool-description.schema.json) and can be validated using:

```bash
npm run validate:tool-specs
````

```

```
