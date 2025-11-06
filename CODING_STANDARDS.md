# V2 Coding Standards

> **"Write code that looks like one person wrote it, even when many did."**

---

## 🎯 Core Principles

1. **Consistency** - Code should look uniform across the entire codebase
2. **Type Safety** - No `any`, no inline interfaces, comprehensive types
3. **Single Responsibility** - Each function/class does one thing well
4. **Testability** - Every function can be tested in isolation
5. **Single-Line JSON for AI** - NO `\n` in DB text for AI (user-facing text can be multi-line)
6. **Component-Based** - Tools are like React components (props, state, pure)
7. **Security First** - Input validation, rate limiting, secret management
8. **Code Quality** - Linting, formatting, security scanning enforced

---

## 📦 Type Organization

### Rule: NO Inline Interfaces

**❌ WRONG - Inline interface (will be redefined everywhere)**

```typescript
// tools/memory/searchTool.ts
export async function searchMemories(params: {
  query: string;
  memoryTypes?: ('episodic' | 'semantic' | 'procedural')[];
  limit?: number;
}) {
  // ...
}

// tools/memory/storeTool.ts
export async function storeMemory(params: {
  content: string;
  memoryType: 'episodic' | 'semantic' | 'procedural';
}) {
  // ...
}
```

**✅ CORRECT - Centralized types**

```typescript
// types/memory.ts
export type MemoryType = 'episodic' | 'semantic' | 'procedural';

export interface MemorySearchParams {
  query: string;
  memoryTypes?: MemoryType[];
  limit?: number;
  minSimilarity?: number;
  persona?: string;
  project?: string;
  temporalBoost?: boolean;
}

export interface MemoryStoreParams {
  content: string;
  memoryType: MemoryType;
  sessionId?: string;
  persona?: string;
  project?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface Memory {
  id: string;
  content: string;
  summary?: string;
  memoryType: MemoryType;
  persona: string[];
  project: string[];
  tags: string[];
  relatedTo: string[];
  createdAt: string;
  updatedAt: string;
  embedding: number[];
  relevanceScore?: number;
}

// tools/memory/searchTool.ts
import type { MemorySearchParams, Memory } from '@/types/memory';

export async function searchMemories(params: MemorySearchParams): Promise<Memory[]> {
  // ...
}

// tools/memory/storeTool.ts
import type { MemoryStoreParams, Memory } from '@/types/memory';

export async function storeMemory(params: MemoryStoreParams): Promise<Memory> {
  // ...
}
```

### Type Package Structure

```
v2/src/types/
├── index.ts              # Re-exports all types
├── memory.ts             # Memory-related types
├── workflow.ts           # Workflow-related types
├── context.ts            # Context (persona/project) types
├── session.ts            # Session and state types
├── mcp.ts                # MCP tool types
├── database.ts           # Database schema types
├── api.ts                # API request/response types
└── utils.ts              # Utility types

# Usage in any file:
import type { Memory, MemoryType, MemorySearchParams } from '@/types/memory';
import type { Workflow, WorkflowStep } from '@/types/workflow';
import type { Session } from '@/types/session';
```

### Type Naming Conventions

```typescript
// Interfaces: PascalCase with descriptive names
interface MemorySearchParams {}
interface WorkflowExecutionResult {}
interface PersonaConfig {}

// Types: PascalCase for unions/primitives
type MemoryType = 'episodic' | 'semantic' | 'procedural';
type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed';
type SearchMode = 'vector' | 'keyword' | 'hybrid';

// Props interfaces: ComponentNameProps pattern
interface MemorySearchToolProps {
  query: string;
  limit: number;
}

// Result interfaces: ComponentNameResult pattern
interface MemorySearchResult {
  memories: Memory[];
  totalFound: number;
  searchTime: number;
}

// Generic types: Single capital letter or descriptive
type ToolResponse<T> = {
  success: boolean;
  data: T;
  error?: string;
};
```

