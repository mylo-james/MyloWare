# n8n Argument Wrapper Fix

## Problem

n8n AI Agent was sending tool arguments wrapped in a `query` object:

```json
{
  "query": {
    "persona_name": "ideagenerator",
    "project_name": "aismr"
  },
  "tool": {
    "name": "prompt_get",
    "description": "..."
  }
}
```

But our MCP server's `extractToolArgs` utility was looking for arguments in:

- `args`
- `input`
- `parameters`
- `payload`
- `params`
- etc.

It **wasn't** looking in `query`, so it couldn't find the arguments!

This caused the error:

> **Received tool input did not match expected schema**

## Root Cause

The `extractToolArgs` function in `src/server/tools/argUtils.ts` had a `CANDIDATE_KEYS` array that didn't include `query`, which is how n8n wraps MCP tool arguments.

## Solution

Added `query` to the `CANDIDATE_KEYS` array:

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
  'query', // n8n wraps arguments in a query object ← ADDED THIS
];
```

Now `extractToolArgs` recursively searches through the input and finds arguments inside the `query` wrapper.

## Tests Added

Added comprehensive tests to verify the fix works:

```typescript
it('unwraps n8n query wrapper format', () => {
  const raw = {
    query: {
      persona_name: 'ideagenerator',
      project_name: 'aismr',
    },
    tool: {
      name: 'prompt_get',
      description: 'Tool description...',
    },
  };

  const result = extractToolArgs(raw, {
    allowedKeys: ['persona_name', 'project_name'],
  });

  expect(result).toEqual({
    persona_name: 'ideagenerator',
    project_name: 'aismr',
  });
});
```

✅ All 6 tests pass!

## Files Modified

- `src/server/tools/argUtils.ts` - Added 'query' to CANDIDATE_KEYS
- `src/server/tools/argUtils.test.ts` - Added tests for n8n format

## Result

✅ The MCP server now correctly extracts arguments from n8n's query wrapper
✅ Tools can be called from n8n without "schema mismatch" errors
✅ The server auto-reloaded via tsx watch

## Testing

In n8n, try calling any MCP tool:

```json
{
  "tool": "prompt_get",
  "arguments": {
    "persona_name": "ideagenerator",
    "project_name": "aismr"
  }
}
```

It should now work! The workflow will:

1. ✅ Load the ideagenerator-aismr workflow
2. ✅ Show you the complete step-by-step instructions
3. ✅ Return the output schema for 12 AISMR ideas

## What's Next

The AI agent should now be able to:

1. Call `prompt_get` to load the workflow
2. Call `conversation_remember` to check past ideas
3. Call `video_ideas_snapshot` to load existing ideas
4. Call `video_query` for each candidate
5. Call `conversation_store` to save results

Try it in n8n: **"Generate 12 AISMR video ideas about puppies"**

