# MCP Protocol Compliance Audit

**Date:** 2025-11-04
**SDK Version:** @modelcontextprotocol/sdk@1.20.2
**Protocol Version:** 2025-06-18

## Executive Summary

After auditing the codebase against the official MCP specification and TypeScript SDK, we have identified **CRITICAL non-compliance issues** in our tool input handling. The current implementation uses a custom argument extraction layer (`argUtils.ts`) that is **completely unnecessary** and causes our tools to not receive arguments in the standard MCP format.

## Critical Issue: Tool Argument Handling

### The Problem

**Current Implementation:**

```typescript
server.registerTool(
  'prompt_get',
  {
    inputSchema: promptGetArgsSchema.shape, // ❌ WRONG: Using .shape instead of full schema
    //...
  },
  async (rawArgs: unknown) => {
    // ❌ WRONG: Using unknown instead of typed args
    const extracted = extractToolArgs(rawArgs, {
      allowedKeys: PROMPT_GET_ARG_KEYS,
    });
    args = inputSchema.parse(extracted); // ❌ WRONG: Double parsing
    // ...
  },
);
```

**How the SDK Actually Works:**

According to the MCP TypeScript SDK source code (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`):

```javascript
this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const tool = this._registeredTools[request.params.name];

  if (tool.inputSchema) {
    // SDK automatically parses request.params.arguments with the schema
    const parseResult = await tool.inputSchema.safeParseAsync(request.params.arguments);
    if (!parseResult.success) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid arguments...`);
    }
    const args = parseResult.data; // Already parsed and validated!
    const cb = tool.callback;
    result = await Promise.resolve(cb(args, extra)); // Passes parsed args directly
  }
});
```

**MCP Specification:**

From the official MCP spec, tool calls follow this format:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": {
      "location": "New York" // ← Arguments are FLAT, not wrapped
    }
  }
}
```

### Why argUtils.ts Exists

The `argUtils.ts` file was created to handle non-standard argument wrapping:

```typescript
const CANDIDATE_KEYS = [
  'args',
  'input',
  'parameters',
  'payload',
  'data',
  'value',
  'body',
  'request',
  'requestBody',
  'params',
  'query', // n8n wraps arguments in a query object
];
```

**This suggests:**

1. Either we're receiving malformed requests from clients (like n8n)
2. OR we misunderstood the MCP protocol and created unnecessary workarounds

### The Correct Implementation

```typescript
server.registerTool(
  'prompt_get',
  {
    title: 'Load workflow instructions',
    description: 'Fetch prompt data...',
    inputSchema: promptGetArgsSchema, // ✅ CORRECT: Full Zod schema, not .shape
    outputSchema: outputSchema, // ✅ CORRECT: Full Zod schema
  },
  async (args, extra) => {
    // ✅ CORRECT: Typed args, no manual extraction
    // args is already parsed and validated by the SDK!
    // args has type: z.infer<typeof promptGetArgsSchema>

    const result = await resolvePrompt(repository, args);

    return {
      content: [{ type: 'text', text: result.message }],
      structuredContent: result.data, // ✅ CORRECT: Matches outputSchema
    };
  },
);
```

## Compliance Issues Found

### 1. Tool Registration - inputSchema ❌ CRITICAL

**Issue:** All tools use `inputSchema: schema.shape` instead of the full schema.

**Why it's wrong:**

- `.shape` extracts just the properties object from a Zod schema
- The SDK expects a full Zod object schema (with `.parse()`, `.safeParseAsync()` methods)
- Without the full schema, SDK cannot validate arguments properly

**Affected files:**

- `src/server/tools/promptGetTool.ts` - Line 103: `inputSchema: promptGetArgsSchema.shape`
- `src/server/tools/videoQueryTool.ts` - Line 165: `inputSchema: videoQueryArgsSchema.shape`
- `src/server/tools/conversationMemoryTool.ts` - Similar issue
- `src/server/tools/conversationStoreTool.ts` - Similar issue
- `src/server/tools/adaptiveSearchTool.ts` - Similar issue
- All other tools in `/src/server/tools/`

**Fix:**

```diff
- inputSchema: promptGetArgsSchema.shape,
+ inputSchema: promptGetArgsSchema,