### Required Type Exports

Every domain must export:

```typescript
// types/memory.ts
export type {
  // Core types
  Memory,
  MemoryType,

  // Params (inputs)
  MemorySearchParams,
  MemoryStoreParams,
  MemoryEvolveParams,

  // Results (outputs)
  MemorySearchResult,
  MemoryStoreResult,

  // Config
  MemoryConfig,
  TemporalDecayConfig,

  // Filters
  MemoryFilters,
  MemoryMetadata,
};

// types/index.ts (barrel export)
export * from './memory';
export * from './workflow';
export * from './context';
export * from './session';
export * from './mcp';
export * from './database';
export * from './api';
export * from './utils';
```

---

## 🔧 Tool Implementation Standards

### Component-Based Pattern

Every tool follows this pattern:

```typescript
// types/tools/memory.ts
export interface MemorySearchToolProps {
  query: string;
  memoryTypes?: MemoryType[];
  limit?: number;
  // ... all parameters
}

export interface MemorySearchToolResult {
  memories: Memory[];
  totalFound: number;
  searchTime: number;
}

// tools/memory/searchTool.ts
import type { MemorySearchToolProps, MemorySearchToolResult } from '@/types/tools/memory';
import { validateSingleLine } from '@/utils/validation';

/**
 * Search memories using hybrid vector + keyword retrieval
 *
 * @param props - Search parameters
 * @returns Ranked memories with relevance scores
 * @throws {ValidationError} If query contains newlines
 */
export async function memorySearch(
  props: MemorySearchToolProps
): Promise<MemorySearchToolResult> {
  // 1. Validate inputs (ALWAYS first)
  validateSingleLine(props.query, 'query');

  // 2. Apply defaults
  const limit = props.limit ?? 10;
  const memoryTypes = props.memoryTypes ?? ['episodic', 'semantic', 'procedural'];

  // 3. Perform operation
  const startTime = Date.now();
  const memories = await db.memories.search({
    query: props.query,
    memoryTypes,
    limit,
  });

  // 4. Validate outputs
  memories.forEach((memory) => {
    validateSingleLine(memory.content, 'memory.content');
  });

  // 5. Return structured result
  return {
    memories,
    totalFound: memories.length,
    searchTime: Date.now() - startTime,
  };
}

// 6. Export for MCP registration
export function registerMemorySearchTool(server: McpServer): void {
  server.tool(
    'memory.search',
    'Search memories using hybrid retrieval',
    memorySearchToolPropsSchema, // Zod schema from types
    async (props) => {
      const result = await memorySearch(props);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
  );
}
```

### Tool Pattern Checklist

Every tool MUST:

- [ ] Have typed props interface in `types/tools/`
- [ ] Have typed result interface in `types/tools/`
- [ ] Validate all string inputs with `validateSingleLine()`
- [ ] Validate all outputs with `validateSingleLine()`
- [ ] Have JSDoc comment explaining purpose
- [ ] Return structured result (not raw data)
- [ ] Export tool function and registration function separately
- [ ] Include unit tests with 100% coverage
- [ ] Handle errors gracefully
- [ ] Log operations for debugging

---

## 🚨 Critical Rules

### 1. Single-Line JSON for AI-Facing Data (MANDATORY)

**Rule: Text stored in DB for AI consumption must be single-line.**

**Where it applies:**
- ✅ Memory content (for embeddings)
- ✅ Workflow definitions (for AI parsing)
- ✅ Agent summaries (for retrieval)

**Where it does NOT apply:**
- ❌ User-facing messages (Telegram, web UI) - format nicely!
- ❌ Logs and debug output
- ❌ Documentation and comments
- ❌ Error messages to users

**Implementation:**

```typescript
// Utility function
function cleanForAI(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

// Before database storage (AI-facing)
await db.memories.insert({
  content: cleanForAI(userInput), // Single-line for AI
  summary: cleanForAI(summary),
});

// User-facing output (multi-line OK!)
await telegram.sendMessage({
  text: `Here are your ideas:
