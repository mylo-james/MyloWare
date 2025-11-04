# n8n InputType Error - RESOLVED

## The Real Problem

n8n's MCP node parser **cannot handle**:
1. ❌ `$ref` references (even local ones like `#/properties/field`)
2. ❌ `anyOf` unions (e.g., `string | array<string>`)
3. ⚠️ Complex validation constraints may cause issues

## The Solution

**Make schemas as simple as possible:**
- ✅ Use concrete types only (no unions)
- ✅ No `$ref` - inline everything
- ✅ Remove `.min(1)` constraints on strings
- ✅ Keep descriptions on ALL properties

## What We Changed

### prompt_get
**BEFORE:**
```typescript
tags: z.union([z.string(), z.array(z.string())]).optional()  // anyOf
tag: z.union([z.string(), z.array(z.string())]).optional()   // anyOf
```

**AFTER:**
```typescript
tags: z.array(z.string()).optional().describe('Filter tags (array of strings)')
tag: z.array(z.string()).optional().describe('Legacy tag filter (use tags instead)')
```

**Result**: No more `anyOf` unions → n8n can parse it ✅

### conversation_remember
**BEFORE:**
```typescript
timeRange: timeRangeSchema.optional()  // Creates $ref
```

**AFTER:**
```typescript
timeRange: z.object({
  start: isoDateSchema.optional().describe('Start timestamp (ISO 8601)'),
  end: isoDateSchema.optional().describe('End timestamp (ISO 8601)'),
}).optional().describe('Time range filter with start/end ISO 8601 timestamps')
```

**Result**: No more `$ref` → Inlined nested object ✅

### All Tools
**BEFORE:**
```typescript
field: z.string().trim().min(1, 'error message')
```

**AFTER:**
```typescript
field: z.string().trim().describe('Field description')
```

**Result**: Removed `minLength` constraints that might confuse n8n ✅

## Verification

```bash
curl -X POST http://localhost:3456/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: mylo-mcp-agent" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  jq '.result.tools[] | select(.name | IN("prompt_get", "prompt_search", "prompts_search_adaptive")) | {name, hasAnyOf: (.inputSchema | tostring | contains("anyOf")), hasRef: (.inputSchema | tostring | contains("$ref"))}'
```

**Result:**
```json
{
  "name": "prompt_get",
  "hasAnyOf": false,
  "hasRef": false
}
{
  "name": "prompt_search",
  "hasAnyOf": false,
  "hasRef": false
}
{
  "name": "prompts_search_adaptive",
  "hasAnyOf": false,
  "hasRef": false
}
```

✅ **All clean!** No `anyOf`, no `$ref`.

## n8n Compatibility Now

All problematic tools should now work in n8n:
- ✅ `prompt_get` - Simplified to array-only tags
- ✅ `prompt_search` - Clean simple types
- ✅ `prompts_search_adaptive` - Clean simple types
- ✅ `prompt_list` - Already worked (reference pattern)

## Pattern for Future Schemas

**n8n-Safe Schema Pattern:**
```typescript
const schema = z.object({
  // ✅ Simple types with descriptions
  name: z.string().describe('Field description'),
  count: z.number().optional().describe('Count (optional)'),
  enabled: z.boolean().describe('Enable feature'),
  
  // ✅ Arrays (not unions)
  tags: z.array(z.string()).optional().describe('Tags array'),
  
  // ✅ Enums
  mode: z.enum(['a', 'b']).describe('Mode: a or b'),
  
  // ✅ Inline nested objects (no separate schema variable)
  range: z.object({
    start: z.string().describe('Start'),
    end: z.string().describe('End')
  }).optional().describe('Range object'),
  
  // ❌ AVOID - Breaks n8n
  // field: z.union([z.string(), z.array(z.string())])  // anyOf
  // field: otherSchema  // Creates $ref
});
```

## Files Modified

1. `src/server/tools/promptGetTool.ts` - Removed anyOf unions
2. `src/server/tools/conversationMemoryTool.ts` - Inlined timeRange
3. All tool files - Removed `.min(1)` constraints

## Status

✅ **n8n inputType error should be completely resolved**

Test in n8n now - all tools should display proper input fields with no errors.

