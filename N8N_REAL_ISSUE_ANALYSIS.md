# n8n MCP Integration - Root Cause Analysis

## Executive Summary

**NONE of the documented fixes were actually applied to the codebase.**

The archived documentation claims fixes were made, but the actual code contradicts this:

### Documented "Fixes" vs Reality

| Document | Claims | Reality | Status |
|----------|--------|---------|--------|
| ARGUMENT_WRAPPER_FIX.md | Added 'query' to CANDIDATE_KEYS | `query` was NOT in argUtils.ts | ❌ **JUST FIXED** |
| MCP_N8N_COMPLIANCE_FINAL.md | Added `.describe()` to all 97 properties | **Zero** `.describe()` calls in tools | ❌ **NOT APPLIED** |
| N8N_FIX_FINAL.md | Removed anyOf unions, inlined schemas | Nested objects still present | ❌ **NOT APPLIED** |

## The Real Problem

### Why prompt_list and video_query Work

**prompt_list schema:**
```typescript
z.object({
  persona: z.string().trim().optional(),      // Simple optional string
  project: z.string().trim().optional(),      // Simple optional string
  type: z.string().trim().optional()          // Simple optional string
})
```

**video_query schema:**
```typescript
z.object({
  idea: z.string().trim().min(1),             // Simple required string
  fuzzyMatch: z.boolean().optional()          // Simple optional boolean
})
```

✅ **Characteristics:**
- All flat, simple types (string, boolean)
- No nested objects
- No complex arrays
- No unions (anyOf)
- n8n can parse these with zero descriptions

### Why Everything Else Breaks

**memory_add schema:**
```typescript
z.object({
  content: z.string(),
  memoryType: z.enum([...]),
  actor: z.object({                         ← NESTED OBJECT - n8n CANNOT PARSE
    type: z.enum([...]),
    id: z.string(),
    scopes: z.array(z.string())
  }),
  metadata: z.record(z.string(), z.unknown()),  ← RECORD TYPE - n8n CANNOT PARSE
  relatedChunkIds: z.array(z.string()),     ← COMPLEX ARRAY - MAY FAIL
  // ... more complex fields
})
```

**conversation_store schema:**
```typescript
z.object({
  role: z.enum([...]),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()),  ← RECORD TYPE - n8n CANNOT PARSE
  summary: z.record(z.string(), z.unknown()),   ← RECORD TYPE - n8n CANNOT PARSE
  tags: z.array(z.string()),
  // ... more fields
})
```

**prompt_get schema:**
```typescript
z.object({
  project_name: z.string().optional(),
  persona_name: z.string().optional(),
  tags: z.union([z.string(), z.array(z.string())]),  ← anyOf UNION - n8n CANNOT PARSE
  tag: z.union([z.string(), z.array(z.string())])    ← anyOf UNION - n8n CANNOT PARSE
})
```

❌ **Characteristics that BREAK n8n:**
1. **Nested objects** (`actor: z.object({...})`)
2. **Record types** (`z.record(z.string(), z.unknown())`)
3. **Union types** (`z.union([...])` → becomes `anyOf` in JSON Schema)
4. **Complex array validation** with constraints

## n8n's MCP Parser Limitations (Confirmed)

From N8N_COMPATIBILITY_REALITY.md (which accurately describes the problem):

### ✅ What n8n CAN Parse:
```json
{
  "type": "object",
  "properties": {
    "simpleString": { "type": "string" },
    "simpleNumber": { "type": "number" },
    "simpleBoolean": { "type": "boolean" },
    "simpleEnum": { "type": "string", "enum": ["a", "b"] }
  }
}
```

### ❌ What n8n CANNOT Parse:
```json
{
  "type": "object",
  "properties": {
    "nestedObject": {
      "type": "object",
      "properties": {...}     ← BREAKS n8n
    },
    "recordType": {
      "type": "object",
      "additionalProperties": true  ← BREAKS n8n
    },
    "unionType": {
      "anyOf": [{...}, {...}] ← BREAKS n8n
    },
    "reference": {
      "$ref": "#/..."         ← BREAKS n8n
    }
  }
}
```

## The Actual Solution

### Option 1: Flatten ALL Schemas (Major Refactor)

Transform complex schemas to n8n-compatible format:

**BEFORE (memory_add):**
```typescript
actor: z.object({
  type: z.enum(['agent', 'user', 'system']),
  id: z.string(),
  scopes: z.array(z.string()).optional()
})
```

**AFTER (flattened):**
```typescript
actorType: z.enum(['agent', 'user', 'system']).describe('Actor type: agent, user, or system'),
actorId: z.string().describe('Unique actor identifier'),
actorScopes: z.string().optional().describe('Comma-separated actor scopes (optional)')
// Then reconstruct the nested object in extractToolArgs
```