1. Gentle Rain
2. Storm Window
3. Rain Puddle`, // Multi-line for readability
});

// Logs (multi-line OK!)
logger.info(`Memory search completed:
  - Query: ${query}
  - Results: ${count}
  - Duration: ${duration}ms`);
```

### 2. No `any` Type

**❌ NEVER use `any`:**

```typescript
// WRONG
function process(data: any) {
  return data.value; // No type safety
}

// CORRECT
function process(data: unknown) {
  if (isRecord(data) && 'value' in data) {
    return data.value;
  }
  throw new Error('Invalid data structure');
}

// CORRECT - Use proper types
import type { Memory } from '@/types/memory';

function process(data: Memory) {
  return data.content; // Fully typed
}

// CORRECT - Use generics
function process<T extends { value: string }>(data: T) {
  return data.value; // Type-safe
}
```

### 3. No Inline Types in Function Signatures

```typescript
// ❌ WRONG - Inline type
export function search(params: {
  query: string;
  limit: number;
}): Promise<Array<{ id: string; content: string }>> {
  // ...
}

// ✅ CORRECT - Named types
import type { SearchParams, SearchResult } from '@/types';

export function search(params: SearchParams): Promise<SearchResult> {
  // ...
}
```

### 4. Import Type Declarations

```typescript
// ✅ Use 'import type' for type-only imports
import type { Memory, Workflow } from '@/types';
import { searchMemories } from '@/tools/memory';

// ❌ Don't mix types and values in one import
import { Memory, searchMemories } from '@/tools/memory';
```

---

## 📁 File Organization

### Project Structure

```
v2/
├── src/
│   ├── types/               # ALL type definitions
│   │   ├── index.ts
│   │   ├── memory.ts
│   │   ├── workflow.ts
│   │   ├── context.ts
│   │   ├── session.ts
│   │   ├── mcp.ts
│   │   ├── database.ts
│   │   ├── api.ts
│   │   └── utils.ts
│   ├── tools/               # MCP tool implementations
│   │   ├── memory/
│   │   │   ├── searchTool.ts
│   │   │   ├── searchTool.test.ts
│   │   │   ├── storeTool.ts
│   │   │   ├── storeTool.test.ts
│   │   │   └── index.ts
│   │   ├── context/
│   │   ├── workflow/
│   │   ├── docs/
│   │   └── index.ts
│   ├── db/                  # Database layer
│   │   ├── client.ts
│   │   ├── schema.ts
│   │   ├── migrations/
│   │   └── repositories/
│   ├── utils/               # Utility functions
│   │   ├── validation.ts    # validateSingleLine, etc.
│   │   ├── text.ts
│   │   ├── uuid.ts
│   │   └── index.ts
│   ├── config/              # Configuration
│   │   ├── database.ts
│   │   ├── server.ts
│   │   └── index.ts
│   └── server.ts            # Main entry point
├── tests/                   # All tests
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── scripts/                 # Utility scripts
│   ├── seed/
│   ├── migrate/
│   └── dev/
└── workflows/               # n8n workflows
    └── agent.workflow.json
```

### File Naming

```typescript
// Files: kebab-case
memory-search-tool.ts
workflow-executor.ts
session-manager.ts

// Test files: match source with .test.ts
memory-search-tool.test.ts
workflow-executor.test.ts

// Type files: singular noun
memory.ts  // not memories.ts
workflow.ts
session.ts

// Index files: barrel exports
index.ts

// Config files: descriptive
database.config.ts
server.config.ts
```

---

## 🎨 Code Style

### Function Declarations

