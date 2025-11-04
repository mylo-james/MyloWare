# MCP Compliance - Quick Summary

## The Problem 🔴

**Our MCP server is NOT compliant with the official Model Context Protocol specification.**

### What's Wrong

All 12 tool implementations have the same critical issue:

```typescript
// ❌ WRONG (Current Code)
server.registerTool(
  'tool_name',
  {
    inputSchema: schema.shape, // ❌ Using .shape instead of full schema
    outputSchema: outputSchema.shape, // ❌ Using .shape instead of full schema
  },
  async (rawArgs: unknown) => {
    // ❌ Using unknown instead of typed args
    const extracted = extractToolArgs(rawArgs, {
      /* ... */
    }); // ❌ Manual extraction
    const args = schema.parse(extracted); // ❌ Manual parsing (double parsing!)
    // ...
  },
);
```

### Why It's Wrong

The MCP SDK **automatically** parses and validates tool arguments. We don't need to (and shouldn't) do it manually.

**How the SDK works:**

1. SDK receives `request.params.arguments` (flat JSON object)
2. SDK validates it against your `inputSchema` (Zod schema)
3. SDK passes **already validated** args to your callback
4. If validation fails, SDK throws error automatically

**We're doing:**

1. Ignoring SDK's validation (using `.shape` instead of full schema)
2. Manually extracting arguments from various wrapper keys
3. Manually parsing arguments again (double work!)
4. Losing type safety (using `unknown` instead of inferred types)

---

## The Fix ✅

### Simple 5-Step Fix (Per Tool)

```typescript
// ✅ CORRECT (Fixed Code)
server.registerTool(
  'tool_name',
  {
    inputSchema: schema, // ✅ Use full Zod schema
    outputSchema: outputSchema, // ✅ Use full Zod schema
  },
  async (args) => {
    // ✅ Typed args (SDK validates them)
    // args is already validated and typed!
    // Type: z.infer<typeof schema>
    // No extraction needed, no parsing needed!

    const result = await doWork(args);
    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: result, // ✅ Matches outputSchema
    };
  },
);
```

**That's it!** Remove manual extraction, remove manual parsing, trust the SDK.

---

## Why This Matters

### Current Problems

1. **Non-compliant** - Doesn't follow MCP specification
2. **Breaks with standard clients** - May not work with official MCP clients
3. **No type safety** - Using `unknown` instead of typed args
4. **Performance issue** - Parsing arguments twice
5. **Complex code** - Unnecessary `argUtils.ts` (~230 lines)
6. **Confusing errors** - Custom error messages instead of clear Zod errors

### After Fix

1. **100% MCP compliant** ✅
2. **Works with all standard clients** ✅
3. **Full type safety** ✅ - TypeScript knows exact arg types
4. **Better performance** ✅ - Single parse by SDK
5. **Simpler code** ✅ - Delete `argUtils.ts`
6. **Clear error messages** ✅ - Zod provides helpful errors

---

## Files to Change

### Tools to Fix (12 files)

1. `src/server/tools/promptGetTool.ts`
2. `src/server/tools/promptListTool.ts`
3. `src/server/tools/promptSearchTool.ts`
4. `src/server/tools/adaptiveSearchTool.ts`
5. `src/server/tools/conversationMemoryTool.ts`
6. `src/server/tools/conversationStoreTool.ts`
7. `src/server/tools/conversationLatestTool.ts`
8. `src/server/tools/memoryAddTool.ts`
9. `src/server/tools/videoQueryTool.ts`
10. `src/server/tools/videoIdeasTool.ts`

### Files to Delete

1. `src/server/tools/argUtils.ts` - No longer needed
2. `src/server/tools/argUtils.test.ts` - No longer needed

---

## Example: Before & After

### Before (NON-COMPLIANT)

```typescript
import { extractToolArgs } from './argUtils';

const VIDEO_QUERY_ARG_KEYS = ['idea', 'fuzzyMatch'] as const;

export function registerVideoQueryTool(server: McpServer) {
  server.registerTool(
    'video_query',
    {
      inputSchema: videoQueryArgsSchema.shape, // ❌
      outputSchema: outputSchema.shape, // ❌
    },
    async (rawArgs: unknown) => {
      // ❌
      let args: VideoQueryInput;

      // ❌ Manual extraction
      try {
        const extracted = extractToolArgs(rawArgs, {
          allowedKeys: VIDEO_QUERY_ARG_KEYS,
        });
        args = videoQueryArgsSchema.parse(extracted); // ❌ Double parsing
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Validation failed: ${error.message}` }],
          isError: true,
        };
      }

      const result = await queryVideos(repository, args);
      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: result,
      };
    },
  );
}
```

### After (COMPLIANT)

```typescript
// ✅ No argUtils import needed!

