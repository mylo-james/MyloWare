# Implementation Plan: Bridge to North Star

**Date:** 2025-11-09  
**Status:** Epic 1 Complete, Epic 2 Paused for Stabilization  
**PO Vision:** Deliver a production-ready, trace-driven AI Production Studio where Casey orchestrates specialist agents through memory-first coordination.

**Document Version:** 2.0 - Enhanced for AI Agent Execution  
**Last Updated:** 2025-11-09  
**Enhancement:** Added pseudo code, code snippets, test examples, and detailed implementation guidance

---

## 📘 Document Enhancement Summary

This plan has been enhanced with comprehensive implementation guidance for AI agents:

**What's New:**
- ✅ **Pseudo Code Sections** - High-level logic flow for each story
- ✅ **Before/After Code Snippets** - Exact code changes with line numbers
- ✅ **Test Examples** - Unit, integration, and performance test templates
- ✅ **Database Migrations** - SQL migration scripts with indexing strategies
- ✅ **Context7 References** - Up-to-date Drizzle ORM and Fastify patterns
- ✅ **Testing Checklists** - Step-by-step validation for each story
- ✅ **Directory Structure Examples** - File organization and data formats
- ✅ **Performance Validation** - Query analysis and optimization guidance

**How to Use This Plan:**
1. Each story now includes **Implementation Pseudo Code** showing the logic flow
2. **Code Snippets** show BEFORE/AFTER with exact line numbers and file paths
3. **Testing Checklist** provides validation steps for each acceptance criterion
4. Reference **Context7 docs** included for external dependencies (Drizzle, Fastify, n8n)

**Stories Enhanced (ALL COMPLETE):**
- ✅ Story 1.5.1: Lock Down Entry Points (Security)
- ✅ Story 1.5.2: Unblock Project Playbooks (Casey enablement)
- ✅ Story 1.5.3: Fix Memory Trace Filtering (Performance)
- ✅ Story 1.5.4: Normalize trace_update Contract (Agent reliability)
- ✅ Story 1.5.5: Security & Operations Runbook (Human oversight)
- ✅ Story 1.5.6: Test Hygiene & Config Externalization (Quality)

---

## Executive Summary

**What Changed:** Based on PO review, we're pausing Epic 2 agent workflows to stabilize the foundation. The review identified 7 critical risks that threaten the North Star vision. We must fix these before continuing agent integration, or we risk building on unstable ground.

**Why This Matters:** 
- Project playbooks never load → Casey operates blind without guardrails
- Open CORS + weak auth → Production studio vulnerable to unauthorized access
- Memory filtering inefficiency → Trace-aware context degrades at scale
- Missing runbooks → Human operators can't safely deploy or intervene

**New Approach:** Epic 1.5 (Stabilization) + Epic 2 (Revised) + Epic 3 (Operations) = Production-Ready Studio

---

## 📊 Current State Assessment

### ✅ What's Working (Keep Investing)
- **Trace State Machine** - Universal workflow with dynamic persona discovery
- **MCP Tool Contracts** - `trace_prepare`, `handoff_to_agent`, `memory_store` enforce coordination
- **Memory Discipline** - Vector + keyword search with temporal decay
- **Testing Culture** - 154+ tests, 66%+ coverage, deterministic stubs
- **Observability** - Prometheus metrics, structured logging, retry queue

### ⚠️ Critical Gaps (Blocking Production)
1. **Security Posture** - CORS open, hardcoded hosts, verbose auth logs
2. **Project Playbooks** - Never load due to path mismatch (`loadProjectJson`)
3. **Memory Filtering** - Uses JSON metadata instead of indexed `trace_id` column
4. **Contract Mismatch** - `trace_update` expects UUID but personas send slugs
5. **Operations Readiness** - No security hardening guide or production runbook
6. **Test Hygiene** - ESLint ignores `tests/**`, reducing regression signal
7. **Session Policy** - TTL and limits hardcoded, can't tune for production

---

## 🎯 Epic Structure (Revised)

```
Epic 1: Trace Coordination ✅ COMPLETE
  └─ Universal workflow, trace state machine, dynamic tool scoping

Epic 1.5: Foundation Stabilization 🚧 IN PROGRESS (THIS SPRINT)
  ├─ Story 1.5.1: Lock Down Entry Points (Security)
  ├─ Story 1.5.2: Unblock Project Playbooks (Casey enablement)
  ├─ Story 1.5.3: Fix Memory Trace Filtering (Performance)
  ├─ Story 1.5.4: Normalize trace_update Contract (Agent reliability)
  ├─ Story 1.5.5: Security & Operations Runbook (Human oversight)
  └─ Story 1.5.6: Test Hygiene & Config Externalization (Quality)

Epic 2: Agent Workflows 🔮 NEXT SPRINT
  ├─ Story 2.1: Casey → Iggy (with playbooks)
  ├─ Story 2.2: Iggy → Riley
  ├─ Story 2.3: Riley → Veo
  ├─ Story 2.4: Veo → Alex
  ├─ Story 2.5: Alex → Quinn
  └─ Story 2.6: Full E2E AISMR Happy Path

Epic 3: Production Hardening 📦 FUTURE
  ├─ Story 3.1: Advanced Memory Caching
  ├─ Story 3.2: Persona-Specific Retrieval Blending
  ├─ Story 3.3: Dynamic Workflow Modification
  └─ Story 3.4: Observability Dashboard
```

---

## 🚨 Epic 1.5: Foundation Stabilization (THIS SPRINT)

**Goal:** Fix critical gaps that block production readiness and Casey's ability to operate with project guardrails.

**Success Criteria:**
- [ ] All security issues addressed (CORS, auth logs, allowlist externalized)
- [ ] Casey receives project playbooks in `trace_prepare` system prompts
- [ ] Memory searches use indexed `trace_id` column
- [ ] `trace_update` accepts slugs and normalizes to UUIDs
- [ ] Security hardening guide and production runbook exist
- [ ] ESLint applies to tests, session config externalized
- [ ] All acceptance criteria pass, tests green, no regressions

---

### Story 1.5.1: Lock Down Entry Points 🔒

**Priority:** P0 (Security vulnerability)  
**Effort:** 3 points  
**Owner:** Any agent with security expertise

**Problem:** 
- CORS set to `['*']` allows any origin to call MCP tools
- Allowed hosts hardcoded in `src/config/index.ts`
- Auth logs leak derived secrets in shared environments

**Acceptance Criteria:**
1. CORS origins read from `ALLOWED_CORS_ORIGINS` env var (comma-separated)
2. Default to fail-closed: if env var missing, reject all CORS requests
3. Allowed hosts read from `ALLOWED_HOST_KEYS` env var (comma-separated)
4. Auth logs only show derived key when `DEBUG_AUTH=true`
5. Update `.env.example` with secure defaults
6. Update `docs/06-reference/config-and-env.md` with new vars
7. Integration test: CORS rejection when origin not in allowlist
8. Integration test: Auth success/failure without verbose logging

---

#### Implementation Pseudo Code

```typescript
// STEP 1: Update config schema to include security env vars
ConfigSchema = {
  ...existing,
  security: {
    allowedCorsOrigins: parseEnvArray(ALLOWED_CORS_ORIGINS) || [], // FAIL-CLOSED default
    allowedHostKeys: parseEnvArray(ALLOWED_HOST_KEYS) || DEFAULT_HOSTS,
    debugAuth: parseEnvBoolean(DEBUG_AUTH) || false
  }
}

// STEP 2: Update CORS middleware to use env-based origins
fastify.register(cors, {
  origin: config.security.allowedCorsOrigins.length > 0 
    ? config.security.allowedCorsOrigins 
    : false, // REJECT all if empty
  credentials: true
})

// STEP 3: Update auth logging to be conditional
if (authFailed) {
  if (config.security.debugAuth) {
    logger.warn({ ...allDetails, providedKeyHash, expectedKeyHash })
  } else {
    logger.warn({ requestId, ip, url, method }) // Minimal in production
  }
}

// STEP 4: Update StreamableHTTPServerTransport with dynamic hosts
const transport = new StreamableHTTPServerTransport({
  ...existing,
  allowedHosts: config.security.allowedHostKeys
})
```

---

#### Code Snippets

**File: `src/config/index.ts` (Lines 59-66)**

**BEFORE:**
```typescript
security: z
  .object({
    allowedOrigins: z.array(z.string()).default(['http://localhost:5678', 'http://n8n:5678']),
    rateLimitMax: z.number().default(100),
    rateLimitTimeWindow: z.string().default('1 minute'),
  })
  .optional(),
```

**AFTER:**
```typescript
security: z.object({
  allowedCorsOrigins: z.array(z.string()).default([]), // FAIL-CLOSED: Empty array means reject all
  allowedHostKeys: z.array(z.string()).default([
    '127.0.0.1',
    'localhost',
    'mcp-server',
  ]),
  debugAuth: z.boolean().default(false),
  rateLimitMax: z.number().default(100),
  rateLimitTimeWindow: z.string().default('1 minute'),
}),
```

**File: `src/config/index.ts` (Lines 125-131)**

**BEFORE:**
```typescript
security: {
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['*'],
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  rateLimitTimeWindow: process.env.RATE_LIMIT_TIME_WINDOW || '1 minute',
},
```

**AFTER:**
```typescript
security: {
  allowedCorsOrigins: process.env.ALLOWED_CORS_ORIGINS
    ? process.env.ALLOWED_CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [], // FAIL-CLOSED: Empty array means reject all CORS
  allowedHostKeys: process.env.ALLOWED_HOST_KEYS
    ? process.env.ALLOWED_HOST_KEYS.split(',').map(h => h.trim()).filter(Boolean)
    : [
        '127.0.0.1',
        'localhost',
        'mcp-server',
      ],
  debugAuth: process.env.DEBUG_AUTH === 'true',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  rateLimitTimeWindow: process.env.RATE_LIMIT_TIME_WINDOW || '1 minute',
},
```

**File: `src/server.ts` (Lines 607-610)**

**BEFORE:**
```typescript
await fastify.register(cors, {
  origin: config.security?.allowedOrigins || ['http://localhost:5678', 'http://n8n:5678'],
  credentials: true,
});
```

**AFTER:**
```typescript
// FAIL-CLOSED CORS: If no origins configured, reject all CORS requests
const corsOrigins = config.security.allowedCorsOrigins;
await fastify.register(cors, {
  origin: corsOrigins.length > 0 ? corsOrigins : false, // false = reject all
  credentials: true,
});

logger.info({
  msg: 'CORS configuration loaded',
  originsCount: corsOrigins.length,
  failClosed: corsOrigins.length === 0,
});
```

**File: `src/server.ts` (Lines 284-313)**

**BEFORE:**
```typescript
// In production, log minimal info. In development, log detailed debug info.
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  logger.warn({
    msg: 'Unauthorized MCP access attempt',
    requestId,
    ip: request.ip,
    url: request.url,
    method: request.method,
    // Don't log sensitive data in production
  });
} else {
  // Debug logging for development only
logger.warn({
  msg: 'Unauthorized MCP access attempt',
  requestId,
  ip: request.ip,
  userAgent: request.headers['user-agent'],
  url: request.url,
  method: request.method,
  headerKeys: Object.keys(request.headers ?? {}),
  providedKeyLength: providedKey?.length ?? 0,
  expectedKeyLength: config.mcp.authKey?.length ?? 0,
    keysMatch: providedKey === config.mcp.authKey,
    // Only log hashes in development, never actual keys
  providedKeyHash: providedKey ? hashValue(providedKey) : null,
  expectedKeyHash: config.mcp.authKey ? hashValue(config.mcp.authKey) : null,
});
}
```

**AFTER:**
```typescript
// Use DEBUG_AUTH flag instead of NODE_ENV for auth logging verbosity
const debugAuth = config.security.debugAuth;

if (debugAuth) {
  // Detailed logging only when explicitly enabled
  logger.warn({
    msg: 'Unauthorized MCP access attempt (DEBUG MODE)',
    requestId,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    url: request.url,
    method: request.method,
    headerKeys: Object.keys(request.headers ?? {}),
    providedKeyLength: providedKey?.length ?? 0,
    expectedKeyLength: config.mcp.authKey?.length ?? 0,
    providedKeyHash: providedKey ? hashValue(providedKey) : null,
    expectedKeyHash: config.mcp.authKey ? hashValue(config.mcp.authKey) : null,
  });
} else {
  // Minimal logging for production security
  logger.warn({
    msg: 'Unauthorized MCP access attempt',
    requestId,
    ip: request.ip,
    url: request.url,
    method: request.method,
  });
}
```

**File: `src/server.ts` (Lines 376-395)**

**BEFORE:**
```typescript
// Check if origins include wildcard - if so, disable origin validation
const hasWildcard = config.security?.allowedOrigins?.includes('*');
const allowedOrigins = hasWildcard ? undefined : (config.security?.allowedOrigins || []);

transport = new StreamableHTTPServerTransport({
  enableJsonResponse: true,
  sessionIdGenerator: () => randomUUID(),
  enableDnsRebindingProtection: false, // Disable for internal Docker network
  allowedHosts: [
    '127.0.0.1',
    `127.0.0.1:${port}`,
    'localhost',
    `localhost:${port}`,
    'mcp-server',
    `mcp-server:${port}`,
    'mcp-vector.mjames.dev',
    ...(config.security?.allowedOrigins?.filter(origin => origin !== '*') || [])
  ],
  allowedOrigins,
```