```typescript
// ✅ CORRECT - Async function with proper types
export async function searchMemories(
  params: MemorySearchParams
): Promise<MemorySearchResult> {
  const { query, limit = 10, memoryTypes = ['episodic'] } = params;
  // ...
}

// ✅ CORRECT - Sync function
export function validateSingleLine(text: string, fieldName = 'text'): string {
  if (text.includes('\n')) {
    throw new ValidationError(`${fieldName} contains newlines`);
  }
  return text;
}

// ❌ WRONG - Arrow function for exported functions
export const searchMemories = async (params: MemorySearchParams) => {
  // Harder to debug, less clear intent
};
```

### Variable Declarations

```typescript
// ✅ Use const by default
const memories = await searchMemories(params);
const result = processMemories(memories);

// ✅ Use let when reassignment needed
let count = 0;
for (const item of items) {
  count += 1;
}

// ❌ Never use var
var x = 10; // Don't do this
```

### Destructuring

```typescript
// ✅ Destructure with defaults
const { query, limit = 10, memoryTypes = ['episodic'] } = params;

// ✅ Rename conflicting names
const { id: memoryId, content } = memory;

// ✅ Rest parameters
const { query, ...filters } = params;
```

### Error Handling

```typescript
// ✅ CORRECT - Custom error types
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DatabaseError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'DatabaseError';
  }
}

// ✅ CORRECT - Proper error handling
export async function searchMemories(
  params: MemorySearchParams
): Promise<MemorySearchResult> {
  try {
    validateSingleLine(params.query);
    const memories = await db.memories.search(params);
    return { memories, totalFound: memories.length };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error; // Re-throw validation errors
    }
    if (error instanceof Error) {
      throw new DatabaseError('Failed to search memories', error);
    }
    throw new DatabaseError('Unknown error during search');
  }
}

// ❌ WRONG - Swallowing errors
try {
  await doSomething();
} catch (error) {
  console.log(error); // Don't just log and continue
}

// ❌ WRONG - Generic catch without re-throw
try {
  await doSomething();
} catch (error) {
  return null; // Hides the error
}
```

---

## 📝 Comments and Documentation

### JSDoc for Public Functions

```typescript
/**
 * Search memories using hybrid vector + keyword retrieval
 *
 * Combines vector similarity search with keyword matching using
 * reciprocal rank fusion for optimal results.
 *
 * @param params - Search parameters
 * @param params.query - Search query (must be single-line)
 * @param params.limit - Maximum results to return (default: 10)
 * @param params.memoryTypes - Types of memories to search (default: all)
 * @returns Ranked memories with relevance scores
 * @throws {ValidationError} If query contains newlines
 * @throws {DatabaseError} If database operation fails
 *
 * @example
 * ```typescript
 * const result = await searchMemories({
 *   query: 'rain sounds AISMR',
 *   limit: 5,
 *   memoryTypes: ['episodic', 'procedural']
 * });
 * ```
 */
export async function searchMemories(
  params: MemorySearchParams
): Promise<MemorySearchResult> {
  // ...
}
```

### Inline Comments

```typescript
// ✅ GOOD - Explains WHY, not WHAT
// Use RRF to combine rankings from different search modes
// This prevents one mode from dominating results
const combined = reciprocalRankFusion([vectorResults, keywordResults]);

// ✅ GOOD - Warns about gotchas
// NOTE: This must run BEFORE embedding generation
// because the embedding service expects cleaned text
validateSingleLine(text);

// ❌ BAD - States the obvious
// Increment the counter
counter += 1;

// ❌ BAD - Commented-out code
// const oldWay = doSomethingOld(data);
const newWay = doSomething(data);
```

### TODO Comments

```typescript
// ✅ GOOD - Actionable TODO with context
// TODO(mylo): Add support for fuzzy matching when exact match fails
// See issue #123 for design discussion

// ❌ BAD - Vague TODO
// TODO: fix this
// TODO: make this better
```

---

## 🧪 Testing Standards

### Test File Organization

