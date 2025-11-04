# MCP Compliance Fixes - Summary

## What Was Wrong

Our MCP server implementation had **critical compliance issues** that prevented it from working correctly with standard MCP clients:

### 1. Using `.shape` instead of Full Zod Schemas

**Problem:**

```typescript
inputSchema: videoQueryArgsSchema.shape,  // ❌ WRONG
```

**Why it's wrong:**

- `.shape` extracts only the properties from a Zod schema
- The MCP SDK needs the full schema object (with `.parse()`, `.safeParseAsync()` methods)
- Without the full schema, the SDK cannot validate arguments

**Fix:**

```typescript
inputSchema: videoQueryArgsSchema,  // ✅ CORRECT
```

### 2. Manual Argument Extraction (argUtils.ts)

**Problem:**

```typescript
async (rawArgs: unknown) => {
  const extracted = extractToolArgs(rawArgs, { allowedKeys: [...] });
  const args = schema.parse(extracted);  // Double parsing!
  // ...
}
```

**Why it's wrong:**

- The SDK **automatically** parses and validates arguments using the `inputSchema`
- Manual extraction is redundant, error-prone, and breaks type safety
- We were parsing arguments twice (SDK + manual)
- The callback receives `unknown` instead of typed args

**Fix:**

```typescript
async (args) => {
  // ✅ args is already validated and typed!
  // args has type: z.infer<typeof videoQueryArgsSchema>
  // No extraction needed - SDK did it for us
  // ...
};
```

### 3. How the SDK Actually Works

From the MCP SDK source code:

```javascript
this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const tool = this._registeredTools[request.params.name];

  if (tool.inputSchema) {
    // SDK parses arguments with the schema
    const parseResult = await tool.inputSchema.safeParseAsync(request.params.arguments);
    if (!parseResult.success) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid arguments...`);
    }
    const args = parseResult.data; // ← Already parsed!
    const cb = tool.callback;
    result = await Promise.resolve(cb(args, extra)); // ← Passes typed args
  }
});
```

**Key takeaway:** The SDK receives `request.params.arguments` and parses it with `tool.inputSchema` before calling our callback.

## What Needs to be Fixed

### All Tool Files (12 files)

**Files to update:**

1. `src/server/tools/promptGetTool.ts`
2. `src/server/tools/promptListTool.ts`
3. `src/server/tools/promptSearchTool.ts`
4. `src/server/tools/adaptiveSearchTool.ts`
5. `src/server/tools/conversationMemoryTool.ts`
6. `src/server/tools/conversationStoreTool.ts`
7. `src/server/tools/conversationLatestTool.ts`
8. `src/server/tools/memoryAddTool.ts` (3 tools in this file)
9. `src/server/tools/videoQueryTool.ts`
10. `src/server/tools/videoIdeasTool.ts`

**For each file:**

1. Remove the `TOOL_ARG_KEYS` constant
2. Change `inputSchema: schema.shape` to `inputSchema: schema`
3. Change `outputSchema: schema.shape` to `outputSchema: schema`
4. Change callback signature from `async (rawArgs: unknown) =>` to `async (args) =>`
5. Remove `extractToolArgs()` call
6. Remove manual `schema.parse()` call
7. Remove the validation error handling (SDK handles it now)
8. Use `args` directly (it's already typed and validated)

### Example Diff

```diff
export function registerVideoQueryTool(server: McpServer) {
- const VIDEO_QUERY_ARG_KEYS = ['idea', 'fuzzyMatch'] as const;

  server.registerTool(
    'video_query',
    {
      title: 'Check if idea exists',
      description: '...',
-     inputSchema: videoQueryArgsSchema.shape,
+     inputSchema: videoQueryArgsSchema,
-     outputSchema: outputSchema.shape,
+     outputSchema: outputSchema,
      annotations: { category: 'videos' },
    },
-   async (rawArgs: unknown) => {
+   async (args) => {
-     let args: VideoQueryInput;
-     try {
-       const extracted = extractToolArgs(rawArgs, {
-         allowedKeys: VIDEO_QUERY_ARG_KEYS,
-       });
-       args = videoQueryArgsSchema.parse(extracted);
-     } catch (error) {
-       return {
-         content: [{ type: 'text', text: `Validation failed: ${error.message}` }],
-         isError: true,
-       };
-     }

+     // args is already validated! Type: z.infer<typeof videoQueryArgsSchema>
      try {
        const result = await queryVideos(repository, args);
        return {
          content: [{ type: 'text', text: summary }],
          structuredContent: result,
        };
      } catch (error) {
        // Handle business logic errors only
        return {
          content: [{ type: 'text', text: error.message }],
          isError: true,
        };
      }
    },
  );
}
```

### Files to Delete/Deprecate

1. **`src/server/tools/argUtils.ts`** - Delete (no longer needed)
2. **`src/server/tools/argUtils.test.ts`** - Delete (no longer needed)

**Reason:** The SDK handles all argument parsing. Custom extraction was a workaround for a misunderstanding of the MCP protocol.

## Benefits of Fixing This

### 1. MCP Standard Compliance ✅

- Works with any standard MCP client
- Follows official MCP specification
- No custom workarounds needed

### 2. Better Type Safety 🔒

```typescript
// Before: args is unknown
async (rawArgs: unknown) => {
  const args: any = extractToolArgs(rawArgs); // Type lost
  // ...
};

// After: args is fully typed
async (args) => {
  // Type: { idea: string; fuzzyMatch?: boolean }
  // TypeScript knows exactly what args contains!
  // Auto-completion works
  // Refactoring is safe
};
```

### 3. Simpler Code 🧹

- Remove ~150 lines of `argUtils.ts`
- Remove ~80 lines of `argUtils.test.ts`
- Remove extraction logic from all tool files
- Fewer places for bugs to hide

### 4. Better Performance ⚡

- No double parsing (was parsing twice: SDK + manual)
- No deep object traversal in `extractToolArgs()`
- Faster tool execution

### 5. Better Error Messages 🐛

```typescript
// Before: Custom error from extractToolArgs
'Unable to parse video_query arguments.';

// After: Clear Zod validation error from SDK
'Invalid arguments for tool video_query: idea is required and must be a non-empty string';
```

## Testing the Fix

### 1. Create a Test File

Create `src/server/tools/videoQueryTool.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerVideoQueryTool } from './videoQueryTool';