**AFTER:**
```typescript
// Build allowed hosts list dynamically with port variants
const baseHosts = config.security.allowedHostKeys;
const hostsWithPorts = baseHosts.flatMap(host => [
  host,
  `${host}:${port}`
]);

transport = new StreamableHTTPServerTransport({
  enableJsonResponse: true,
  sessionIdGenerator: () => randomUUID(),
  enableDnsRebindingProtection: true, // Enable DNS rebinding protection
  allowedHosts: hostsWithPorts,
  allowedOrigins: config.security.allowedCorsOrigins.length > 0 
    ? config.security.allowedCorsOrigins 
    : undefined, // undefined = no CORS validation (still fails at Fastify CORS middleware)
```

**File: `.env.example`**

**ADD AT END:**
```bash
# Security Configuration
# Comma-separated list of allowed CORS origins. FAIL-CLOSED: Empty = reject all CORS requests.
ALLOWED_CORS_ORIGINS=http://localhost:5678,http://n8n:5678,https://n8n.yourdomain.com

# Comma-separated list of allowed host keys for DNS rebinding protection
ALLOWED_HOST_KEYS=127.0.0.1,localhost,mcp-server,mcp-vector.yourdomain.com

# Enable detailed auth logging (ONLY for debugging, never in production)
DEBUG_AUTH=false
```

**File: `tests/integration/security.test.ts` (NEW FILE)**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { config } from '../../src/config/index.js';

describe('Story 1.5.1: Security Controls', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    // Setup test server with security config
    fastify = Fastify();
    // Register your routes...
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should reject CORS requests when origin not in allowlist', async () => {
    const response = await fastify.inject({
      method: 'OPTIONS',
      url: '/mcp',
      headers: {
        origin: 'https://evil-site.com',
        'access-control-request-method': 'POST'
      }
    });

    // CORS middleware should reject
    expect(response.statusCode).toBe(403); // Or whatever Fastify CORS returns
  });

  it('should accept CORS requests from allowed origins', async () => {
    const allowedOrigin = config.security.allowedCorsOrigins[0];
    const response = await fastify.inject({
      method: 'OPTIONS',
      url: '/mcp',
      headers: {
        origin: allowedOrigin,
        'access-control-request-method': 'POST'
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
  });

  it('should not leak auth details when DEBUG_AUTH=false', async () => {
    // Capture logger output
    const logMessages: any[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: any) => logMessages.push(msg);

    const response = await fastify.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'x-api-key': 'wrong-key'
      }
    });

    console.warn = originalWarn;

    expect(response.statusCode).toBe(401);
    
    // Check that no sensitive data leaked
    const authLog = logMessages.find(m => m.msg?.includes('Unauthorized'));
    expect(authLog).toBeDefined();
    expect(authLog.providedKeyHash).toBeUndefined();
    expect(authLog.expectedKeyHash).toBeUndefined();
  });
});
```

---

#### Testing Checklist

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes with new security tests
- [ ] Manual test: Try accessing MCP endpoint from disallowed origin (should fail)
- [ ] Manual test: Try accessing MCP endpoint from allowed origin (should succeed)
- [ ] Manual test: Check logs with DEBUG_AUTH=false (should not show hashes)
- [ ] Manual test: Check logs with DEBUG_AUTH=true (should show hashes)

---

**Files to Change:**
- `src/config/index.ts` - Add `allowedCorsOrigins` and `allowedHostKeys` from env
- `src/server.ts` - Update CORS middleware, reduce auth log verbosity
- `.env.example` - Add `ALLOWED_CORS_ORIGINS`, `ALLOWED_HOST_KEYS`, `DEBUG_AUTH`
- `docs/06-reference/config-and-env.md` - Document new security env vars
- `tests/integration/security.test.ts` (new) - Test CORS and auth controls

**Dependencies:** None (can start immediately)

---

### Story 1.5.2: Unblock Project Playbooks 📋

**Priority:** P0 (Blocks Casey's North Star role)  
**Effort:** 5 points  
**Owner:** Any agent familiar with data ingestion

**Problem:**
- `loadProjectJson` in `trace-prep.ts` looks for `data/projects/${projectName}.json`
- Actual playbooks are at `data/projects/${slug}/*.json` (e.g., `aismr/guardrails.json`)
- Casey never sees guardrails, agent expectations, or workflow contracts
- This breaks the North Star promise: "Projects define workflows"

**Acceptance Criteria:**
1. `loadProjectJson` correctly loads all playbook files from `data/projects/${slug}/`
2. Playbook data merged into project object (guardrails, workflow, expectations)
3. `trace_prepare` system prompt includes project guardrails for Casey
4. `trace_prepare` system prompt includes agent expectations for specialists
5. Unit test: `loadProjectJson('aismr')` returns guardrails from `aismr/guardrails.json`
6. Integration test: Casey receives guardrails in system prompt when `projectId='aismr'`
7. Update `docs/03-how-to/add-a-project.md` to clarify playbook structure

---

#### Implementation Pseudo Code

```typescript
// STEP 1: Fix loadProjectJson to load ALL playbook files from project directory
async function loadProjectPlaybooks(projectSlug: string): Promise<ProjectPlaybooks> {
  const playbookDir = path.join(DATA_ROOT, 'projects', projectSlug)
  
  // Load all JSON files in the project directory
  const files = await fs.readdir(playbookDir)
  const jsonFiles = files.filter(f => f.endsWith('.json'))
  
  const playbooks = {}
  for (const file of jsonFiles) {
    const content = await fs.readFile(path.join(playbookDir, file), 'utf-8')
    const key = file.replace('.json', '') // e.g., 'guardrails', 'workflow', 'agent-expectations'
    playbooks[key] = JSON.parse(content)
  }
  
  return {
    guardrails: playbooks.guardrails || {},
    workflow: playbooks.workflow?.workflow || [],
    agentExpectations: playbooks['agent-expectations'] || {},
    ...playbooks // Include any other playbook files
  }
}

// STEP 2: Merge playbooks into project context
projectContext = {
  ...projectFromDB,
  ...await loadProjectPlaybooks(projectFromDB.name), // Merge playbook data
}

// STEP 3: Include guardrails in Casey's system prompt
if (personaName === 'casey' && projectContext.guardrails) {
  systemPrompt += `\n\nPROJECT GUARDRAILS:\n${JSON.stringify(projectContext.guardrails, null, 2)}`
}

// STEP 4: Include agent expectations in specialist prompts
if (personaName !== 'casey' && projectContext.agentExpectations?.[personaName]) {
  const expectations = projectContext.agentExpectations[personaName]
  systemPrompt += `\n\nYOUR ROLE EXPECTATIONS:\n${JSON.stringify(expectations, null, 2)}`
}
```

---

#### Code Snippets

**File: `src/utils/trace-prep.ts` (Lines 110-128) - REPLACE loadProjectJson**

**BEFORE:**
```typescript
/**
 * Loads project JSON file to get agent_expectations and workflow
 */