```typescript
// memory-search-tool.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { searchMemories } from './searchTool';
import type { MemorySearchParams } from '@/types/memory';

describe('searchMemories', () => {
  beforeEach(async () => {
    await db.reset();
    await db.seed.test();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('input validation', () => {
    it('should reject query with newlines', async () => {
      const params: MemorySearchParams = {
        query: 'line1\nline2',
      };

      await expect(searchMemories(params)).rejects.toThrow(
        'query contains newlines'
      );
    });

    it('should accept single-line query', async () => {
      const params: MemorySearchParams = {
        query: 'valid query',
      };

      const result = await searchMemories(params);
      expect(result).toBeDefined();
    });
  });

  describe('vector search', () => {
    it('should find semantically similar memories', async () => {
      // Test implementation
    });

    it('should respect similarity threshold', async () => {
      // Test implementation
    });
  });

  describe('output validation', () => {
    it('should return memories without newlines', async () => {
      const result = await searchMemories({ query: 'test' });

      result.memories.forEach((memory) => {
        expect(memory.content).not.toContain('\n');
      });
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      vi.spyOn(db, 'query').mockRejectedValue(new Error('DB down'));

      await expect(searchMemories({ query: 'test' })).rejects.toThrow(
        'Failed to search memories'
      );
    });
  });
});
```

### Test Coverage Requirements

- **80% coverage minimum** (enforced by CI)
- Focus on quality over quantity
- Critical paths: 95%+ coverage
- Business logic: 90%+ coverage
- Utility functions: 80%+ coverage
- Every error path tested
- Every edge case tested

---

## 🔍 Import Organization

### Import Order

```typescript
// 1. Node built-ins
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// 2. External packages
import { z } from 'zod';
import { eq } from 'drizzle-orm';

// 3. Internal types (type-only imports first)
import type { Memory, MemorySearchParams } from '@/types/memory';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// 4. Internal modules
import { db } from '@/db';
import { validateSingleLine } from '@/utils/validation';
import { embedText } from '@/utils/embedding';

// 5. Relative imports (avoid when possible)
import { helperFunction } from './helpers';
```