export function registerVideoQueryTool(server: McpServer) {
  server.registerTool(
    'video_query',
    {
      inputSchema: videoQueryArgsSchema, // ✅ Full schema
      outputSchema: outputSchema, // ✅ Full schema
    },
    async (args) => {
      // ✅ Typed: { idea: string; fuzzyMatch?: boolean }
      // args is already validated by SDK!
      // No extraction needed!
      // No try/catch for validation needed! (SDK handles it)

      const result = await queryVideos(repository, args);
      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: result,
      };
    },
  );
}
```

**Lines removed:** ~25 per tool  
**Complexity:** Significantly reduced  
**Type safety:** Significantly improved

---

## What About n8n?

**Question:** We have code to handle n8n's wrapped arguments. Will this break n8n?

**Answer:** Possibly. If n8n wraps arguments like this:

```json
{
  "query": {
    "idea": "velvet puppy",
    "fuzzyMatch": true
  }
}
```

Instead of standard MCP format:

```json
{
  "idea": "velvet puppy",
  "fuzzyMatch": true
}
```

Then yes, n8n will break.

**Options:**

1. **Fix n8n (RECOMMENDED)** - Update n8n workflows to send standard format
2. **Add middleware** - Pre-process requests before SDK sees them (in `httpTransport.ts`)
3. **Keep argUtils (NOT RECOMMENDED)** - Stay non-compliant

**My recommendation:** Fix the n8n client. The MCP spec is clear, and we should follow it.

---

## Testing the Fix

### Quick Test with curl

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
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
```

**Should return:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "No existing videos found for \"velvet puppy\""
      }
    ],
    "structuredContent": {
      "exists": false,
      "matchedVideos": [],
      "confidence": "none"
    }
  }
}
```

---

## Deployment Plan

### Step 1: Create Branch

```bash
git checkout -b fix/mcp-compliance
```

### Step 2: Fix All Tools

- Update all 12 tool files (see example in `videoQueryTool.FIXED.ts`)
- Remove argUtils imports
- Follow the 5-step fix pattern

### Step 3: Delete argUtils

```bash
rm src/server/tools/argUtils.ts
rm src/server/tools/argUtils.test.ts
```

### Step 4: Test

```bash
npm test
npm run build
npm run dev  # Test manually
```

### Step 5: Commit & PR

```bash
git add .
git commit -m "fix: Achieve 100% MCP protocol compliance

- Fix all tool registrations to use full Zod schemas
- Remove manual argument extraction (SDK handles it)
- Delete argUtils.ts (no longer needed)
- Improve type safety across all tools
- Reduce code complexity by ~230 lines

BREAKING CHANGE: Tools now expect standard MCP argument format.
If n8n or other clients wrap arguments, they need to be updated."

git push origin fix/mcp-compliance
```

### Step 6: Review & Deploy

- Create PR
- Review code changes
- Test in staging
- Deploy to production
- Monitor for issues

---

## Rollback Plan

If something breaks:

```bash
# Quick rollback
git revert <fix-commit-hash>
git push origin main
```

Or restore from backup:

```bash
git reset --hard <previous-commit>
git push origin main --force  # Coordinate with team first!
```

---

## Time Estimate

- **Fix all tools:** 2-4 hours
- **Delete argUtils:** 15 minutes
- **Testing:** 1-2 hours
- **Documentation:** 30 minutes

**Total:** ~4-7 hours of work

---

## Key Takeaways

1. **The SDK handles argument parsing** - We don't need to do it manually
2. **Use full Zod schemas** - Not `.shape`, but the complete schema object
3. **Trust the SDK validation** - It throws errors automatically if args are invalid
4. **Use typed args** - The callback receives validated, typed data
5. **Delete argUtils** - It's unnecessary complexity

## Documents Created

1. **`MCP_COMPLIANCE_AUDIT.md`** - Full technical audit
2. **`FIXES_SUMMARY.md`** - Detailed fix instructions
3. **`FINAL_COMPLIANCE_REPORT.md`** - Comprehensive report
4. **`MCP_COMPLIANCE_SUMMARY.md`** - This quick summary (you are here)
5. **`videoQueryTool.FIXED.ts`** - Example fixed tool

## Next Steps

1. Review these documents
2. Decide on n8n strategy
3. Start implementing fixes
4. Test thoroughly
5. Deploy with confidence

---

**Need help?** All the details are in the other documents, especially:

- `FINAL_COMPLIANCE_REPORT.md` for comprehensive analysis
- `FIXES_SUMMARY.md` for step-by-step fix instructions
- `videoQueryTool.FIXED.ts` for a working example