describe('videoQueryTool - MCP Compliance', () => {
  it('accepts arguments in standard MCP format', async () => {
    const mockRepo = {
      /* mock OperationsRepository */
    };
    const server = new McpServer({ name: 'test', version: '1.0.0' });

    registerVideoQueryTool(server, { repository: mockRepo });

    // Simulate how the SDK calls our tool
    const tools = server['_registeredTools'];
    const tool = tools['video_query'];

    // These args come directly from request.params.arguments
    const args = { idea: 'velvet puppy', fuzzyMatch: true };

    // SDK validates with inputSchema first
    const parseResult = await tool.inputSchema!.safeParseAsync(args);
    expect(parseResult.success).toBe(true);

    // Then calls our callback with validated args
    const result = await tool.callback(parseResult.data, {} as any);

    expect(result.content).toBeDefined();
    expect(result.structuredContent).toBeDefined();
  });

  it('SDK rejects invalid arguments', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    registerVideoQueryTool(server);

    const tools = server['_registeredTools'];
    const tool = tools['video_query'];

    // Missing required 'idea' field
    const invalidArgs = { fuzzyMatch: true };

    const parseResult = await tool.inputSchema!.safeParseAsync(invalidArgs);
    expect(parseResult.success).toBe(false);
    // SDK will throw McpError before calling our callback
  });
});
```

### 2. Manual Testing

```bash
# Start the server
npm run dev

# In another terminal, test with curl
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "video_query",
      "arguments": {
        "idea": "velvet puppy",
        "fuzzyMatch": true
      }
    }
  }'

# Should return:
# {
#   "jsonrpc": "2.0",
#   "id": 1,
#   "result": {
#     "content": [{"type": "text", "text": "No existing videos found..."}],
#     "structuredContent": {"exists": false, "matchedVideos": [], "confidence": "none"}
#   }
# }
```

## Migration Strategy

### Option 1: Big Bang (Recommended)

**Pros:**

- Get full compliance in one PR
- Easier to test everything together
- Clear before/after state

**Cons:**

- Large PR to review
- Higher risk if something breaks

**Steps:**

1. Create feature branch: `feature/mcp-compliance-fix`
2. Fix all 12 tool files in one commit
3. Delete `argUtils.ts` and `argUtils.test.ts`
4. Add compliance tests
5. Test thoroughly
6. Merge to main

### Option 2: Incremental

**Pros:**

- Smaller, easier-to-review PRs
- Lower risk per change
- Can test in production gradually

**Cons:**

- Multiple PRs to track
- Mixed compliance state during migration
- More coordination needed

**Steps:**

1. PR #1: Fix 3 tools (video_query, video_ideas, prompt_get)
2. PR #2: Fix 3 tools (prompt_list, prompt_search, adaptive_search)
3. PR #3: Fix remaining tools
4. PR #4: Delete argUtils files
5. PR #5: Add compliance tests

**Recommendation:** Option 1 (Big Bang) - The fixes are straightforward and mechanical.

## Rollback Plan

If something breaks after deploying:

### Quick Rollback

```bash
git revert <commit-hash>
git push origin main
```

### Investigation

1. Check logs for SDK validation errors
2. Check if any clients are sending non-standard format
3. Use git diff to see exactly what changed

### Temporary Fix

If n8n or another client is sending wrapped arguments:

1. Add middleware in `httpTransport.ts` to unwrap before SDK sees it
2. Keep tool code compliant with MCP spec
3. File issue with non-compliant client

## Next Steps

1. ✅ **[DONE] Create audit document** - `MCP_COMPLIANCE_AUDIT.md`
2. ✅ **[DONE] Create fixes summary** - This document
3. ✅ **[DONE] Create example fix** - `videoQueryTool.FIXED.ts`
4. 🔄 **Apply fixes to all tools** - Start with one, test, then do the rest
5. 🔄 **Add compliance tests**
6. 🔄 **Update documentation**
7. 🔄 **Deploy and monitor**

## Questions?

- **Q: Will this break n8n integration?**
  - A: Possibly. If n8n wraps arguments, we'll need to fix the n8n client or add pre-processing middleware.

- **Q: Why did we use argUtils.ts in the first place?**
  - A: Likely a misunderstanding of the MCP protocol. The SDK handles parsing, we don't need to.

- **Q: Is the HTTP transport compliant?**
  - A: Yes, we're using `StreamableHTTPServerTransport` from the SDK, which is compliant.

- **Q: What about resources and prompts?**
  - A: Need separate audit (not covered in this review).

---

**Created:** 2025-11-04  
**Status:** Ready for implementation  
**See also:** `MCP_COMPLIANCE_AUDIT.md`, `videoQueryTool.FIXED.ts`