### Path Aliases

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@/types/*": ["./src/types/*"],
      "@/tools/*": ["./src/tools/*"],
      "@/db/*": ["./src/db/*"],
      "@/utils/*": ["./src/utils/*"]
    }
  }
}

// Usage
import type { Memory } from '@/types/memory';
import { searchMemories } from '@/tools/memory';
import { db } from '@/db';
import { validateSingleLine } from '@/utils/validation';
```

---

## 🎯 Naming Conventions

### Variables

```typescript
// ✅ camelCase for variables and functions
const memoryId = 'abc123';
const searchResults = await searchMemories(params);

// ✅ Descriptive names
const userSelectedIdea = ideas[selectionIndex];
const workflowExecutionTime = endTime - startTime;

// ❌ Single letters (except loop indices)
const m = await search(); // What is 'm'?
const r = process(data); // What is 'r'?

// ✅ OK for loop indices
for (let i = 0; i < items.length; i++) {
  // OK in this context
}

// ✅ Boolean names should be questions
const isValid = validate(input);
const hasNewlines = text.includes('\n');
const canExecute = checkPermissions(user);
```

### Functions

```typescript
// ✅ Verbs for functions that do things
function validateSingleLine(text: string): string {}
function searchMemories(params: SearchParams): Promise<Memory[]> {}
function executeWorkflow(workflow: Workflow): Promise<Result> {}

// ✅ 'get' prefix for simple retrieval
function getMemoryById(id: string): Memory | null {}
function getSession(sessionId: string): Session {}

// ✅ 'find' prefix for search operations
function findMemories(query: string): Memory[] {}
function findWorkflowByIntent(intent: string): Workflow | null {}

// ✅ 'create' prefix for construction
function createSession(userId: string): Session {}
function createMemory(content: string): Memory {}

// ✅ Boolean functions start with 'is', 'has', 'can', 'should'
function isValidQuery(query: string): boolean {}
function hasNewlines(text: string): boolean {}
function canExecuteWorkflow(workflow: Workflow): boolean {}
```

### Constants

```typescript
// ✅ SCREAMING_SNAKE_CASE for true constants
const MAX_SEARCH_RESULTS = 100;
const DEFAULT_MEMORY_TYPES = ['episodic', 'semantic', 'procedural'];
const API_BASE_URL = 'https://api.example.com';

// ✅ Regular camelCase for config objects
const databaseConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432'),
};
```

---

## 🏗️ Architecture Patterns

### Dependency Injection

```typescript
// ✅ CORRECT - Dependencies injectable for testing
export function createMemorySearchTool(deps: {
  db: Database;
  embedder: Embedder;
  validator: Validator;
}) {
  return async function searchMemories(
    params: MemorySearchParams
  ): Promise<MemorySearchResult> {
    deps.validator.validateSingleLine(params.query);
    const embedding = await deps.embedder.embed(params.query);
    return deps.db.search(embedding, params);
  };
}

// Usage
const searchMemories = createMemorySearchTool({
  db: database,
  embedder: openaiEmbedder,
  validator: textValidator,
});

// Testing
const mockDb = createMockDatabase();
const testSearchMemories = createMemorySearchTool({
  db: mockDb,
  embedder: mockEmbedder,
  validator: mockValidator,
});
```

### Repository Pattern

```typescript
// db/repositories/memory-repository.ts
export class MemoryRepository {
  constructor(private db: Database) {}

  async search(params: MemorySearchParams): Promise<Memory[]> {
    // Database-specific logic
  }

  async insert(memory: NewMemory): Promise<Memory> {
    // Database-specific logic
  }

  async update(id: string, updates: Partial<Memory>): Promise<Memory> {
    // Database-specific logic
  }
}

// tools/memory/searchTool.ts
export async function searchMemories(
  params: MemorySearchParams
): Promise<MemorySearchResult> {
  const repository = new MemoryRepository(db);
  const memories = await repository.search(params);
  return { memories, totalFound: memories.length };
}
```

---

## 🔒 Code Quality & Security

### Linting Configuration

**ESLint Setup:**

```json
// eslint.config.mjs
export default [
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];
```

**Enforcement:**

```json
// package.json
{
  "scripts": {
    "lint": "eslint . --max-warnings=0",
    "lint:fix": "eslint . --fix"
  }
}
```

### Formatting Configuration

**Prettier Setup:**

```json
// .prettierrc
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

**Enforcement:**

```json
// package.json
{
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

### Security Requirements

**1. Input Validation:**

```typescript
import { z } from 'zod';

// Validate all external inputs
const UserInputSchema = z.object({
  query: z.string().min(1).max(1000), // Prevent attacks
  limit: z.number().min(1).max(100),
  sessionId: z.string().uuid(),
});

export function handleUserInput(input: unknown) {
  const validated = UserInputSchema.parse(input);
  // Now safe to use
}
```

**2. Secret Management:**

```typescript
// config/secrets.ts
import { z } from 'zod';

const SecretsSchema = z.object({
  DB_PASSWORD: z.string().min(16),
  OPENAI_API_KEY: z.string().startsWith('sk-'),
  MCP_AUTH_KEY: z.string().uuid(),
});

// Validate on startup
export const secrets = SecretsSchema.parse(process.env);
```

```bash
# .env (NEVER commit)
DB_PASSWORD=<secure-password>
OPENAI_API_KEY=<openai-key>
MCP_AUTH_KEY=<random-uuid>

# .gitignore (MUST include)
.env
.env.local
.env.*.local
```

**3. Security Scanning:**

```json
// package.json
{
  "scripts": {
    "audit": "npm audit --audit-level=moderate",
    "audit:fix": "npm audit fix"
  }
}
```

**4. Rate Limiting:**

```typescript
import rateLimit from '@fastify/rate-limit';

app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});
```

**5. Authentication:**

```typescript
// Middleware for MCP server
app.addHook('onRequest', async (request, reply) => {
  const authKey = request.headers['x-api-key'];

  if (authKey !== process.env.MCP_AUTH_KEY) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});
```

### CI/CD Integration

**GitHub Actions Workflow:**

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run type-check

      - name: Lint (no warnings)
        run: npm run lint

      - name: Format check
        run: npm run format:check

      - name: Security audit
        run: npm audit --audit-level=moderate

      - name: Run tests
        run: npm test

      - name: Check coverage (80%+)
        run: npm run test:coverage
```

---

## ✅ Pre-Commit Checklist

Before committing, ensure:

- [ ] **Types**: No inline interfaces, all types in `types/` package
- [ ] **Single-Line AI Data**: DB text for AI cleaned with `cleanForAI()`
- [ ] **User-Facing Text**: Formatted nicely (multi-line OK)
- [ ] **No `any`**: Zero uses of `any` type
- [ ] **Imports**: Type-only imports use `import type`
- [ ] **Tests**: 80%+ coverage, all tests pass
- [ ] **Linting**: `npm run lint` passes (max warnings=0)
- [ ] **Type Check**: `npm run type-check` passes
- [ ] **Formatting**: `npm run format` applied
- [ ] **Security**: `npm audit` passes (no moderate+ vulnerabilities)
- [ ] **Documentation**: JSDoc for all public functions
- [ ] **No Console**: No `console.log` in production code
- [ ] **Error Handling**: All errors properly typed and thrown
- [ ] **Secrets**: No secrets in code, all in `.env`

---

## 🚀 Quick Reference

### Type Definition Template

```typescript
// types/my-feature.ts
export type MyType = 'option1' | 'option2';

export interface MyFeatureParams {
  required: string;
  optional?: number;
}

export interface MyFeatureResult {
  success: boolean;
  data: unknown;
}

export type { MyFeatureParams, MyFeatureResult };
```

### Tool Implementation Template

```typescript
// tools/my-feature/myTool.ts
import type { MyFeatureParams, MyFeatureResult } from '@/types/my-feature';
import { validateSingleLine } from '@/utils/validation';

/**
 * Brief description of what this tool does
 *
 * @param params - Tool parameters
 * @returns Result object
 * @throws {ValidationError} If validation fails
 */