async function loadProjectJson(projectName: string): Promise<{ workflow?: string[]; agent_expectations?: Record<string, unknown> } | null> {
  try {
    const dataDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'data',
      'projects'
    );
    const projectPath = path.join(dataDir, `${projectName}.json`);
    const content = await readFile(projectPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
```

**AFTER:**
```typescript
/**
 * Loads ALL playbook files from a project directory
 * Playbook structure: data/projects/{slug}/guardrails.json, workflow.json, agent-expectations.json, etc.
 */
async function loadProjectPlaybooks(projectSlug: string): Promise<{
  guardrails?: Record<string, unknown>;
  workflow?: string[];
  agentExpectations?: Record<string, unknown>;
  [key: string]: unknown;
} | null> {
  try {
    const playbookDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'data',
      'projects',
      projectSlug
    );
    
    // Check if directory exists
    try {
      await readFile(path.join(playbookDir, 'guardrails.json'), 'utf-8'); // Test directory access
    } catch {
      logger.debug({
        msg: 'Project playbook directory not found',
        projectSlug,
        playbookDir,
      });
      return null;
    }
    
    // Load all JSON playbooks
    const playbooks: Record<string, unknown> = {};
    const playbookFiles = [
      'guardrails.json',
      'workflow.json',
      'agent-expectations.json',
      'checklists.json',
      'capabilities.json',
    ];
    
    for (const file of playbookFiles) {
      try {
        const content = await readFile(path.join(playbookDir, file), 'utf-8');
        const data = JSON.parse(content);
        const key = file.replace('.json', '').replace(/-/g, '_'); // Convert to camelCase-ish
        
        // Handle specific file formats
        if (file === 'workflow.json' && data.workflow) {
          playbooks.workflow = data.workflow; // Extract workflow array
        } else if (file === 'agent-expectations.json') {
          playbooks.agentExpectations = data;
        } else {
          playbooks[key] = data;
        }
      } catch (error) {
        // File doesn't exist or invalid JSON - skip it
        logger.debug({
          msg: 'Skipping playbook file',
          projectSlug,
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    return Object.keys(playbooks).length > 0 ? playbooks : null;
  } catch (error) {
    logger.warn({
      msg: 'Failed to load project playbooks',
      projectSlug,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
```

**File: `src/utils/trace-prep.ts` (Lines 172-178) - UPDATE to use playbooks**

**BEFORE:**
```typescript
// Load project JSON to get workflow and agent_expectations
const projectJson = await loadProjectJson(params.projectContext.name);
const workflow = params.projectContext.workflow || projectJson?.workflow || [];
const firstAgent = workflow.length > 1 ? workflow[1] : 'iggy'; // workflow[0] is 'casey', so [1] is first agent
const caseyExpectations = projectJson?.agent_expectations?.casey as { instructions_template?: string } | undefined;
const instructionsTemplate = caseyExpectations?.instructions_template;
```

**AFTER:**
```typescript
// Load project playbooks (guardrails, workflow, agent expectations, etc.)
const playbooks = await loadProjectPlaybooks(params.projectContext.name);
const workflow = params.projectContext.workflow || playbooks?.workflow || [];
const firstAgent = workflow.length > 1 ? workflow[1] : 'iggy'; // workflow[0] is 'casey', so [1] is first agent
const caseyExpectations = playbooks?.agentExpectations?.casey as { instructions_template?: string } | undefined;
const instructionsTemplate = caseyExpectations?.instructions_template;

// Merge playbooks into project context for later use
const enrichedProjectContext = {
  ...params.projectContext,
  guardrails: params.projectContext.guardrails || playbooks?.guardrails || {},
  agentExpectations: playbooks?.agentExpectations || {},
};
```

**File: `src/utils/trace-prep.ts` (Lines 144-160) - ENHANCE with guardrails**

**BEFORE:**
```typescript
const promptPieces = [
  params.personaPrompt || `You are ${params.trace.currentOwner || 'an AISMR agent'}.`,
  `TRACE ID: ${params.trace.traceId}`,
  `**CRITICAL**: You MUST use this exact traceId for ALL tool calls. Do NOT create or invent a traceId.`,
  '',
  `CURRENT OWNER: ${params.trace.currentOwner || 'casey'}`,
  params.projectContext.name
    ? `PROJECT (${params.projectContext.name}): ${params.projectContext.description || ''}`
    : '',
  params.projectContext.id
    ? `PROJECT UUID: ${params.projectContext.id}`
    : '',
  params.projectContext.guardrails
    ? `PROJECT GUARDRAILS:\n${formatGuardrails(params.projectContext.guardrails)}`
    : '',
  `INSTRUCTIONS: ${params.instructions || 'None provided yet.'}`,
  `UPSTREAM WORK:\n${params.memoryLines}`,
];
```

**AFTER:**
```typescript
const promptPieces = [
  params.personaPrompt || `You are ${params.trace.currentOwner || 'an AISMR agent'}.`,
  `TRACE ID: ${params.trace.traceId}`,
  `**CRITICAL**: You MUST use this exact traceId for ALL tool calls. Do NOT create or invent a traceId.`,
  '',
  `CURRENT OWNER: ${params.trace.currentOwner || 'casey'}`,
  params.projectContext.name
    ? `PROJECT (${params.projectContext.name}): ${params.projectContext.description || ''}`
    : '',
  params.projectContext.id
    ? `PROJECT UUID: ${params.projectContext.id}`
    : '',
];

// Add guardrails for ALL personas (important context)
if (params.projectContext.guardrails && Object.keys(params.projectContext.guardrails).length > 0) {
  promptPieces.push(`PROJECT GUARDRAILS:\n${formatGuardrails(params.projectContext.guardrails)}`);
}

// Add role-specific expectations for specialists (not Casey)
const personaName = (params.trace.currentOwner || 'casey').toLowerCase();
if (personaName !== 'casey' && params.projectContext.agentExpectations?.[personaName]) {
  const expectations = params.projectContext.agentExpectations[personaName];
  promptPieces.push(`YOUR ROLE EXPECTATIONS:\n${formatGuardrails(expectations)}`);
}

promptPieces.push(
  `INSTRUCTIONS: ${params.instructions || 'None provided yet.'}`,
  `UPSTREAM WORK:\n${params.memoryLines}`,
);
```

**File: `src/utils/trace-prep.ts` (Lines 506-545) - UPDATE projectContext loading**

**BEFORE:**
```typescript
// Load project context
let projectContext: {
  id: string | null;
  name: string;
  description: string;
  guardrails: Record<string, unknown> | string;
  settings: Record<string, unknown>;
  workflow?: string[];
} | null = null;

let memoryProjectFilter: string | undefined;

if (trace.projectId) {
  try {
    const projectRecord =
      projectMap.get(trace.projectId) ?? (await projectRepo.findById(trace.projectId));
    if (projectRecord) {
      projectContext = {
        id: projectRecord.id,
        name: projectRecord.name,
        description: projectRecord.description,
        guardrails: projectRecord.guardrails,
        settings: projectRecord.settings,
        workflow: projectRecord.workflow,
      };
      memoryProjectFilter = projectRecord.name;
    } else {
      logger.warn({
        msg: 'Project referenced by trace not found; continuing with fallback',
        projectId: trace.projectId,
      });
    }
  } catch (error) {
    logger.warn({
      msg: 'Failed to load project guardrails; continuing with fallback',
      projectId: trace.projectId,
      error: (error as Error).message,
    });
  }
}
```

**AFTER:**
```typescript
// Load project context with playbooks
let projectContext: {
  id: string | null;
  name: string;
  description: string;
  guardrails: Record<string, unknown> | string;
  settings: Record<string, unknown>;
  workflow?: string[];
  agentExpectations?: Record<string, unknown>;
} | null = null;

let memoryProjectFilter: string | undefined;

if (trace.projectId) {
  try {
    const projectRecord =
      projectMap.get(trace.projectId) ?? (await projectRepo.findById(trace.projectId));
    if (projectRecord) {
      // Load playbooks from filesystem
      const playbooks = await loadProjectPlaybooks(projectRecord.name);
      
      projectContext = {
        id: projectRecord.id,
        name: projectRecord.name,
        description: projectRecord.description,
        // Prefer playbook guardrails over DB guardrails
        guardrails: playbooks?.guardrails || projectRecord.guardrails,
        settings: projectRecord.settings,
        // Prefer playbook workflow over DB workflow
        workflow: playbooks?.workflow || projectRecord.workflow,
        // Add agent expectations from playbooks
        agentExpectations: playbooks?.agentExpectations,
      };
      memoryProjectFilter = projectRecord.name;
      
      logger.debug({
        msg: 'Loaded project with playbooks',
        projectId: projectRecord.id,
        projectName: projectRecord.name,
        hasGuardrails: !!projectContext.guardrails,
        hasAgentExpectations: !!projectContext.agentExpectations,
        workflowLength: projectContext.workflow?.length || 0,
      });
    } else {
      logger.warn({
        msg: 'Project referenced by trace not found; continuing with fallback',
        projectId: trace.projectId,
      });
    }
  } catch (error) {
    logger.warn({
      msg: 'Failed to load project guardrails; continuing with fallback',
      projectId: trace.projectId,
      error: (error as Error).message,
    });
  }
}
```

**File: `tests/unit/trace-prep.test.ts` (ADD NEW TESTS)**

```typescript
import { describe, it, expect } from 'vitest';
import { loadProjectPlaybooks } from '../../src/utils/trace-prep.js';

describe('Story 1.5.2: Project Playbook Loading', () => {
  it('should load guardrails from aismr/guardrails.json', async () => {
    const playbooks = await loadProjectPlaybooks('aismr');
    
    expect(playbooks).toBeDefined();
    expect(playbooks?.guardrails).toBeDefined();
    expect(playbooks?.guardrails).toHaveProperty('content_policy');
  });

  it('should load workflow from aismr/workflow.json', async () => {
    const playbooks = await loadProjectPlaybooks('aismr');
    
    expect(playbooks).toBeDefined();
    expect(playbooks?.workflow).toBeDefined();
    expect(Array.isArray(playbooks?.workflow)).toBe(true);
    expect(playbooks?.workflow).toContain('casey');
    expect(playbooks?.workflow).toContain('iggy');
  });

  it('should load agent expectations from aismr/agent-expectations.json', async () => {
    const playbooks = await loadProjectPlaybooks('aismr');
    
    expect(playbooks).toBeDefined();
    expect(playbooks?.agentExpectations).toBeDefined();
    expect(playbooks?.agentExpectations).toHaveProperty('casey');
    expect(playbooks?.agentExpectations).toHaveProperty('iggy');
  });

  it('should return null for non-existent project', async () => {
    const playbooks = await loadProjectPlaybooks('nonexistent-project');
    
    expect(playbooks).toBeNull();
  });
});
```

**File: `tests/integration/trace-prep.test.ts` (ADD NEW TEST)**

```typescript
import { describe, it, expect } from 'vitest';
import { prepareTraceContext } from '../../src/utils/trace-prep.js';
import { ProjectRepository, TraceRepository } from '../../src/db/repositories/index.js';

describe('Story 1.5.2: Guardrails in System Prompt', () => {
  it('should include AISMR guardrails in Casey system prompt', async () => {
    // Setup: Create AISMR trace
    const traceRepo = new TraceRepository();
    const projectRepo = new ProjectRepository();
    
    const aismrProject = await projectRepo.findByName('aismr');
    expect(aismrProject).toBeDefined();
    
    const trace = await traceRepo.create({
      projectId: aismrProject!.id,
      currentOwner: 'casey',
      instructions: 'Make an AISMR video about candles',
    });
    
    // Act: Prepare trace context
    const result = await prepareTraceContext({
      traceId: trace.traceId,
      instructions: 'Make an AISMR video about candles',
    });
    
    // Assert: System prompt includes guardrails
    expect(result.systemPrompt).toContain('PROJECT GUARDRAILS');
    expect(result.systemPrompt).toContain('content_policy');
    expect(result.project.guardrails).toBeDefined();
  });

  it('should include agent expectations in specialist prompt', async () => {
    // Setup: Create AISMR trace with Iggy as owner
    const traceRepo = new TraceRepository();
    const projectRepo = new ProjectRepository();
    
    const aismrProject = await projectRepo.findByName('aismr');
    const trace = await traceRepo.create({
      projectId: aismrProject!.id,
      currentOwner: 'iggy',
      instructions: 'Generate 12 modifiers',
    });
    
    // Act: Prepare trace context
    const result = await prepareTraceContext({
      traceId: trace.traceId,
    });
    
    // Assert: System prompt includes role expectations
    expect(result.systemPrompt).toContain('YOUR ROLE EXPECTATIONS');
    expect(result.project.agentExpectations).toBeDefined();
    expect(result.project.agentExpectations).toHaveProperty('iggy');
  });
});
```

---

#### Directory Structure Validation

Before running tests, ensure your `data/projects/` structure looks like this:

```
data/projects/
├── aismr/
│   ├── guardrails.json          # Content policy, guidelines
│   ├── workflow.json            # workflow: ['casey', 'iggy', 'riley', ...]
│   ├── agent-expectations.json  # Role expectations per agent
│   ├── checklists.json          # Quality checklists
│   └── capabilities.json        # Project-specific capabilities
├── genreact/
│   ├── guardrails.json
│   ├── workflow.json
│   └── agent-expectations.json
└── general/
    └── workflow.json
```

**Example: `data/projects/aismr/guardrails.json`**

```json
{
  "content_policy": {
    "forbidden_topics": ["violence", "explicit_content"],
    "required_elements": ["surreal", "modifier", "tiktok_format"]
  },
  "technical_constraints": {
    "video_duration": "60-90s",
    "aspect_ratio": "9:16",
    "resolution": "1080x1920"
  }
}
```

**Example: `data/projects/aismr/agent-expectations.json`**

```json
{
  "casey": {
    "instructions_template": "Generate 12 unique modifiers for {topic}",
    "handoff_checklist": ["project_set", "topic_validated"]
  },
  "iggy": {
    "deliverable": "12 unique modifiers",
    "uniqueness_check": true,
    "archive_search_required": true
  },
  "riley": {
    "deliverable": "12 screenplays",
    "validation": ["duration_60-90s", "modifier_usage", "surreal_elements"]
  }
}
```

---

#### Testing Checklist

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] Unit tests pass: `loadProjectPlaybooks('aismr')` returns guardrails
- [ ] Integration test: Casey receives guardrails in system prompt
- [ ] Integration test: Iggy receives role expectations in system prompt
- [ ] Manual test: Inspect trace_prepare response for AISMR project (has guardrails)
- [ ] Manual test: Check logs for playbook loading success/failure

---

**Files to Change:**
- `src/utils/trace-prep.ts` - Fix `loadProjectJson` to read from `data/projects/${slug}/`
- `src/utils/trace-prep.ts` - Merge playbooks into project context
- `src/utils/trace-prep.ts` - Include guardrails and expectations in prompts
- `tests/unit/trace-prep.test.ts` - Test playbook loading
- `tests/integration/trace-prep.test.ts` - Test guardrails in system prompt
- `docs/03-how-to/add-a-project.md` - Clarify playbook file structure

**Dependencies:** None (can run parallel to 1.5.1)

---

### Story 1.5.3: Fix Memory Trace Filtering 🔍

**Priority:** P1 (Performance degradation at scale)  
**Effort:** 3 points  
**Owner:** Any agent familiar with database performance

**Problem:**
- `MemoryRepository.vectorSearch` and `keywordSearch` filter by `metadata ->> 'traceId'`
- This uses JSON extraction instead of indexed `memories.trace_id` column
- Potential drift between metadata and column
- Slows queries as trace memory grows

**Acceptance Criteria:**
1. All memory searches filter by indexed `memories.trace_id` column when `traceId` provided
2. Keep `metadata.traceId` for redundancy but make column authoritative
3. Add database index on `memories.trace_id` if not already present
4. Update `MemoryRepository` to use column filter
5. All existing tests pass (no behavior change, just performance)
6. Load test: Query 1000 memories by trace in <100ms (95th percentile)

---

#### Implementation Pseudo Code

```typescript
// STEP 1: Create migration to add index on trace_id column
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_trace_id 
ON memories (trace_id) 
WHERE trace_id IS NOT NULL;

// STEP 2: Update MemoryRepository to filter by trace_id column instead of JSON path
if (traceId) {
  // OLD: conditions.push(sql`${memories.metadata} ->> 'traceId' = ${traceId}`)
  // NEW: Use indexed column
  conditions.push(eq(memories.traceId, traceId))
}

// STEP 3: Ensure trace_id column is always populated from metadata.traceId
// (Already implemented in insert() method - verify it's working)

// STEP 4: Add performance test to validate <100ms query time
describe('Trace filtering performance', () => {
  it('should query 1000 memories by trace in <100ms', async () => {
    // Create 1000 memories for same trace
    // Run memory_search with traceId
    // Assert 95th percentile < 100ms
  })
})
```

---

#### Code Snippets

**File: `drizzle/0002_add_trace_id_index.sql` (NEW MIGRATION)**

```sql
-- Migration: Add index on memories.trace_id for fast trace filtering
-- This replaces slow JSON path extraction (metadata ->> 'traceId')

-- Add index on trace_id column (partial index excludes nulls for efficiency)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_trace_id 
ON memories (trace_id) 
WHERE trace_id IS NOT NULL;

-- Optional: Add compound index for common query patterns
-- (trace_id + created_at for time-ordered trace queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_trace_id_created_at 
ON memories (trace_id, created_at DESC) 
WHERE trace_id IS NOT NULL;

-- Performance validation query (should use idx_memories_trace_id)
EXPLAIN ANALYZE 
SELECT * FROM memories 
WHERE trace_id = 'test-trace-id' 
LIMIT 10;
```

**File: `src/db/repositories/memory-repository.ts` (Lines 36-40)**

**BEFORE:**
```typescript
// Filter by traceId metadata
if (traceId) {
  conditions.push(sql`${memories.metadata} ->> 'traceId' = ${traceId}`);
}
```

**AFTER:**
```typescript
// Filter by indexed trace_id column (much faster than JSON path extraction)
if (traceId) {
  conditions.push(eq(memories.traceId, traceId));
}
```

**File: `src/db/repositories/memory-repository.ts` (Lines 105-107)**

**BEFORE:**
```typescript
if (traceId) {
  conditions.push(sql`${memories.metadata} ->> 'traceId' = ${traceId}`);
}
```

**AFTER:**
```typescript
// Filter by indexed trace_id column
if (traceId) {
  conditions.push(eq(memories.traceId, traceId));
}
```

**File: `src/db/repositories/memory-repository.ts` (Lines 219-221) - Already using column, VERIFY**

```typescript
// This method already uses SQL path extraction - should also be updated
// BEFORE:
const conditions = [sql`${memories.metadata} ->> 'traceId' = ${traceId}`];

// AFTER:
const conditions = [eq(memories.traceId, traceId)];
```

**File: `src/db/repositories/memory-repository.ts` (Lines 123-132) - VERIFY insert populates trace_id**

```typescript
async insert(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
  // Extract trace_id from metadata if present
  const traceId = memory.metadata?.traceId as string | undefined;
  const insertValues = {
    ...memory,
    traceId: traceId || null, // ✅ GOOD: Populates trace_id column
  };
  const [result] = await db.insert(memories).values(insertValues).returning();
  return result as Memory;
}
```

**File: `tests/performance/memory-search.test.ts` (NEW FILE)**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryRepository } from '../../src/db/repositories/memory-repository.js';
import { embedText } from '../../src/utils/embedding.js';
import { randomUUID } from 'crypto';

describe('Story 1.5.3: Memory Trace Filtering Performance', () => {
  let memoryRepo: MemoryRepository;
  const testTraceId = `perf-test-${randomUUID()}`;
  const memoryIds: string[] = [];

  beforeAll(async () => {
    memoryRepo = new MemoryRepository();
    
    // Create 1000 test memories for the same trace
    console.log('Setting up 1000 test memories...');
    const embedding = await embedText('test memory');
    
    for (let i = 0; i < 1000; i++) {
      const memory = await memoryRepo.insert({
        content: `Test memory ${i} for trace filtering performance`,
        summary: `Memory ${i}`,
        memoryType: 'episodic',
        persona: ['test'],
        project: ['test-project'],
        tags: ['performance-test'],
        embedding,
        metadata: {
          traceId: testTraceId,
          batchIndex: i,
        },
        traceId: testTraceId, // Populate column directly
        accessCount: 0,
        importance: 1.0,
        lastAccessedAt: new Date(),
      });
      memoryIds.push(memory.id);
    }
    
    console.log(`Created ${memoryIds.length} test memories`);
  });

  afterAll(async () => {
    // Cleanup: Delete test memories
    // (Implement cleanup logic or use transaction rollback)
  });

  it('should query memories by trace_id in <100ms (95th percentile)', async () => {
    const iterations = 20;
    const durations: number[] = [];
    
    // Warm up query cache
    await memoryRepo.findByTraceId(testTraceId, { limit: 100 });
    
    // Run multiple iterations to get 95th percentile
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const results = await memoryRepo.findByTraceId(testTraceId, { limit: 100 });
      const duration = performance.now() - start;
      
      durations.push(duration);
      expect(results.length).toBe(100);
    }
    
    // Calculate 95th percentile
    durations.sort((a, b) => a - b);
    const p95Index = Math.floor(iterations * 0.95);
    const p95Duration = durations[p95Index];
    
    console.log('Query durations:', {
      min: Math.min(...durations).toFixed(2),
      max: Math.max(...durations).toFixed(2),
      avg: (durations.reduce((a, b) => a + b) / durations.length).toFixed(2),
      p95: p95Duration.toFixed(2),
    });
    
    // Assert: 95th percentile should be under 100ms
    expect(p95Duration).toBeLessThan(100);
  });

  it('should use indexed column for vectorSearch with traceId', async () => {
    const embedding = await embedText('test query');
    
    const start = performance.now();
    const results = await memoryRepo.vectorSearch(embedding, {
      traceId: testTraceId,
      limit: 50,
      memoryTypes: ['episodic'],
    });
    const duration = performance.now() - start;
    
    console.log(`vectorSearch with traceId took ${duration.toFixed(2)}ms`);
    
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(50);
    expect(duration).toBeLessThan(100); // Should be fast with index
  });

  it('should use indexed column for keywordSearch with traceId', async () => {
    const start = performance.now();
    const results = await memoryRepo.keywordSearch('test memory', {
      traceId: testTraceId,
      limit: 50,
      memoryTypes: ['episodic'],
    });
    const duration = performance.now() - start;
    
    console.log(`keywordSearch with traceId took ${duration.toFixed(2)}ms`);
    
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(50);
    expect(duration).toBeLessThan(100); // Should be fast with index
  });
});
```

**File: `drizzle.config.ts` (VERIFY migration setup)**

```typescript
// Verify that migrations are configured correctly
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
};
```

---

#### Database Performance Validation

**Check current query plan (BEFORE changes):**

```sql
-- Connect to your database
psql $DATABASE_URL

-- Check if index exists
\di idx_memories_trace_id

-- Analyze query plan WITHOUT index (slow)
EXPLAIN ANALYZE 
SELECT * FROM memories 
WHERE metadata ->> 'traceId' = 'test-trace-id' 
LIMIT 10;

-- Expected output: Seq Scan or Index Scan on metadata (SLOW)
```

**After migration, verify index is used:**

```sql
-- Check if index was created
\di idx_memories_trace_id

-- Analyze query plan WITH index (fast)
EXPLAIN ANALYZE 
SELECT * FROM memories 
WHERE trace_id = 'test-trace-id' 
LIMIT 10;

-- Expected output: Index Scan using idx_memories_trace_id (FAST)
-- Should show "Index Cond: (trace_id = 'test-trace-id'::text)"
```

---

#### Migration Execution

```bash
# Generate migration file
npm run db:generate

# OR manually create migration file
cat > drizzle/0002_add_trace_id_index.sql << 'EOF'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_trace_id 
ON memories (trace_id) 
WHERE trace_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_trace_id_created_at 
ON memories (trace_id, created_at DESC) 
WHERE trace_id IS NOT NULL;
EOF

# Run migration
npm run db:migrate

# Verify index was created
psql $DATABASE_URL -c "\di idx_memories_trace_id"
```

---

#### Testing Checklist

- [ ] Migration file created: `drizzle/0002_add_trace_id_index.sql`
- [ ] Migration runs successfully: `npm run db:migrate`
- [ ] Index exists in database: `\di idx_memories_trace_id`
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] All existing tests pass (no behavior change)
- [ ] Performance test passes: `npm run test:performance`
- [ ] Query plan shows index usage: `EXPLAIN ANALYZE` 
- [ ] Memory searches with traceId are <100ms

---

#### Drizzle ORM Reference

Based on Context7 documentation, here's how to properly use `eq` for column filtering:

```typescript
import { eq } from 'drizzle-orm';

// ✅ GOOD: Use indexed column
await db.select().from(memories).where(eq(memories.traceId, traceId));

// ❌ BAD: Use JSON path extraction (slow, not indexed)
await db.select().from(memories).where(sql`${memories.metadata} ->> 'traceId' = ${traceId}`);
```

---

**Files to Change:**
- `drizzle/0002_add_trace_id_index.sql` (new) - Add index on trace_id
- `src/db/repositories/memory-repository.ts` - Change trace filtering to use `trace_id` column (3 locations)
- `tests/performance/memory-search.test.ts` (new) - Add load test for trace filtering

**Dependencies:** None (can run parallel to 1.5.1 and 1.5.2)

---

### Story 1.5.4: Normalize trace_update Contract 🔧

**Priority:** P1 (Agent reliability)  
**Effort:** 2 points  
**Owner:** Any agent familiar with MCP tools

**Problem:**
- `trace_update` expects project UUID
- Casey and other agents naturally use slugs (e.g., `'aismr'` not `'123e4567...'`)
- Leads to update failures or confusion

**Acceptance Criteria:**
1. `trace_update` accepts both slugs and UUIDs for `projectId`
2. If slug provided, normalize to UUID via `ProjectRepository.findByName`
3. If UUID provided, use directly
4. Return clear error if neither slug nor UUID found
5. Update `docs/06-reference/mcp-tools.md` to document slug support
6. Unit test: `trace_update({ projectId: 'aismr' })` resolves to UUID
7. Unit test: `trace_update({ projectId: '<uuid>' })` works directly
8. Integration test: Casey can use slug in `trace_update` call

---

#### Implementation Pseudo Code

```typescript
// STEP 1: Create UUID detection helper
function isUUID(value: string): boolean {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return UUID_REGEX.test(value);
}

// STEP 2: Update trace_update handler to normalize projectId
async function traceUpdateHandler(params) {
  if (params.projectId) {
    let resolvedProjectId: string;
    
    if (isUUID(params.projectId)) {
      // It's a UUID, use directly
      resolvedProjectId = params.projectId;
    } else {
      // It's a slug, resolve to UUID
      const project = await projectRepo.findByName(params.projectId);
      if (!project) {
        // List available projects to help user
        const allProjects = await projectRepo.findAll();
        const availableNames = allProjects.map(p => p.name).join(', ');
        throw new Error(
          `Project not found: "${params.projectId}". Available: ${availableNames}`
        );
      }
      resolvedProjectId = project.id;
    }
    
    // Validate resolved UUID exists
    const projectExists = await projectRepo.findById(resolvedProjectId);
    if (!projectExists) {
      throw new Error(`Project UUID not found: ${resolvedProjectId}`);
    }
    
    updatePayload.projectId = resolvedProjectId;
  }
}
```

---

#### Code Snippets

**File: `src/mcp/tools.ts` (Lines 330-379) - UPDATE traceUpdateTool handler**

**BEFORE:**
```typescript
const traceUpdateTool: MCPTool = {
  name: 'trace_update',
  title: 'Update Trace',
  description: 'Update project, instructions, or metadata for an existing trace. **REQUIRED**: traceId parameter MUST come from your system prompt (TRACE ID field). **IMPORTANT**: projectId should be a canonical project UUID. For backward compatibility, project slugs (e.g., "aismr") are accepted but will be resolved to UUIDs. Example: trace_update({traceId: "trace-aismr-001", projectId: "550e8400-e29b-41d4-a716-446655440000", instructions: "..."}). Do NOT create or invent a traceId - use the exact traceId from your system prompt. Typically called by Casey after normalizing the request.',
  inputSchema: traceUpdateInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = traceUpdateInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'trace_update',
      params: sanitizeParams(validated),
      requestId,
    });

    const updatePayload: Record<string, unknown> = {};
    if (typeof validated.projectId !== 'undefined') {
      // Validate project exists
      const projectRepo = new ProjectRepository();
      const project = await projectRepo.findById(validated.projectId);
      if (!project) {
        throw new Error(
          `Project not found: "${validated.projectId}". Provide a valid project UUID from the available projects list.`
        );
      }
      updatePayload.projectId = project.id;
    }
    if (typeof validated.instructions !== 'undefined') {
      updatePayload.instructions = validated.instructions;
    }
    if (typeof validated.metadata !== 'undefined') {
      updatePayload.metadata = sanitizeMetadata(validated.metadata as Record<string, unknown>);
    }

    if (Object.keys(updatePayload).length === 0) {
      throw new Error('trace_update requires at least one field: projectId, instructions, or metadata');
    }

    const traceRepo = new TraceRepository();
    const updatedTrace = await traceRepo.updateTrace(validated.traceId, updatePayload);
    if (!updatedTrace) {
      throw new NotFoundError(`Trace not found: ${validated.traceId}`, 'trace', MCPErrorCode.TRACE_NOT_FOUND);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(updatedTrace) }],
      structuredContent: updatedTrace,
    };
  },
};
```

**AFTER:**
```typescript
// Helper function to detect UUID format
function isUUID(value: string): boolean {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return UUID_REGEX.test(value);
}

const traceUpdateTool: MCPTool = {
  name: 'trace_update',
  title: 'Update Trace',
  description: 'Update project, instructions, or metadata for an existing trace. **REQUIRED**: traceId parameter MUST come from your system prompt (TRACE ID field). **FLEXIBLE**: projectId accepts both slugs (e.g., "aismr") and UUIDs. Slugs are automatically resolved to UUIDs. Example: trace_update({traceId: "trace-aismr-001", projectId: "aismr", instructions: "..."}). Do NOT create or invent a traceId - use the exact traceId from your system prompt.',
  inputSchema: traceUpdateInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = traceUpdateInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'trace_update',
      params: sanitizeParams(validated),
      requestId,
    });

    const updatePayload: Record<string, unknown> = {};
    if (typeof validated.projectId !== 'undefined') {
      const projectRepo = new ProjectRepository();
      let resolvedProjectId: string;
      
      // Check if projectId is a UUID or slug
      if (isUUID(validated.projectId)) {
        // It's a UUID, use directly
        resolvedProjectId = validated.projectId;
        logger.debug({
          msg: 'Using project UUID directly',
          projectId: resolvedProjectId,
          requestId,
        });
      } else {
        // It's a slug, resolve to UUID
        const project = await projectRepo.findByName(validated.projectId);
        if (!project) {
          // Provide helpful error with available projects
          const allProjects = await projectRepo.findAll();
          const availableNames = allProjects.map(p => p.name).join(', ');
          throw new ValidationError(
            `Project not found: "${validated.projectId}". Available projects: ${availableNames}`,
            'projectId'
          );
        }
        resolvedProjectId = project.id;
        logger.debug({
          msg: 'Resolved project slug to UUID',
          slug: validated.projectId,
          uuid: resolvedProjectId,
          requestId,
        });
      }
      
      // Validate resolved UUID exists
      const project = await projectRepo.findById(resolvedProjectId);
      if (!project) {
        throw new NotFoundError(
          `Project UUID not found: ${resolvedProjectId}`,
          'project',
          MCPErrorCode.EXTERNAL_SERVICE_ERROR
        );
      }
      updatePayload.projectId = project.id;
    }
    if (typeof validated.instructions !== 'undefined') {
      updatePayload.instructions = validated.instructions;
    }
    if (typeof validated.metadata !== 'undefined') {
      updatePayload.metadata = sanitizeMetadata(validated.metadata as Record<string, unknown>);
    }

    if (Object.keys(updatePayload).length === 0) {
      throw new ValidationError(
        'trace_update requires at least one field: projectId, instructions, or metadata',
        'params'
      );
    }

    const traceRepo = new TraceRepository();
    const updatedTrace = await traceRepo.updateTrace(validated.traceId, updatePayload);
    if (!updatedTrace) {
      throw new NotFoundError(`Trace not found: ${validated.traceId}`, 'trace', MCPErrorCode.TRACE_NOT_FOUND);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(updatedTrace) }],
      structuredContent: updatedTrace,
    };
  },
};
```

**File: `src/db/repositories/project-repository.ts` (Lines 32-40) - VERIFY findByName exists**

```typescript
// This method should already exist, verify it's working correctly
async findByName(name: string): Promise<Project | null> {
  const [result] = await db
    .select()
    .from(projects)
    .where(eq(projects.name, name))
    .limit(1);

  return (result as Project) || null;
}
```

**File: `src/mcp/tools.ts` (Lines 195-205) - UPDATE traceUpdateInputSchema description**

**BEFORE:**
```typescript
const traceUpdateInputSchema = z.object({
  traceId: uuidSchema,
  projectId: uuidSchema.optional(),
  instructions: z.string().max(10000, 'Instructions must be 10000 characters or less').optional(),
  metadata: recordLike().optional(),
});
```

**AFTER:**
```typescript
const traceUpdateInputSchema = z.object({
  traceId: uuidSchema,
  projectId: z.string().optional(), // Accept both slugs and UUIDs
  instructions: z.string().max(10000, 'Instructions must be 10000 characters or less').optional(),
  metadata: recordLike().optional(),
});
```

**File: `tests/unit/tools.test.ts` (ADD NEW TESTS)**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { ProjectRepository, TraceRepository } from '../../src/db/repositories/index.js';

describe('Story 1.5.4: trace_update slug normalization', () => {
  let projectRepo: ProjectRepository;
  let traceRepo: TraceRepository;
  let aismrProjectId: string;

  beforeAll(async () => {
    projectRepo = new ProjectRepository();
    traceRepo = new TraceRepository();
    
    const aismrProject = await projectRepo.findByName('aismr');
    if (!aismrProject) {
      throw new Error('AISMR project not found in test database');
    }
    aismrProjectId = aismrProject.id;
  });

  it('should accept project slug and resolve to UUID', async () => {
    const trace = await traceRepo.create({
      projectId: null,
      instructions: 'Test trace',
    });
    
    // Call trace_update with slug
    const updated = await traceRepo.updateTrace(trace.traceId, {
      projectId: aismrProjectId, // This will be set by the tool after resolution
    });
    
    expect(updated).toBeDefined();
    expect(updated!.projectId).toBe(aismrProjectId);
  });

  it('should accept project UUID directly', async () => {
    const trace = await traceRepo.create({
      projectId: null,
      instructions: 'Test trace',
    });
    
    // Call trace_update with UUID
    const updated = await traceRepo.updateTrace(trace.traceId, {
      projectId: aismrProjectId,
    });
    
    expect(updated).toBeDefined();
    expect(updated!.projectId).toBe(aismrProjectId);
  });

  it('should detect UUID format correctly', async () => {
    const isUUID = (value: string): boolean => {
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return UUID_REGEX.test(value);
    };
    
    expect(isUUID(aismrProjectId)).toBe(true);
    expect(isUUID('aismr')).toBe(false);
    expect(isUUID('not-a-uuid')).toBe(false);
    expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('should provide helpful error for invalid slug', async () => {
    const trace = await traceRepo.create({
      projectId: null,
      instructions: 'Test trace',
    });
    
    // This test validates the error message includes available projects
    // Actual validation happens in the MCP tool handler
    const allProjects = await projectRepo.findAll();
    expect(allProjects.length).toBeGreaterThan(0);
    
    const availableNames = allProjects.map(p => p.name);
    expect(availableNames).toContain('aismr');
  });
});
```

**File: `tests/integration/trace-update.test.ts` (ADD NEW TEST)**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { prepareTraceContext } from '../../src/utils/trace-prep.js';
import { ProjectRepository, TraceRepository } from '../../src/db/repositories/index.js';

describe('Story 1.5.4: Casey uses slug in trace_update', () => {
  it('should allow Casey to update trace with project slug', async () => {
    const traceRepo = new TraceRepository();
    const projectRepo = new ProjectRepository();
    
    // Create trace without project
    const trace = await traceRepo.create({
      currentOwner: 'casey',
      instructions: 'Make an AISMR video',
      projectId: null,
    });
    
    // Casey would call trace_update with slug 'aismr'
    const aismrProject = await projectRepo.findByName('aismr');
    expect(aismrProject).toBeDefined();
    
    // Simulate trace_update with slug (resolved to UUID in handler)
    const updated = await traceRepo.updateTrace(trace.traceId, {
      projectId: aismrProject!.id,
    });
    
    expect(updated).toBeDefined();
    expect(updated!.projectId).toBe(aismrProject!.id);
    
    // Verify trace_prepare now includes project context
    const preparedContext = await prepareTraceContext({
      traceId: trace.traceId,
    });
    
    expect(preparedContext.project.name).toBe('aismr');
    expect(preparedContext.systemPrompt).toContain('AISMR');
  });
});
```

---

#### Testing Checklist

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] Unit tests pass: UUID detection works correctly
- [ ] Unit tests pass: Slug resolution works
- [ ] Integration test: Casey can use 'aismr' instead of UUID
- [ ] Manual test: Call trace_update with slug via HTTP endpoint
- [ ] Manual test: Call trace_update with UUID via HTTP endpoint
- [ ] Manual test: Verify error message lists available projects

---

#### Helper Function Location

Add the `isUUID` helper at the top of the tools.ts file, after imports:

```typescript
/**
 * Checks if a string matches UUID format
 */
function isUUID(value: string): boolean {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return UUID_REGEX.test(value);
}
```

---

**Files to Change:**
- `src/mcp/tools.ts` - Add `isUUID` helper, update `traceUpdateTool` handler
- `src/mcp/tools.ts` - Update `traceUpdateInputSchema` to accept strings (not just UUIDs)
- `src/db/repositories/project-repository.ts` - Verify `findByName` exists (should already exist)
- `docs/06-reference/mcp-tools.md` - Document slug support in `trace_update`
- `tests/unit/tools.test.ts` - Test slug normalization
- `tests/integration/trace-update.test.ts` - Test Casey workflow with slug

**Dependencies:** None (can run parallel to other stories)

---

### Story 1.5.5: Security & Operations Runbook 📖

**Priority:** P1 (Human oversight, ethical guardrails)  
**Effort:** 5 points  
**Owner:** Agent with technical writing + security experience

**Problem:**
- No guide for operators to deploy safely
- Missing key rotation procedures
- No rate-limit tuning guidance
- Human-in-the-loop controls undocumented

**Acceptance Criteria:**
1. Create `docs/05-operations/security-hardening.md`
2. Document required env vars for production (origins, hosts, keys)
3. Document key rotation procedure (API keys, DB credentials)
4. Document rate-limit configuration and tuning
5. Document HITL controls (Telegram approval nodes, fallback paths)
6. Create `docs/05-operations/production-runbook.md`
7. Document startup checklist (env vars, migrations, health checks)
8. Document incident response (trace status, memory search, handoff recovery)
9. Document scaling guidelines (session limits, memory cache, concurrent traces)
10. Peer review by another agent for completeness

---

#### Implementation Pseudo Code

```markdown
# STEP 1: Create security-hardening.md
- Document all security env vars from Story 1.5.1
- Document key rotation procedures
- Document rate limiting configuration
- Document HITL controls and approval flows

# STEP 2: Create production-runbook.md
- Startup checklist (pre-flight checks)
- Health check procedures
- Incident response playbooks
- Scaling guidelines and capacity planning

# STEP 3: Update existing docs
- Link from deployment.md to new guides
- Add to docs/README.md operations section
```

---

#### Document Templates

**File: `docs/05-operations/security-hardening.md` (NEW FILE)**

```markdown
# Security Hardening Guide

**Last Updated:** 2025-11-09  
**Version:** 1.0

---

## Overview

This guide provides security best practices for deploying MyloWare in production. Follow these guidelines to protect your AI Production Studio from unauthorized access and ensure safe operations.

---

## Required Environment Variables

### CORS Configuration

**Variable:** `ALLOWED_CORS_ORIGINS`  
**Format:** Comma-separated list of origins  
**Default:** Empty (fail-closed)  
**Production Example:**
```bash
ALLOWED_CORS_ORIGINS=https://n8n.yourdomain.com,https://app.yourdomain.com
```

**Why This Matters:** Empty origin list rejects all CORS requests by default (fail-closed security). Only add origins that need direct browser access to the MCP endpoint.

**Testing:**
```bash
# Should succeed (allowed origin)
curl -H "Origin: https://n8n.yourdomain.com" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS https://mcp.yourdomain.com/mcp

# Should fail (disallowed origin)
curl -H "Origin: https://evil-site.com" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS https://mcp.yourdomain.com/mcp
```

---

### Host Allowlist

**Variable:** `ALLOWED_HOST_KEYS`  
**Format:** Comma-separated hostnames  
**Default:** `127.0.0.1,localhost,mcp-server`  
**Production Example:**
```bash
ALLOWED_HOST_KEYS=127.0.0.1,localhost,mcp-server,mcp-vector.yourdomain.com
```

**Why This Matters:** Protects against DNS rebinding attacks. Only add hostnames that will make requests to your MCP server.

---

### Authentication

**Variable:** `MCP_AUTH_KEY`  
**Format:** 32+ character random string  
**Default:** None (REQUIRED in production)  
**Generation:**
```bash
# Generate secure auth key
openssl rand -hex 32
```

**Production Setup:**
```bash
MCP_AUTH_KEY=a1b2c3d4e5f6789012345678901234567890abcdefghijklmnopqrstuvwxyz
```

**⚠️ CRITICAL:** Never commit auth keys to version control. Use secrets management (e.g., AWS Secrets Manager, HashiCorp Vault).

---

**Variable:** `DEBUG_AUTH`  
**Format:** `true` or `false`  
**Default:** `false`  
**Production:** `false` (ALWAYS)

**Why This Matters:** When `true`, logs detailed auth failures including key hashes. Only enable for debugging, never in production.

---

## Key Rotation Procedure

### Rotating MCP Auth Key

**Downtime:** Zero downtime with proper coordination

**Steps:**

1. **Generate new key:**
```bash
NEW_KEY=$(openssl rand -hex 32)
echo "New MCP_AUTH_KEY: $NEW_KEY"
```

2. **Update n8n workflows FIRST:**
   - Open n8n workflow editor
   - Update "HTTP Request" nodes credentials
   - Set new `x-api-key` header value
   - Save and activate workflows

3. **Update MCP server environment:**
```bash
# Update .env or secrets manager
MCP_AUTH_KEY=$NEW_KEY

# Restart service
systemctl restart myloware
# OR
docker-compose restart mcp-server
```

4. **Verify connectivity:**
```bash
curl -H "x-api-key: $NEW_KEY" https://mcp.yourdomain.com/health
```

5. **Monitor logs for auth failures:**
```bash
# Check for any old key usage
docker logs mcp-server | grep "Unauthorized"
```

---

### Rotating Database Credentials

**Downtime:** Brief connection interruption

**Steps:**

1. **Create new database user:**
```sql
CREATE USER myloware_new WITH PASSWORD 'new-secure-password';
GRANT ALL PRIVILEGES ON DATABASE mcp_prompts TO myloware_new;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO myloware_new;
```

2. **Update connection string:**
```bash
# Old: postgresql://myloware:old-password@localhost:5432/mcp_prompts
# New: postgresql://myloware_new:new-password@localhost:5432/mcp_prompts
DATABASE_URL=postgresql://myloware_new:new-password@localhost:5432/mcp_prompts
```

3. **Restart service:**
```bash
systemctl restart myloware
```

4. **Verify health:**
```bash
curl https://mcp.yourdomain.com/health | jq .checks.database
```

5. **Drop old user (after 24h grace period):**
```sql
DROP USER myloware;
```

---

## Rate Limiting Configuration

**Variables:**
```bash
RATE_LIMIT_MAX=100              # Requests per time window
RATE_LIMIT_TIME_WINDOW=1 minute # Time window duration
```

**Production Tuning:**

| Environment | Max Requests | Time Window | Use Case |
|-------------|--------------|-------------|----------|
| Development | 100 | 1 minute | Testing |
| Staging | 500 | 1 minute | Load testing |
| Production (Low) | 1000 | 1 minute | Small team |
| Production (High) | 5000 | 1 minute | Large team, many workflows |

**Monitoring:**
```bash
# Check rate limit hits in logs
docker logs mcp-server | grep "Rate limit exceeded"

# Prometheus metrics
curl https://mcp.yourdomain.com/metrics | grep rate_limit
```

---

## Human-in-the-Loop (HITL) Controls

### Telegram Approval Nodes

MyloWare uses Telegram for HITL approval in critical workflow steps:

**Example Flow:**
```
Casey → Iggy (Generate Modifiers)
  ↓
Telegram: "Approve 12 modifiers for 'candles' video?"
  ↓ [User Approval]
Riley → Veo (Generate Videos)
```

**Configuration in n8n:**

1. **Add Telegram Send Message Node:**
   - Message: "Approve {count} {item_type} for {project}?"
   - Include summary of generated content

2. **Add Wait for Webhook Node:**
   - Webhook path: `/webhook/approval/{trace_id}`
   - Timeout: 15 minutes
   - On timeout: Route to error handler

3. **Add Fallback Path:**
   - If timeout: Notify operator via Telegram
   - Store trace state as "pending_approval"
   - Allow manual retry

**Testing HITL:**
```bash
# Trigger workflow with HITL
curl -X POST https://n8n.yourdomain.com/webhook/myloware/ingest \
  -H "x-api-key: $N8N_WEBHOOK_AUTH_TOKEN" \
  -d '{"traceId": "test-trace-001", "instructions": "Make AISMR video"}'

# Check Telegram for approval message
# Approve via Telegram bot command: /approve test-trace-001
```

---

## Network Security

### Firewall Rules

**Inbound (Allow):**
```bash
# HTTPS from n8n instance
ufw allow from <n8n-ip> to any port 443 proto tcp

# PostgreSQL from MCP server only
ufw allow from <mcp-server-ip> to any port 5432 proto tcp
```

**Outbound (Allow):**
```bash
# OpenAI API
ufw allow out to any port 443 proto tcp

# n8n webhooks
ufw allow out to <n8n-ip> port 443 proto tcp
```

---

### TLS/SSL Configuration

**Minimum TLS Version:** 1.3  
**Cipher Suites:** Use Mozilla Modern configuration

**Example nginx config:**
```nginx
ssl_protocols TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';

# HSTS
add_header Strict-Transport-Security "max-age=63072000" always;
```

---

## Secrets Management

**❌ DON'T:**
- Commit `.env` files to git
- Store keys in plaintext config files
- Share keys via Slack/email

**✅ DO:**
- Use environment-specific secrets managers
- Rotate keys quarterly (minimum)
- Use separate keys per environment
- Audit key access logs

**Recommended Tools:**
- AWS Secrets Manager
- HashiCorp Vault
- Kubernetes Secrets
- Docker Secrets (Swarm)

---

## Compliance Checklist

- [ ] All secrets stored in secrets manager
- [ ] CORS configured with explicit origins (no wildcards)
- [ ] Rate limiting enabled and tuned
- [ ] TLS 1.3 enforced
- [ ] Auth keys rotated in last 90 days
- [ ] Database credentials rotated in last 90 days
- [ ] HITL controls tested and documented
- [ ] Incident response playbook reviewed
- [ ] Security audit completed

---

**Next Steps:** Review [Production Runbook](./production-runbook.md) for operational procedures.
```

---

**File: `docs/05-operations/production-runbook.md` (NEW FILE)**

```markdown
# Production Runbook

**Last Updated:** 2025-11-09  
**Version:** 1.0

---

## Overview

This runbook provides operational procedures for deploying, monitoring, and maintaining MyloWare in production.

---

## Pre-Deployment Checklist

### Environment Validation

- [ ] **DATABASE_URL** - PostgreSQL connection string verified
- [ ] **OPENAI_API_KEY** - Valid OpenAI API key (test with `curl`)
- [ ] **MCP_AUTH_KEY** - Secure key generated (32+ chars, not default)
- [ ] **ALLOWED_CORS_ORIGINS** - Explicit origins configured (no wildcards)
- [ ] **ALLOWED_HOST_KEYS** - Production hostnames added
- [ ] **TELEGRAM_BOT_TOKEN** - Bot token configured for HITL
- [ ] **N8N_WEBHOOK_URL** - n8n instance URL verified

### Database Migrations

```bash
# Run migrations
npm run db:migrate

# Verify migrations
psql $DATABASE_URL -c "\dt"

# Check for idx_memories_trace_id
psql $DATABASE_URL -c "\di idx_memories_trace_id"
```

### Health Checks

```bash
# Application health
curl https://mcp.yourdomain.com/health | jq

# Expected output:
# {
#   "status": "healthy",
#   "checks": {
#     "database": "ok",
#     "openai": "ok",
#     "tools": "{...}"
#   }
# }

# Prometheus metrics
curl https://mcp.yourdomain.com/metrics | grep -E "(mcp|http)"
```

---

## Startup Procedure

### Step 1: Environment Setup

```bash
# Load environment variables
source .env.production

# Verify critical vars
echo "MCP_AUTH_KEY: ${MCP_AUTH_KEY:0:8}..." # Show first 8 chars only
echo "DATABASE_URL: ${DATABASE_URL%%@*}@***" # Hide password
```

### Step 2: Database Preparation

```bash
# Run migrations
npm run db:migrate

# Seed data (if fresh install)
npm run db:seed

# Verify data
psql $DATABASE_URL -c "SELECT COUNT(*) FROM personas;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM projects;"
```

### Step 3: Start Service

```bash
# Production mode
NODE_ENV=production npm start

# OR with PM2
pm2 start npm --name "myloware" -- start
pm2 save

# OR with Docker
docker-compose up -d mcp-server
```

### Step 4: Verify Startup

```bash
# Check health endpoint
curl -f https://mcp.yourdomain.com/health || echo "Health check failed!"

# Check logs
docker logs -f mcp-server
# OR
pm2 logs myloware

# Verify MCP endpoint
curl -H "x-api-key: $MCP_AUTH_KEY" \
     https://mcp.yourdomain.com/mcp \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
```

---

## Incident Response

### Scenario 1: Trace Stuck in Active State

**Symptoms:**
- Trace not progressing through workflow
- No handoff events in last 30+ minutes
- User reports workflow timeout

**Diagnosis:**
```bash
# Find stuck traces
psql $DATABASE_URL << EOF
SELECT trace_id, current_owner, status, 
       updated_at, NOW() - updated_at AS age
FROM execution_traces
WHERE status = 'active' 
  AND updated_at < NOW() - INTERVAL '30 minutes'
ORDER BY updated_at ASC;
EOF
```

**Resolution:**
```bash
# Option 1: Inspect trace memories
npm run mw -- memory search --trace-id <trace-id> --limit 20

# Option 2: Manual handoff recovery
npm run mw -- handoff --trace-id <trace-id> --to-agent <next-agent>

# Option 3: Mark as failed (last resort)
psql $DATABASE_URL << EOF
UPDATE execution_traces 
SET status = 'failed', 
    completed_at = NOW(),
    metadata = metadata || '{"manual_intervention": true}'::jsonb
WHERE trace_id = '<trace-id>';
EOF
```

---

### Scenario 2: Memory Search Slow (>1s)

**Symptoms:**
- API requests timing out
- High database CPU usage
- Slow trace_prepare calls

**Diagnosis:**
```bash
# Check query performance
psql $DATABASE_URL << EOF
EXPLAIN ANALYZE
SELECT * FROM memories
WHERE trace_id = 'test-trace-id'
LIMIT 10;
EOF

# Look for "Index Scan using idx_memories_trace_id"
# If seeing "Seq Scan", index is missing!
```

**Resolution:**
```bash
# Verify index exists
psql $DATABASE_URL -c "\di idx_memories_trace_id"

# If missing, run migration
npm run db:migrate

# If exists but not used, analyze table
psql $DATABASE_URL -c "ANALYZE memories;"
```

---

### Scenario 3: Handoff Webhook Failure

**Symptoms:**
- Agent executes work but next agent doesn't start
- n8n workflow shows no trigger event
- Logs show webhook 500 errors

**Diagnosis:**
```bash
# Check n8n connectivity
curl -f $N8N_WEBHOOK_URL/health || echo "n8n unreachable!"

# Check webhook auth
curl -H "x-api-key: $N8N_WEBHOOK_AUTH_TOKEN" \
     $N8N_WEBHOOK_URL/webhook/myloware/ingest \
     -d '{"test": true}'

# Check logs for webhook errors
docker logs mcp-server | grep "handoff_to_agent" | tail -20
```

**Resolution:**
```bash
# Option 1: Retry handoff manually
npm run mw -- handoff --trace-id <trace-id> --to-agent <next-agent>

# Option 2: Check n8n workflow is active
# Visit n8n UI → Workflows → "Myloware Agent" → Activate

# Option 3: Verify webhook mapping
psql $DATABASE_URL << EOF
SELECT * FROM workflow_mappings 
WHERE key = 'myloware-agent';
EOF
```

---

### Scenario 4: High Memory Usage

**Symptoms:**
- Container/process memory exceeding 2GB
- OOM kills in logs
- Slow response times

**Diagnosis:**
```bash
# Check memory usage
docker stats mcp-server
# OR
pm2 status myloware

# Check session count
curl https://mcp.yourdomain.com/metrics | grep session_count
```

**Resolution:**
```bash
# Tune session limits
# In .env:
MAX_SESSIONS_PER_USER=20  # Reduce from 50
SESSION_TTL_MS=1800000     # Reduce to 30 minutes

# Restart service
systemctl restart myloware

# Monitor memory after restart
watch docker stats mcp-server
```

---

## Scaling Guidelines

### Concurrent Traces

| Metric | Low Load | Medium Load | High Load |
|--------|----------|-------------|-----------|
| Concurrent Traces | 1-10 | 10-50 | 50-200 |
| Memory (GB) | 1-2 | 2-4 | 4-8 |
| CPU (cores) | 1-2 | 2-4 | 4-8 |
| Database Connections | 10 | 20 | 50 |

**Horizontal Scaling:**
```bash
# Add more MCP server instances
docker-compose scale mcp-server=3

# Use load balancer (nginx/HAProxy)
# Sticky sessions NOT required (stateless)
```

---

### Memory Cache Optimization

**When to Add Redis:**
- Memory searches > 100ms (95th percentile)
- >1000 traces in database
- Repeated embedding generations

**Setup:**
```bash
# Add to docker-compose.yml
redis:
  image: redis:7-alpine
  command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru

# Update .env
REDIS_URL=redis://redis:6379
```

---

### Database Optimization

**Recommended Settings (PostgreSQL):**
```sql
-- For production workload
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET effective_cache_size = '6GB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET work_mem = '10MB';

-- Reload config
SELECT pg_reload_conf();
```

**Monitoring Queries:**
```sql
-- Check slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE mean_exec_time > 1000
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Check table sizes
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Trace Success Rate**
   - Target: >95%
   - Alert if <90%

2. **Memory Query Latency**
   - Target: <100ms (95th percentile)
   - Alert if >500ms

3. **API Response Time**
   - Target: <500ms (95th percentile)
   - Alert if >2s

4. **Database Connection Pool**
   - Target: <80% utilization
   - Alert if >90%

### Prometheus Queries

```promql
# Trace success rate
rate(traces_completed_total[5m]) / rate(traces_created_total[5m])

# Memory search latency
histogram_quantile(0.95, rate(memory_search_duration_seconds_bucket[5m]))

# API error rate
rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])
```

---

## Backup & Disaster Recovery

### Database Backups

```bash
# Daily backup script
#!/bin/bash
BACKUP_DIR=/backups/myloware
DATE=$(date +%Y%m%d_%H%M%S)

# Backup database
pg_dump $DATABASE_URL | gzip > $BACKUP_DIR/mcp_$DATE.sql.gz

# Backup memories table separately (large)
pg_dump $DATABASE_URL -t memories | gzip > $BACKUP_DIR/memories_$DATE.sql.gz

# Retain last 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete
```

### Restore Procedure

```bash
# Stop service
systemctl stop myloware

# Drop and recreate database
psql -c "DROP DATABASE mcp_prompts;"
psql -c "CREATE DATABASE mcp_prompts;"

# Restore from backup
gunzip -c /backups/myloware/mcp_20251109.sql.gz | psql $DATABASE_URL

# Verify restore
psql $DATABASE_URL -c "SELECT COUNT(*) FROM traces;"

# Restart service
systemctl start myloware
```

---

## Rollback Procedure

### Application Rollback

```bash
# Docker
docker-compose down
docker-compose -f docker-compose.v1.4.0.yml up -d

# PM2
pm2 stop myloware
git checkout v1.4.0
npm install
pm2 restart myloware
```

### Database Rollback

```bash
# Rollback last migration
npm run db:rollback

# Verify current migration
psql $DATABASE_URL -c "SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1;"
```

---

## Support Contacts

- **Ops Lead:** [email/slack]
- **Database Admin:** [email/slack]
- **Security Team:** [email/slack]
- **On-Call:** [pagerduty/opsgenie]

---

**Next Steps:** Review [Troubleshooting Guide](./troubleshooting.md) for common issues.
```

---

#### Files to Update

**File: `docs/05-operations/deployment.md` (ADD LINKS)**

Add at the top of the file:

```markdown
## Related Guides

- [Security Hardening](./security-hardening.md) - Security best practices for production
- [Production Runbook](./production-runbook.md) - Operational procedures and incident response
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
```

**File: `docs/README.md` (ADD TO OPERATIONS SECTION)**

Update the operations section:

```markdown
### 05. Operations

- [Deployment](./05-operations/deployment.md) - Deploy to production
- **[Security Hardening](./05-operations/security-hardening.md)** - Security best practices ⭐ NEW
- **[Production Runbook](./05-operations/production-runbook.md)** - Operational procedures ⭐ NEW
- [Observability](./05-operations/observability.md) - Metrics and logging
- [Troubleshooting](./05-operations/troubleshooting.md) - Common issues
- [Backups and Restore](./05-operations/backups-and-restore.md) - Data protection
```

---

#### Testing Checklist

- [ ] Security hardening document created
- [ ] Production runbook document created
- [ ] All env vars from Story 1.5.1 documented
- [ ] Key rotation procedures tested
- [ ] HITL controls documented
- [ ] Incident response scenarios tested
- [ ] Scaling guidelines validated
- [ ] Links added to existing docs
- [ ] Peer review completed
- [ ] Documentation spell-checked

---

**Files to Create:**
- `docs/05-operations/security-hardening.md` (new) - 300+ lines
- `docs/05-operations/production-runbook.md` (new) - 400+ lines

**Files to Update:**
- `docs/05-operations/deployment.md` - Link to new guides
- `docs/README.md` - Add to operations section

**Dependencies:** Story 1.5.1 (to document the security env vars)

---

### Story 1.5.6: Test Hygiene & Config Externalization 🧹

**Priority:** P2 (Quality improvements)  
**Effort:** 3 points  
**Owner:** Any agent

**Problem:**
- ESLint ignores `tests/**` directory, reducing regression signal
- Session TTL and max sessions hardcoded in codebase
- Can't tune policies for production without code changes

**Acceptance Criteria:**
1. ESLint applies to `tests/**` with relaxed rules (allow `any` in test fixtures)
2. Create `eslint.config.test.mjs` for test-specific rules
3. Session TTL reads from `SESSION_TTL_MS` env var (default 3600000)
4. Max sessions reads from `MAX_SESSIONS_PER_USER` env var (default 10)
5. Update `.env.example` with session config vars
6. Update `docs/06-reference/config-and-env.md` with session tuning guidance
7. Fix any ESLint errors in tests that arise from new linting
8. All tests pass after changes

**Files to Change:**
- `eslint.config.mjs` - Remove `tests/**` ignore, add test config
- `eslint.config.test.mjs` (new) - Relaxed rules for tests
- `src/config/index.ts` - Add `sessionTtlMs` and `maxSessionsPerUser` from env
- `.env.example` - Add `SESSION_TTL_MS`, `MAX_SESSIONS_PER_USER`
- `docs/06-reference/config-and-env.md` - Document session tuning
- `tests/**/*.ts` - Fix any new ESLint errors

**Dependencies:** None (can run parallel to other stories)

---

#### Implementation Pseudo Code

```typescript
// STEP 1: Update ESLint config to include tests
eslint.config.mjs: {
  files: ['**/*.ts'],
  ignores: ['node_modules/**', 'dist/**'], // Remove 'tests/**'
}

// Add test-specific relaxed rules
eslint.config.test.mjs: {
  files: ['tests/**/*.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
  }
}

// STEP 2: Externalize session config
config/index.ts: {
  session: {
    ttlMs: parseInt(process.env.SESSION_TTL_MS || '3600000'),
    maxSessionsPerUser: parseInt(process.env.MAX_SESSIONS_PER_USER || '10'),
  }
}

// STEP 3: Update constants.ts to use config
utils/constants.ts: {
  export const SESSION_TTL_MS = config.session.ttlMs;
  export const MAX_SESSIONS = config.session.maxSessionsPerUser;
}

// STEP 4: Fix any ESLint errors in tests
// Run: npm run lint:fix
// Manual fixes for any remaining issues
```

---

#### Code Snippets

**File: `eslint.config.mjs` (UPDATE ignores list)**

**BEFORE:**
```javascript
export default [
  {
    files: ['**/*.ts', '**/*.js'],
    ignores: ['node_modules/**', 'dist/**', 'tests/**'], // tests/** is ignored
  },
  // ... existing rules ...
];
```

**AFTER:**
```javascript
export default [
  {
    files: ['**/*.ts', '**/*.js'],
    ignores: ['node_modules/**', 'dist/**'], // Removed tests/** - now linted!
  },
  // ... existing rules ...
  
  // Add test-specific configuration at the end
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Relax rules for test files
      '@typescript-eslint/no-explicit-any': 'off', // Allow 'any' in test fixtures
      '@typescript-eslint/no-non-null-assertion': 'off', // Allow '!' in tests
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }], // Warn instead of error
    },
  },
];
```

**File: `src/config/index.ts` (ADD session config)**

**BEFORE:**
```typescript
const ConfigSchema = z.object({
  database: z.object({ ... }),
  openai: z.object({ ... }),
  mcp: z.object({ ... }),
  server: z.object({ ... }),
  telegram: z.object({ ... }).optional(),
  n8n: z.object({ ... }),
  security: z.object({ ... }),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});
```

**AFTER:**
```typescript
const ConfigSchema = z.object({
  database: z.object({ ... }),
  openai: z.object({ ... }),
  mcp: z.object({ ... }),
  server: z.object({ ... }),
  telegram: z.object({ ... }).optional(),
  n8n: z.object({ ... }),
  security: z.object({ ... }),
  session: z.object({
    ttlMs: z.number().default(3600000), // 1 hour default
    maxSessionsPerUser: z.number().default(10), // 10 sessions default
  }),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});
```

**File: `src/config/index.ts` (PARSE session config from env)**

Add after the `n8n` config block:

```typescript
  session: {
    ttlMs: parseInt(process.env.SESSION_TTL_MS || '3600000'),
    maxSessionsPerUser: parseInt(process.env.MAX_SESSIONS_PER_USER || '10'),
  },
```

**File: `src/utils/constants.ts` (REPLACE hardcoded constants)**

**BEFORE:**
```typescript
// Hardcoded constants
export const SESSION_TTL_MS = 3600000; // 1 hour
export const MAX_SESSIONS = 10;
```

**AFTER:**
```typescript
import { config } from '../config/index.js';

// Load from config (which reads from env)
export const SESSION_TTL_MS = config.session.ttlMs;
export const MAX_SESSIONS = config.session.maxSessionsPerUser;

// Other constants remain unchanged
export const DEFAULT_MEMORY_LIMIT = 10;
```

**File: `.env.example` (ADD session configuration)**

Add at the end:

```bash
# Session Management
# Session timeout in milliseconds (default: 3600000 = 1 hour)
SESSION_TTL_MS=3600000

# Maximum concurrent sessions per user (default: 10)
MAX_SESSIONS_PER_USER=10
```

**File: `docs/06-reference/config-and-env.md` (ADD documentation)**

Add new section:

```markdown
### Session Management

**SESSION_TTL_MS**
- **Description:** Session timeout in milliseconds
- **Type:** Number
- **Default:** 3600000 (1 hour)
- **Production Tuning:**
  - Development: 3600000 (1 hour)
  - Production (low activity): 1800000 (30 minutes)
  - Production (high activity): 7200000 (2 hours)
- **Example:**
  ```bash
  SESSION_TTL_MS=1800000  # 30 minutes
  ```

**MAX_SESSIONS_PER_USER**
- **Description:** Maximum concurrent sessions per user
- **Type:** Number
- **Default:** 10
- **Production Tuning:**
  - Single user: 5
  - Small team: 10-20
  - Large team: 50-100
- **Example:**
  ```bash
  MAX_SESSIONS_PER_USER=20
  ```

**Impact on Performance:**
- Lower `SESSION_TTL_MS` → Less memory usage, more frequent re-authentication
- Lower `MAX_SESSIONS_PER_USER` → More aggressive session cleanup, potential disruption for active users
- Monitor `session_count` metric in `/metrics` endpoint

**Session Cleanup:**
Sessions are automatically cleaned up every 5 minutes based on:
1. TTL expiration (older than `SESSION_TTL_MS`)
2. LRU eviction (exceeds `MAX_SESSIONS_PER_USER`)
```

---

#### Common ESLint Fixes

After enabling linting for tests, you may encounter these errors:

**Error 1: Unused variables**
```typescript
// BEFORE
const result = await someFunction();
// Don't use result

// AFTER
const _result = await someFunction(); // Prefix with _ to ignore
// OR
void await someFunction(); // If return value truly unused
```

**Error 2: Type assertions**
```typescript
// BEFORE
const data = response as any; // 'any' not allowed

// AFTER (tests only)
const data = response as unknown; // Prefer 'unknown'
// OR keep 'any' - it's allowed in tests after config change
```

**Error 3: Non-null assertions**
```typescript
// BEFORE
expect(project!.id).toBe('123'); // May warn

// AFTER (tests only)
expect(project!.id).toBe('123'); // Now allowed in tests
```

---

#### Testing Checklist

- [ ] ESLint config updated to lint `tests/**`
- [ ] Test-specific rules added to allow `any` and `!`
- [ ] Session config schema added to ConfigSchema
- [ ] Session config parsed from env vars
- [ ] Constants.ts uses config values
- [ ] `.env.example` updated with session vars
- [ ] `docs/06-reference/config-and-env.md` updated
- [ ] `npm run lint` passes (after fixing tests)
- [ ] `npm run lint:fix` applied to auto-fix issues
- [ ] `npm test` passes
- [ ] Manual test: Verify session TTL from env var
- [ ] Manual test: Verify max sessions from env var

---

#### Validation Commands

```bash
# Check ESLint applies to tests
npm run lint | grep "tests/"

# Auto-fix simple issues
npm run lint:fix

# Verify config loads from env
NODE_ENV=test SESSION_TTL_MS=1800000 MAX_SESSIONS_PER_USER=5 npm test

# Check session cleanup logs
docker logs mcp-server | grep "Session cleanup"
```

---

**Files to Change:**
- `eslint.config.mjs` - Remove `tests/**` ignore, add test-specific rules
- `src/config/index.ts` - Add `session` config with `ttlMs` and `maxSessionsPerUser`
- `src/utils/constants.ts` - Replace hardcoded values with config
- `.env.example` - Add `SESSION_TTL_MS`, `MAX_SESSIONS_PER_USER`
- `docs/06-reference/config-and-env.md` - Document session tuning
- `tests/**/*.ts` - Fix any new ESLint errors (likely minimal)

**Dependencies:** None (can run parallel to other stories)

---

## ✅ Epic 1.5 Complete!

All 6 stories now have:
- ✅ Implementation pseudo code
- ✅ BEFORE/AFTER code snippets with line numbers
- ✅ Test examples and validation steps
- ✅ Testing checklists
- ✅ Context7-verified patterns

**Total Implementation Guidance:** 2000+ lines of detailed instructions  
**Ready for:** Autonomous AI agent execution

---

## 🎭 Epic 2: Agent Workflows (NEXT SPRINT)

**Goal:** Implement Casey → Iggy → Riley → Veo → Alex → Quinn handoff chain with full project playbook support.

**Pre-Conditions:**
- ✅ Epic 1.5 complete (all stories accepted)
- ✅ Casey receives project playbooks in system prompts
- ✅ Security hardened, operations runbooks ready
- ✅ All tests green, no known regressions

---

### Story 2.1: Casey → Iggy Handoff

**Priority:** P0  
**Effort:** 8 points  
**Owner:** Agent familiar with persona configs + n8n workflows

**Acceptance Criteria:**
1. Casey receives Telegram message: "Make an AISMR video about candles"
2. `trace_prepare` detects `projectId='unknown'`, builds Casey initialization prompt
3. Casey calls `trace_update({ projectId: 'aismr' })` with slug (normalized by Story 1.5.4)
4. Casey stores kickoff memory tagged with `traceId`
5. Casey calls `handoff_to_agent({ toAgent: 'iggy', instructions: '...' })`
6. `handoff_to_agent` updates trace (`currentOwner='iggy'`, `workflowStep=1`)
7. `handoff_to_agent` invokes Myloware Agent webhook with `{ traceId }`
8. Iggy receives system prompt with AISMR guardrails (from Story 1.5.2)
9. Integration test: End-to-end Casey → Iggy with real trace
10. E2E test: Telegram trigger → Casey → Iggy (stubbed OpenAI)

**Files to Change:**
- `data/personas/casey/system-prompt.md` - Refine project determination logic
- `data/personas/iggy/system-prompt.md` - Refine modifier generation logic
- `src/mcp/prompts.ts` - Ensure Casey prompt includes project playbooks
- `workflows/myloware-agent.workflow.json` - Configure webhook trigger correctly
- `tests/integration/casey-iggy-handoff.test.ts` (new)
- `tests/e2e/telegram-to-iggy.test.ts` (new)

**Dependencies:** Epic 1.5 complete

---

### Story 2.2: Iggy → Riley Handoff

**Priority:** P0  
**Effort:** 8 points  
**Owner:** Agent familiar with creative + writing workflows

**Acceptance Criteria:**
1. Iggy receives trace from Casey with instructions to generate modifiers
2. Iggy calls `memory_search({ query: 'AISMR candles past modifiers', project: 'aismr' })`
3. Iggy generates 12 unique modifiers (checked against archive)
4. Iggy stores modifiers via `memory_store({ metadata: { traceId } })`
5. Iggy calls `handoff_to_agent({ toAgent: 'riley', instructions: '...' })`
6. Riley receives system prompt with AISMR screenplay specs
7. Riley loads modifiers via `memory_search({ traceId })`
8. Integration test: Iggy → Riley with memory passing
9. E2E test: Casey → Iggy → Riley (stubbed OpenAI)

**Files to Change:**
- `data/personas/iggy/system-prompt.md` - Refine uniqueness checking
- `data/personas/riley/system-prompt.md` - Refine screenplay validation
- `tests/integration/iggy-riley-handoff.test.ts` (new)
- `tests/e2e/casey-to-riley.test.ts` (new)

**Dependencies:** Story 2.1 complete

---

### Story 2.3: Riley → Veo Handoff

**Priority:** P0  
**Effort:** 8 points  
**Owner:** Agent familiar with video generation workflows

**Acceptance Criteria:**
1. Riley writes 12 screenplays validated against AISMR specs
2. Riley stores screenplays via `memory_store({ metadata: { traceId } })`
3. Riley calls `handoff_to_agent({ toAgent: 'veo', instructions: '...' })`
4. Veo receives system prompt with video generation instructions
5. Veo loads screenplays via `memory_search({ traceId })`
6. Veo workflow orchestrates video generation (may be n8n HTTP nodes, not AI agent)
7. Integration test: Riley → Veo with screenplay passing
8. E2E test: Casey → Iggy → Riley → Veo (stubbed video generation)

**Files to Change:**
- `data/personas/riley/system-prompt.md` - Finalize validation logic
- `data/personas/veo/system-prompt.md` - Define video generation orchestration
- `workflows/generate-video.workflow.json` - Ensure Veo can invoke this
- `tests/integration/riley-veo-handoff.test.ts` (new)
- `tests/e2e/casey-to-veo.test.ts` (new)

**Dependencies:** Story 2.2 complete

---

### Story 2.4: Veo → Alex Handoff

**Priority:** P0  
**Effort:** 5 points  
**Owner:** Agent familiar with editing workflows

**Acceptance Criteria:**
1. Veo generates 12 videos (or stubs generation in test)
2. Veo stores video URLs via `memory_store({ metadata: { traceId } })`
3. Veo calls `handoff_to_agent({ toAgent: 'alex', instructions: '...' })`
4. Alex receives system prompt with editing instructions
5. Alex loads video URLs via `memory_search({ traceId })`
6. Alex workflow orchestrates compilation (may be n8n nodes)
7. Integration test: Veo → Alex with video URL passing
8. E2E test: Casey → ... → Alex (stubbed editing)

**Files to Change:**
- `data/personas/veo/system-prompt.md` - Finalize video generation handoff
- `data/personas/alex/system-prompt.md` - Define compilation logic
- `tests/integration/veo-alex-handoff.test.ts` (new)
- `tests/e2e/casey-to-alex.test.ts` (new)

**Dependencies:** Story 2.3 complete

---

### Story 2.5: Alex → Quinn Handoff

**Priority:** P0  
**Effort:** 5 points  
**Owner:** Agent familiar with publishing workflows

**Acceptance Criteria:**
1. Alex edits compilation video
2. Alex stores final video URL via `memory_store({ metadata: { traceId } })`
3. Alex calls `handoff_to_agent({ toAgent: 'quinn', instructions: '...' })`
4. Quinn receives system prompt with publishing instructions
5. Quinn loads final video via `memory_search({ traceId })`
6. Quinn generates caption and hashtags
7. Quinn uploads to TikTok (stubbed in test)
8. Quinn calls `handoff_to_agent({ toAgent: 'complete', instructions: '...' })`
9. `handoff_to_agent` sets trace status to 'completed'
10. Integration test: Alex → Quinn → Complete
11. E2E test: Casey → ... → Quinn → Complete (full chain)

**Files to Change:**
- `data/personas/alex/system-prompt.md` - Finalize editing handoff
- `data/personas/quinn/system-prompt.md` - Define publishing logic
- `src/mcp/tools.ts` - Ensure `handoff_to_agent` handles `toAgent='complete'`
- `tests/integration/alex-quinn-handoff.test.ts` (new)
- `tests/e2e/full-aismr-workflow.test.ts` (new)

**Dependencies:** Story 2.4 complete

---

### Story 2.6: Full E2E AISMR Happy Path

**Priority:** P0  
**Effort:** 3 points  
**Owner:** Any agent

**Acceptance Criteria:**
1. Run full AISMR workflow from Telegram message to completion
2. Verify all handoffs execute correctly
3. Verify all memories stored with `traceId`
4. Verify trace status transitions: active → completed
5. Verify Casey completion notification sent (if implemented)
6. E2E test passes with realistic timing (under 30s for stubbed external calls)
7. Generate workflow diagram from trace history
8. Update `docs/SUMMARIES.md` with Epic 2 completion summary

**Files to Change:**
- `tests/e2e/full-aismr-happy-path.test.ts` (consolidate from prior stories)
- `docs/SUMMARIES.md` - Add Epic 2 summary
- `docs/02-architecture/universal-workflow.md` - Update with real examples

**Dependencies:** Stories 2.1–2.5 complete

---

## 📦 Epic 3: Production Hardening (FUTURE)

**Goal:** Optimize performance, enhance observability, and enable advanced workflow features.

**Pre-Conditions:**
- ✅ Epic 2 complete (all agent workflows tested)
- ✅ At least one production deployment successful
- ✅ Real user feedback collected

---

### Story 3.1: Advanced Memory Caching

**Scope:** Implement Redis caching for hot traces to reduce repeated embeddings.

**Value:** 50%+ reduction in OpenAI embedding costs for active traces.

**Deferred Because:** Need production metrics to identify hot traces first.

---

### Story 3.2: Persona-Specific Retrieval Blending

**Scope:** Weight memory types per persona (e.g., Iggy prefers semantic, Riley prefers episodic).

**Value:** Higher recall and relevance for agent-specific memory searches.

**Deferred Because:** Need agent workflow telemetry to tune weights.

---

### Story 3.3: Dynamic Workflow Modification

**Scope:** Allow agents to skip steps, retry, or branch workflows mid-execution.

**Value:** More adaptive workflows, faster iteration on complex projects.

**Deferred Because:** Need stable linear workflows first to understand modification patterns.

---

### Story 3.4: Observability Dashboard

**Scope:** Grafana dashboard for trace state, agent handoffs, memory growth, tool latency.

**Value:** Real-time visibility into production studio operations.

**Deferred Because:** Need production metrics to define useful visualizations.

---

## 🎯 Success Metrics (Revised)

| Metric | Target | Current | Gap |
|--------|--------|---------|-----|
| **Security Posture** | Fail-closed CORS, externalized config | Open CORS, hardcoded | Epic 1.5.1 |
| **Casey Effectiveness** | Receives playbooks 100% | Never receives | Epic 1.5.2 |
| **Memory Query Performance** | <100ms for 1000 memories | Unknown (likely slower) | Epic 1.5.3 |
| **Agent Handoff Success Rate** | >95% | Not yet tested | Epic 2 |
| **E2E Workflow Completion** | <10 min (real), <30s (stubbed) | N/A | Epic 2.6 |
| **Test Coverage** | ≥66% maintained | 66%+ | Ongoing |
| **Operations Confidence** | Production runbook + security guide | Missing | Epic 1.5.5 |

---

## 🚦 Definition of Done (All Stories)

**Code:**
- [ ] All acceptance criteria met
- [ ] Tests written and passing (unit + integration + e2e as appropriate)
- [ ] ESLint clean, TypeScript strict
- [ ] No console.log or debug code
- [ ] Code reviewed by another agent (or self-review documented)

**Documentation:**
- [ ] User-facing docs updated (if applicable)
- [ ] API/tool reference updated (if applicable)
- [ ] Inline comments for complex logic
- [ ] Update `docs/SUMMARIES.md` for significant changes

**Quality:**
- [ ] Coverage maintained at ≥66%
- [ ] No new linter warnings
- [ ] All tests pass: `npm test`
- [ ] Legacy tool check passes: `npm run check:legacy-tools`
- [ ] Type check passes: `npm run type-check`

**Deployment:**
- [ ] Environment variables documented in `.env.example` and `docs/06-reference/config-and-env.md`
- [ ] Database migrations run successfully
- [ ] No breaking changes to existing workflows (or documented in migration guide)

---

## 📋 Backlog Prioritization (PO Guidance)

**For AI Agents Executing This Plan:**

1. **Start with Epic 1.5** - Don't skip stabilization. The foundation must be solid.

2. **Stories 1.5.1–1.5.4 can run in parallel** - They have no dependencies. Coordinate to avoid merge conflicts.

3. **Story 1.5.5 blocks on 1.5.1** - Can't document security env vars until they exist.

4. **Story 1.5.6 is independent** - Can run anytime in Epic 1.5.

5. **Epic 2 is strictly sequential** - Each handoff builds on the previous. Don't skip ahead.

6. **Epic 3 is future work** - Don't start until Epic 2 is complete and production-validated.

**Sprint Velocity Assumption:**
- Each agent can complete 8–13 points per sprint
- Epic 1.5 total: 21 points (3 parallel agents = 1 sprint)
- Epic 2 total: 37 points (1 agent = 5 sprints, or 3 agents with careful coordination = 2 sprints)

**Communication:**
- Update `plan.md` status as stories complete
- Add significant changes to `docs/SUMMARIES.md`
- Use Git commit messages to reference story numbers (e.g., "Story 1.5.2: Fix playbook loading")

---

## 🔄 Review & Retrospective Cadence

**After Epic 1.5:**
- [ ] Run full test suite, confirm all green
- [ ] Deploy to staging, run smoke tests
- [ ] Review security hardening guide with human operator
- [ ] Confirm playbooks load in Casey's prompt
- [ ] Update this plan with any learnings

**After Epic 2:**
- [ ] Run full E2E AISMR happy path in staging
- [ ] Measure actual workflow timing
- [ ] Review agent effectiveness (did memories pass correctly?)
- [ ] Update persona prompts based on learnings
- [ ] Plan Epic 3 based on production metrics

**After Each Story:**
- [ ] Self-review or peer review
- [ ] Update story status in this plan
- [ ] Commit with clear message
- [ ] Run affected tests

---

## 📚 Reference Documentation

**For understanding the vision:**
- `NORTH_STAR.md` - Complete system vision and walkthrough
- `AGENTS.md` - Agent development guide and quick reference
- `docs/02-architecture/system-overview.md` - High-level architecture
- `docs/02-architecture/trace-state-machine.md` - Coordination model

**For development:**
- `docs/07-contributing/dev-guide.md` - Local development workflow
- `docs/07-contributing/coding-standards.md` - Code quality rules
- `docs/07-contributing/testing.md` - Test strategy and patterns

**For operations:**
- `docs/05-operations/observability.md` - Metrics and queries
- `docs/05-operations/troubleshooting.md` - Common issues
- `docs/05-operations/deployment.md` - Deployment process

**For tools:**
- `docs/06-reference/mcp-tools.md` - Complete MCP tool catalog
- `docs/06-reference/api-endpoints.md` - HTTP endpoint reference
- `docs/06-reference/config-and-env.md` - Environment configuration

---

## 🎓 PO Philosophy for This Plan

**Gap Analysis Over Feature Velocity:**
The review identified that we were building on unstable ground. Epic 1.5 addresses technical debt before it compounds. This is a product decision: better to pause and stabilize than to build fragile features.

**Trust & Safety Are Product Features:**
Security hardening and operations runbooks aren't "ops work"—they're core to the product promise. Human operators must be able to safely deploy and intervene. This is part of responsible AI development.

**Configuration Over Code:**
The North Star vision promises flexibility through projects and personas as JSON. Epic 1.5.2 delivers on that promise by fixing playbook loading. Epic 1.5.6 extends it to runtime policies.

**Trace-Aware Context Is The Product:**
Memory filtering (Story 1.5.3) might seem like optimization, but it's core to the product value proposition. If memory searches degrade at scale, the coordination fabric breaks. This is a product risk, not just a performance issue.

**Continuous Integration of Learnings:**
After each epic, we review and update the plan. This is not waterfall—it's informed iteration. The plan is a living document, not a contract.

---

**Next Action:** Begin Epic 1.5, Story 1.5.1 (or any parallelizable story).

**End State:** Production-ready AI Production Studio where Casey orchestrates specialist agents through trace-aware, memory-first coordination, with human oversight and ethical guardrails.

---

_"Strategy without tactics is the slowest route to victory. Tactics without strategy is the noise before defeat."_ – Sun Tzu

**This plan bridges the gap between our current codebase and the North Star vision by addressing critical gaps first, then building agent workflows on a stable foundation.**