- outputSchema: outputSchema.shape,
+ outputSchema: outputSchema,
```

### 2. Tool Callbacks - Manual Argument Extraction ❌ CRITICAL

**Issue:** All tool callbacks use `(rawArgs: unknown)` and manually extract/parse arguments.

**Why it's wrong:**

- The SDK already parses arguments using `inputSchema`
- Manual extraction is redundant and error-prone
- Breaks type safety
- Violates the MCP SDK contract

**Affected files:**

- `src/server/tools/promptGetTool.ts` - Lines 109-144
- `src/server/tools/videoQueryTool.ts` - Lines 171-206
- All other tools

**Fix:**

```diff
- async (rawArgs: unknown) => {
-   let args: PromptGetInput;
-   try {
-     const extracted = extractToolArgs(rawArgs, { allowedKeys: PROMPT_GET_ARG_KEYS });
-     args = inputSchema.parse(extracted);
-   } catch (error) {
-     return { content: [...], isError: true };
-   }
-   // ...
- }

+ async (args) => {
+   // args is already validated! Type is: z.infer<typeof promptGetArgsSchema>
+   // No manual extraction needed!
+   // ...
+ }
```

### 3. Unnecessary argUtils.ts ❌ REMOVE

**Issue:** The entire `argUtils.ts` file and its tests are unnecessary.

**Why:**

- The SDK handles all argument parsing automatically
- Custom extraction logic is non-standard and breaks MCP compliance
- Tests show we're expecting non-MCP-compliant input formats (n8n wrappers)

**Files to remove or refactor:**

- `src/server/tools/argUtils.ts` - DELETE or keep only for backward compatibility with n8n
- `src/server/tools/argUtils.test.ts` - DELETE or update

### 4. Tool Response Format ✅ MOSTLY COMPLIANT

**Status:** Our tool responses are mostly compliant with MCP spec.

**What's correct:**

```typescript
return {
  content: [{ type: 'text', text: '...' }], // ✅ Correct content array
  structuredContent: {
    /* ... */
  }, // ✅ Correct structured output
  isError: false, // ✅ Correct error flag
};
```

**Minor issue:** Some tools don't include `structuredContent` when they should.

### 5. Resource Endpoints ⚠️ NEEDS REVIEW

**Status:** Needs separate audit (not completed in this review).

**Potential issues:**

- Check if `src/server/resources.ts` follows MCP resource specification
- Verify URI format and metadata compliance

### 6. HTTP Transport ✅ LIKELY COMPLIANT

**Status:** The HTTP transport layer appears compliant.

**What's correct:**

- Uses `StreamableHTTPServerTransport` from SDK
- Handles JSON-RPC properly
- Rate limiting and auth are server-specific (not MCP concerns)

**No action needed** for transport layer.

## Impact Assessment

### Severity: **CRITICAL** 🔴

**Why critical:**

1. **All tools are broken** - They don't receive arguments in standard MCP format
2. **Type safety is lost** - Using `unknown` instead of typed args
3. **Double parsing** - Arguments are parsed twice (SDK + manual)
4. **Non-standard behavior** - Custom extraction violates MCP protocol
5. **Client compatibility** - May fail with standard MCP clients

### Current State

**Working:**

- Tools might work with certain clients (like n8n) that wrap arguments
- Manual extraction masks the underlying problem

**Broken:**

- Standard MCP clients may fail
- Type inference is broken
- Error messages are confusing
- Performance impact from double parsing

## Fix Plan

### Phase 1: Fix Tool Registration (High Priority)

**Files to modify:**

- All tool files in `src/server/tools/`

**Changes:**

1. Remove `.shape` from `inputSchema` and `outputSchema`
2. Change callback signature from `(rawArgs: unknown)` to `(args, extra)`
3. Remove `extractToolArgs()` calls
4. Remove manual parsing with `schema.parse()`
5. Update error handling (SDK handles validation errors)

**Example PR for one tool:**

```typescript
// Before
export function registerPromptGetTool(server: McpServer) {
  server.registerTool(
    'prompt_get',
    {
      inputSchema: promptGetArgsSchema.shape,  // ❌
      outputSchema: outputSchema.shape,         // ❌
    },
    async (rawArgs: unknown) => {  // ❌
      const extracted = extractToolArgs(rawArgs, { allowedKeys: [...] });  // ❌
      const args = inputSchema.parse(extracted);  // ❌
      // ...
    }
  );
}