export async function myTool(
  params: MyFeatureParams
): Promise<MyFeatureResult> {
  // 1. Validate inputs
  validateSingleLine(params.required);

  // 2. Apply defaults
  const optional = params.optional ?? 10;

  // 3. Perform operation
  const data = await performOperation(params.required, optional);

  // 4. Validate outputs
  if (typeof data === 'string') {
    validateSingleLine(data);
  }

  // 5. Return structured result
  return {
    success: true,
    data,
  };
}

export function registerMyTool(server: McpServer): void {
  server.tool('my.tool', 'Tool description', myToolSchema, async (params) => {
    const result = await myTool(params);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  });
}
```

### Test Template

```typescript
// tools/my-feature/myTool.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { myTool } from './myTool';
import type { MyFeatureParams } from '@/types/my-feature';

describe('myTool', () => {
  beforeEach(async () => {
    await db.reset();
  });

  describe('input validation', () => {
    it('should reject input with newlines', async () => {
      const params: MyFeatureParams = { required: 'bad\ninput' };
      await expect(myTool(params)).rejects.toThrow('contains newlines');
    });
  });

  describe('functionality', () => {
    it('should perform expected operation', async () => {
      const params: MyFeatureParams = { required: 'valid input' };
      const result = await myTool(params);
      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      // Test error paths
    });
  });
});
```

---

## 📚 Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Documentation](https://vitest.dev/)
- [Zod Documentation](https://zod.dev/)
- [Drizzle ORM](https://orm.drizzle.team/)
- V2 PLAN.md - Overall architecture
- V2 NORTH_STAR.md - Happy path examples

---

**Remember: Consistency is more important than perfection. Follow these standards, and our codebase will remain clean, maintainable, and a joy to work with.** ✨
