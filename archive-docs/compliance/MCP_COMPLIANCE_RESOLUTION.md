# MCP Compliance - Final Resolution

## The Real Story

After extensive testing, here's the definitive answer about MCP compliance:

### What MCP Specification Requires
- `inputSchema`: JSON Schema Draft 7 object (**wire protocol**)
- `outputSchema`: JSON Schema Draft 7 object (**wire protocol**)

### What TypeScript SDK Requires
- `inputSchema`: `ZodRawShape` (from `schema.shape`)
- `outputSchema`: `ZodRawShape` (from `schema.shape`)
- SDK converts internally to JSON Schema for transmission

### The Critical Finding
**The TypeScript SDK signature is: `registerTool<InputArgs extends ZodRawShape>(...)`**

This means:
1. You MUST pass Zod `.shape` (not JSON Schema objects)
2. The SDK validates using Zod internally  
3. The SDK serializes to JSON Schema for the wire protocol
4. Passing JSON Schema breaks validation (keyValidator._parse error)

### The Edge Case Problem
Schemas with `.refine()` or `.superRefine()` return `ZodEffects<>`, which don't have `.shape`.

**Solution**: Pass the BASE schema (before refinement) to `registerTool`. The SDK validates the base shape, your handler does additional validation.

### Implementation Pattern

```typescript
// Define base schema
const argsSchema = z.object({
  field: z.string()
});

// Define refined schema for handler type safety
const refinedSchema = argsSchema.superRefine((val, ctx) => {
  // ... custom validation
});

// Register tool with BASE schema.shape
server.registerTool(
  'my_tool',
  {
    inputSchema: argsSchema.shape,  // NOT refinedSchema
    outputSchema: outputSchema.shape,
  },
  async (args) => {
    // Optionally validate with refined schema
    const validated = refinedSchema.parse(args);
    // ...
  }
);
```

### Why This is MCP Compliant
1. `.shape` gives the SDK what it needs (ZodRawShape)
2. SDK converts it to proper JSON Schema for `tools/list` response
3. The JSON Schema transmitted over MCP protocol is compliant
4. n8n and other MCP clients receive proper JSON Schema

### Testing
Run `tools/list` via MCP HTTP endpoint and verify `inputSchema` is proper JSON Schema with `type: "object"` and `properties`.

## Conclusion
**Use `.shape` for MCP TypeScript SDK compliance.** The SDK handles MCP protocol compliance automatically.

