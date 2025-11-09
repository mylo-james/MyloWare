# Testing Guide

**Audience:** Contributors writing tests  
**Outcome:** Understand test strategy and patterns

---

## Overview

MyloWare uses Vitest for unit, integration, and E2E tests.

**Test philosophy:**
- Test behavior, not implementation
- Use real database (ephemeral containers)
- Mock external APIs only
- Aim for 50%+ coverage (interim), 80%+ long-term

---

## Test Types

### Unit Tests
**Purpose:** Test individual functions in isolation  
**Location:** `tests/unit/`  
**Run:** `npm run test:unit`

**Example:**
```typescript
describe('validateSingleLine', () => {
  it('should reject content with newlines', () => {
    expect(() => validateSingleLine('line1\nline2'))
      .toThrow('contains newlines');
  });

  it('should accept single-line content', () => {
    expect(validateSingleLine('valid content')).toBe('valid content');
  });
});
```

### Integration Tests
**Purpose:** Test component interactions  
**Location:** `tests/integration/`  
**Run:** `npm run test:integration`

**Example:**
```typescript
describe('Casey → Iggy handoff', () => {
  it('should coordinate via trace', async () => {
    const trace = await traceCreate({ projectId: 'aismr' });
    
    await handoffToAgent({
      traceId: trace.traceId,
      toAgent: 'iggy',
      instructions: 'Generate ideas'
    });
    
    const updated = await getTrace(trace.traceId);
    expect(updated.currentOwner).toBe('iggy');
  });
});
```

### E2E Tests
**Purpose:** Test complete workflows  
**Location:** `tests/e2e/`  
**Run:** `npm run test:e2e`

**Example:**
```typescript
describe('AISMR happy path', () => {
  it('should complete Casey → Quinn pipeline', async () => {
    // Trigger workflow
    // Verify each agent executes
    // Check final status is 'completed'
  });
});
```

---

## Test Database

### Ephemeral Container (Recommended)

```bash
TEST_DB_USE_CONTAINER=1 npm test
```

**How it works:**
1. Testcontainers starts `pgvector/pgvector:pg16`
2. Auto-discovers Docker socket (Colima/Docker Desktop)
3. Runs migrations via `drizzle-kit push`
4. Seeds test data
5. Resets Drizzle client to ephemeral DB
6. Tears down after tests

**Benefits:**
- No port conflicts
- Schema always in sync
- Works in CI and locally
- Self-contained

### Local Database (Alternative)

```bash
export TEST_DB_URL=postgresql://test:test@localhost:6543/mcp_v2_test
npm run test:unit:local
```

See [Development Guide](dev-guide.md) for setup.

---

## Writing Tests

### Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Component Name', () => {
  beforeEach(async () => {
    // Setup (runs before each test)
    await db.reset();
    await db.seed.test();
  });

  afterEach(() => {
    // Cleanup (runs after each test)
    vi.clearAllMocks();
  });

  describe('feature group', () => {
    it('should do expected behavior', async () => {
      // Arrange
      const input = { ... };
      
      // Act
      const result = await functionUnderTest(input);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.status).toBe('success');
    });
  });
});
```

### Naming Conventions

**Test files:** Match source with `.test.ts`
- `src/mcp/tools.ts` → `tests/unit/mcp/tools.test.ts`

**Test names:** Use "should" statements
- ✅ "should create trace with valid UUID"
- ✅ "should reject query with newlines"
- ❌ "creates trace" (not descriptive)
- ❌ "test validation" (too vague)

---

## Coverage Requirements

### Current (Interim)
- **Overall:** ≥50% line coverage
- **Critical paths:** ≥50%
- **MCP tools:** ≥50%
- **Repositories:** ≥50%

### Target (Epic 7)
- **Overall:** ≥80% line coverage
- **Critical paths:** ≥95%
- **MCP tools:** ≥90%
- **Repositories:** ≥90%

### Check Coverage

```bash
npm run test:coverage
```

---

## Mocking

### Mock External APIs

```typescript
import { vi } from 'vitest';

// Mock OpenAI
vi.mock('@/clients/openai', () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, ...]),
  summarize: vi.fn().mockResolvedValue('Summary'),
}));
```

### Don't Mock Internal

```typescript
// ❌ Don't mock database
vi.mock('@/db');

// ✅ Use real database (ephemeral)
import { db } from '@/db';
await db.memories.insert(...);
```

---

## Test Data

### Seed Test Data

```typescript
beforeEach(async () => {
  await db.reset();
  await db.seed.test();
});
```

Provides:
- Test personas (casey, iggy, riley)
- Test projects (aismr, genreact)
- Sample memories

### Custom Test Data

```typescript
const testMemory = await db.memories.insert({
  content: 'Test memory content',
  memoryType: 'episodic',
  persona: ['test'],
  project: ['test'],
  embedding: generateTestEmbedding(),
});
```

---

## Assertions

### Common Patterns

```typescript
// Existence
expect(result).toBeDefined();
expect(result).not.toBeNull();

// Equality
expect(result.status).toBe('active');
expect(result.traceId).toEqual(expectedId);

// Arrays
expect(result.memories).toHaveLength(12);
expect(result.tags).toContain('approved');

// Objects
expect(result).toMatchObject({
  status: 'active',
  currentOwner: 'iggy',
});

// Errors
await expect(fn()).rejects.toThrow('error message');
expect(() => fn()).toThrow(ValidationError);

// Async
await expect(asyncFn()).resolves.toBe(value);
```

---

## Performance Tests

**Location:** `tests/performance/`  
**Run:** `npm run test:perf`

**Example:**
```typescript
describe('Memory search performance', () => {
  it('should complete in < 100ms', async () => {
    const start = Date.now();
    
    await memorySearch({ query: 'test', limit: 10 });
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(100);
  });
});
```

---

## CI Integration

Tests run automatically on:
- Pull requests
- Commits to main
- Release tags

**GitHub Actions workflow:**
```yaml
- name: Run tests
  run: TEST_DB_USE_CONTAINER=1 npm test

- name: Check coverage
  run: TEST_DB_USE_CONTAINER=1 npm run test:coverage
```

---

## Validation

✅ All tests pass  
✅ Coverage ≥50% (interim target)  
✅ No flaky tests  
✅ Tests run in < 2 minutes  
✅ CI passes

---

## Best Practices

1. **Test behavior** - Not implementation details
2. **Use real DB** - Ephemeral containers, not mocks
3. **Clear names** - Describe expected behavior
4. **One assertion** - Per test (when possible)
5. **Fast tests** - Keep under 100ms per test
6. **No side effects** - Tests don't affect each other
7. **Deterministic** - Same result every time

---

## Next Steps

- [Development Guide](dev-guide.md) - Local development
- [Coding Standards](coding-standards.md) - Code quality
- [Run Integration Tests](../03-how-to/run-integration-tests.md) - Integration testing

---

## Troubleshooting

**Tests failing with "database not found"?**
- Ensure Docker is running
- Set `TEST_DB_USE_CONTAINER=1`
- Check Docker socket is accessible

**Tests timeout?**
- Increase timeout in test file
- Check database connection
- Verify test isn't waiting indefinitely

**Flaky tests?**
- Check for race conditions
- Verify cleanup in afterEach
- Use deterministic test data

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.

