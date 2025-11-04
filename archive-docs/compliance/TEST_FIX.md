# MCP Schema Fix - Test Results

## Issue

MCP error -32603: Cannot read properties of null (reading '\_def')

## Root Cause

The MCP SDK expects `ZodRawShape` (the shape object) for inputSchema and outputSchema, but we were passing complete `ZodObject` schemas instead.

## Fix Applied

Changed all tool registrations from:

```typescript
inputSchema: conversationStoreArgsSchema,
outputSchema,
```

To:

```typescript
inputSchema: conversationStoreArgsSchema.shape,
outputSchema: outputSchema.shape,
```

For schemas using `.superRefine()` or `.refine()` (which wrap in `ZodEffects`), used the base schema's shape:

```typescript
inputSchema: memoryAddArgsBaseSchema.shape,  // Instead of memoryAddArgsSchema.shape
```

## Files Fixed

- src/server/tools/adaptiveSearchTool.ts
- src/server/tools/conversationLatestTool.ts
- src/server/tools/conversationMemoryTool.ts
- src/server/tools/conversationStoreTool.ts
- src/server/tools/memoryAddTool.ts
- src/server/tools/promptGetTool.ts
- src/server/tools/promptListTool.ts
- src/server/tools/promptSearchTool.ts
- src/server/tools/videoIdeasTool.ts
- src/server/tools/videoQueryTool.ts

## Verification

✅ TypeScript build passes with no errors
✅ All 10+ tools register successfully on server start
✅ Server auto-reloaded with tsx watch

## Test from n8n

Run this command to test tool calling:

```bash
npx tsx scripts/test-mcp-auth.ts
```

Should show all available tools and no \_def errors when calling them.
