# MCP Compliance - Final Fix

## The Real Issue

The MCP **specification** requires:
- `inputSchema`: JSON Schema Draft 7 object with `type: "object"`  
- `outputSchema`: JSON Schema Draft 7 object with `type: "object"`

The TypeScript SDK **convenience** accepts:
- Zod schema objects (via `.shape` or direct schemas)
- SDK converts them to JSON Schema internally

## The Problem with `.shape`

When we use `.shape`, the TypeScript SDK may not properly serialize complex Zod schemas (especially those with `.superRefine()`, `.refine()`, etc.) to valid JSON Schema for the wire protocol.

## The Correct Solution

Use `zod-to-json-schema` to convert Zod schemas to proper JSON Schema **without** the `$schema` and `$ref` properties that break n8n and other MCP clients.

## Implementation

The `toJsonSchema()` helper in `src/server/utils/jsonSchema.ts`:
- Converts Zod schemas to JSON Schema Draft 7
- Removes `$schema` and `$id` (not needed in MCP tools/list response) 
- Sets `$refStrategy: 'none'` to inline all schemas (better n8n compatibility)
- Enforces `type: "object"` root for tool arguments

## Testing Required

1. Call `tools/list` via MCP HTTP endpoint
2. Verify each tool's `inputSchema` is pure JSON Schema
3. Test actual tool calls to ensure validation works
4. Verify n8n can parse and display input fields correctly