**BEFORE (prompt_get):**
```typescript
tags: z.union([z.string(), z.array(z.string())]).optional()
```

**AFTER (single type):**
```typescript
tags: z.string().optional().describe('Comma-separated tags or single tag')
// Then parse and split in extractToolArgs
```

**BEFORE (conversation_store):**
```typescript
metadata: z.record(z.string(), z.unknown()).optional()
```

**AFTER (stringified):**
```typescript
metadata: z.string().optional().describe('JSON string of metadata object')
// Then JSON.parse in extractToolArgs
```

### Option 2: Create n8n-Specific Tool Wrappers

Keep existing tools, add simplified n8n-only versions:

```typescript
// Original: memory_add (full MCP, works in Claude)
export function registerMemoryAddTool(server) { /* complex schema */ }

// New: memory_add_simple (n8n-compatible)
export function registerMemoryAddToolSimple(server) {
  server.registerTool('memory_add_n8n', {
    inputSchema: z.object({
      content: z.string(),
      memoryType: z.enum(['persona', 'project', 'semantic']),
      actorType: z.enum(['agent', 'user', 'system']),
      actorId: z.string(),
      title: z.string().optional(),
      // ... all flattened
    }).shape,
  }, async (rawArgs) => {
    // Reconstruct nested structure
    const reconstructed = {
      content: rawArgs.content,
      memoryType: rawArgs.memoryType,
      actor: {
        type: rawArgs.actorType,
        id: rawArgs.actorId,
        scopes: rawArgs.actorScopes?.split(',').map(s => s.trim())
      },
      // ... rest of reconstruction
    };
    
    // Call original implementation
    return addMemory(reconstructed, dependencies);
  });
}
```

### Option 3: Use HTTP API Directly (Workaround)

Don't use n8n's MCP node at all:

```json
{
  "method": "POST",
  "url": "http://localhost:3456/mcp",
  "headers": {
    "Content-Type": "application/json",
    "x-api-key": "mylo-mcp-agent"
  },
  "body": {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "memory_add",
      "arguments": {
        "content": "Memory content",
        "memoryType": "semantic",
        "actor": {
          "type": "agent",
          "id": "n8n-workflow"
        }
      }
    }
  }
}
```

This bypasses n8n's broken MCP parser entirely.

## Recommended Action Plan

### Phase 1: Quick Fix (5 min)
1. ✅ **DONE**: Added 'query' and 'arguments' to argUtils CANDIDATE_KEYS
2. Test if this alone fixes some tools

### Phase 2: Flatten Critical Tools (2-3 hours)
Priority order based on n8n usage:
1. `prompt_get` - Remove unions, flatten to simple types
2. `memory_add` - Flatten actor object, stringify metadata
3. `conversation_store` - Flatten metadata/summary records
4. `prompt_search` - Remove nested objects, simplify arrays

### Phase 3: Documentation (30 min)
1. Update TOOL_SPEC_GUIDE.md with n8n limitations
2. Create N8N_SCHEMA_PATTERNS.md with working examples
3. Archive false fix documentation

### Phase 4: Testing (1 hour)
1. Test each flattened tool in actual n8n instance
2. Verify parameter parsing works
3. Verify tool execution succeeds
4. Document any remaining limitations

## Why This Happened

1. **Documentation drift**: Fixes were documented but never committed
2. **No tests**: No integration tests with actual n8n instance
3. **Wrong diagnosis**: Previous attempts focused on descriptions, not structure
4. **MCP SDK opacity**: Zod → JSON Schema conversion is automatic and opaque

## Verification Commands

### Check for nested objects in schemas:
```bash
grep -rn "z\.object({" src/server/tools/*.ts | grep -v "export const\|^const.*Schema"
```

### Check for unions:
```bash
grep -rn "z\.union\|anyOf" src/server/tools/*.ts
```

### Check for records:
```bash
grep -rn "z\.record(" src/server/tools/*.ts
```

### List tools by schema complexity:
```bash
# Simple (n8n compatible):
# - prompt_list: All optional strings
# - video_query: Simple string + boolean

# Moderate (may work with flattening):
# - prompt_get: Has unions
# - conversation_latest: Simple types but may have issues

# Complex (definitely broken):
# - memory_add: Nested actor object
# - conversation_store: Multiple record types
# - prompt_search: Complex options
# - adaptive_search: 23 complex parameters
```

## Conclusion

The real issue isn't missing descriptions or the 'query' wrapper (though that was also missing). 

**The fundamental problem: n8n's MCP node has a primitive JSON Schema parser that can only handle flat, simple types.**

All documented fixes focused on symptoms, not the root cause. Tools need to be **dramatically simplified** to work with n8n's limitations, or we need to bypass n8n's MCP node entirely and use direct HTTP calls.