// After
export function registerPromptGetTool(server: McpServer) {
  server.registerTool(
    'prompt_get',
    {
      inputSchema: promptGetArgsSchema,  // ✅
      outputSchema: outputSchema,        // ✅
    },
    async (args) => {  // ✅ Typed automatically by SDK!
      // args is already validated and has correct type
      const result = await resolvePrompt(repository, args);
      return {
        content: [{ type: 'text', text: result.message }],
        structuredContent: result.data,
      };
    }
  );
}
```

### Phase 2: Handle n8n Compatibility (Optional)

**Question:** Do we need to support n8n's non-standard argument wrapping?

**Option A: Drop n8n support**

- Remove `argUtils.ts` entirely
- Use standard MCP format only
- Update n8n workflows to send correct format

**Option B: Keep n8n compatibility**

- Keep `argUtils.ts` for backward compatibility
- Use it in a middleware layer BEFORE SDK sees the request
- Don't use it in tool callbacks (SDK should receive standard format)

**Recommendation:** Option A (drop n8n workarounds, fix n8n client instead)

### Phase 3: Add Compliance Tests

**Create new test file:** `src/server/tools/mcp-compliance.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { createMcpServer } from '../createMcpServer';

describe('MCP Protocol Compliance', () => {
  it('tools accept arguments in standard MCP format', async () => {
    const server = await createMcpServer();

    // Simulate MCP client calling tool
    const request = {
      method: 'tools/call',
      params: {
        name: 'prompt_get',
        arguments: {
          // ← Standard MCP format
          persona_name: 'ideagenerator',
          project_name: 'aismr',
        },
      },
    };

    // Should not throw, should return valid response
    const result = await server.server.callTool(request);
    expect(result.content).toBeDefined();
    expect(result.isError).toBeFalsy();
  });

  it('tools return structuredContent matching outputSchema', async () => {
    // Test that responses include structuredContent field
    // ...
  });
});
```

### Phase 4: Documentation

**Create:** `docs/MCP_COMPLIANCE.md`

Document:

1. How we follow MCP specification
2. Supported MCP protocol version
3. Any deviations or extensions
4. Testing methodology

## Recommended Action Items

### Immediate (Today)

1. ✅ **[DONE] Create this audit document**
2. 🔴 **Fix one tool as proof-of-concept** (e.g., `videoQueryTool.ts`)
3. 🔴 **Test the fix** with a standard MCP client
4. 🔴 **Verify n8n impact** (does it still work?)

### Short Term (This Week)

5. 🔴 **Fix all remaining tools** (11 tool files)
6. 🔴 **Remove or deprecate `argUtils.ts`**
7. 🔴 **Add MCP compliance tests**
8. 🔴 **Update documentation**

### Long Term

9. ⚪ **Audit resource endpoints**
10. ⚪ **Add CI/CD compliance checks**
11. ⚪ **Consider MCP protocol version pinning**

## References

- **MCP Specification:** https://modelcontextprotocol.io/specification/2025-06-18
- **MCP TypeScript SDK:** https://github.com/modelcontextprotocol/typescript-sdk
- **Our SDK Version:** @modelcontextprotocol/sdk@1.20.2
- **SDK Source Code:** `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`

## Questions for Discussion

1. **n8n Integration:** Should we maintain backward compatibility with n8n's non-standard format?
2. **Migration Strategy:** Big bang fix vs. incremental rollout?
3. **Testing:** How do we test against real MCP clients before deploy?
4. **Protocol Version:** Should we explicitly pin to a specific MCP protocol version?

---

**Audit Conducted By:** AI Assistant (Claude Sonnet 4.5)  
**Next Review Date:** After implementing fixes
