# Tool Specification Guide

This guide explains how to create, update, and maintain tool specifications for MCP tools in the MyloWare system.

## Overview

Tool specifications are YAML files that describe MCP tools in a structured, machine-readable format. They enable:

- **Documentation**: Clear, searchable documentation of tool capabilities
- **Validation**: Automated checking of tool implementations against specs
- **Discovery**: Easy discovery of available tools and their use cases
- **Maintenance**: Version tracking and change management

## Specification Location

All tool specs are stored in `docs/tool-specs/` as YAML files named `<tool_name>.yml`.

## Schema Reference

Tool specs must conform to the JSON Schema defined in `docs/tool-description.schema.json`. The schema requires:

- **Required fields**: `id`, `name`, `version`, `description`, `input_schema`, `output_schema`
- **Optional fields**: See schema for complete list

## Creating a New Tool Spec

### Step 1: Create the YAML File

Create a new file `docs/tool-specs/<tool_name>.yml`:

```yaml
tool:
  id: myloware.<namespace>.<tool_name>.v1
  name: <tool_name>
  namespace: myloware.<namespace>
  version: '1.0.0'
  description: >-
    Clear, complete description of what the tool does, when to use it,
    and what it returns.
  # ... rest of spec
```

### Step 2: Fill Required Fields

1. **id**: Format is `myloware.<namespace>.<tool_name>.v<version>` (lowercase only)
2. **name**: Must match the MCP tool registration name exactly
3. **version**: Start with `'1.0.0'` for new tools
4. **description**: Write a clear, complete description (2-3 sentences)
5. **input_schema**: Convert Zod schema from source code to JSON Schema
6. **output_schema**: Convert return type from source code to JSON Schema

### Step 3: Add Optional Fields

- **one_liner**: Single sentence summary
- **invocation_context**: When to use this tool vs alternatives
- **agent_hint**: Guidance for agent decision-making
- **pattern**: Tool pattern classification (see schema enum)
- **tags**: Keywords for discovery
- **constraints**: Rate limits, timeouts, max items
- **examples**: Input/output examples from tests

### Step 4: Validate

Run the validation script:

```bash
npm run validate:tool-specs
```

Fix any errors reported.

### Step 5: Update Documentation

Add the new tool to `docs/tool-specs/README.md` in the tools table.

## Updating an Existing Spec

### When to Update

- Tool behavior changes
- Input/output schemas change
- Constraints change (rate limits, timeouts)
- New examples needed
- Documentation improvements

### Versioning Strategy

- **Patch** (`1.0.0` → `1.0.1`): Documentation fixes, examples, clarifications
- **Minor** (`1.0.0` → `1.1.0`): New optional fields, new examples, non-breaking schema additions
- **Major** (`1.0.0` → `2.0.0`): Breaking changes to input/output schemas, required fields

### Update Process

1. Open the YAML file
2. Make changes
3. Update `versioning.last_updated` to current date (YYYY-MM-DD)
4. Increment version if making breaking changes
5. Update examples if behavior changed
6. Run validation: `npm run validate:tool-specs`
7. Update README if description changed

## Converting Zod Schemas to JSON Schema

When creating `input_schema` and `output_schema`, convert from Zod to JSON Schema:

```typescript
// Zod (source code)
z.object({
  name: z.string().min(1),
  age: z.number().int().positive().optional(),
})
```

```yaml
# JSON Schema (YAML spec)
type: object
additionalProperties: false
properties:
  name:
    type: string
    minLength: 1
  age:
    type: integer
    minimum: 1
required:
  - name
```

Common conversions:
- `z.string()` → `type: string`
- `z.number()` → `type: number`
- `z.boolean()` → `type: boolean`
- `z.array(...)` → `type: array, items: {...}`
- `.optional()` → Remove from `required` array
- `.min(n)` → `minimum: n` (numbers) or `minLength: n` (strings)
- `.max(n)` → `maximum: n` (numbers) or `maxLength: n` (strings)
- `.enum([...])` → `enum: [...]`
- `.default(value)` → `default: value`

## Extracting Examples from Tests

Test files (`*.test.ts`) contain example inputs and expected outputs. Extract these when creating examples:

```typescript
// Test file
it('should process input', async () => {
  const input = { name: 'Test', age: 25 };
  const output = await tool(input);
  expect(output).toEqual({ id: '123', ... });
});
```

```yaml
# Spec file
examples:
  - name: Process input
    description: 'Basic input processing example.'
    input:
      name: Test
      age: 25
    output:
      id: '123'
      # ...
```

## Validation

### Running Validation

```bash
npm run validate:tool-specs
```

The validator checks:
- Required fields are present
- Field types match schema
- ID and name patterns match
- Input/output schemas have `type` property

### Common Validation Errors

1. **Missing required field**: Add the missing field
2. **ID pattern mismatch**: Ensure ID is lowercase: `myloware.namespace.tool.v1`
3. **Name pattern mismatch**: Ensure name uses only lowercase, numbers, underscores, hyphens, dots
4. **Schema missing type**: Add `type: object` (or appropriate type) to schema

## Best Practices

1. **Be specific**: Include constraints, rate limits, and edge cases
2. **Use examples**: Include at least one example per tool
3. **Cross-reference**: Mention related tools in `invocation_context`
4. **Stay current**: Update specs when tool implementation changes
5. **Validate early**: Run validation after each change
6. **Document intent**: Explain *why* the tool exists, not just *what* it does

## Related Files

- `docs/tool-description.schema.json` - JSON Schema definition
- `docs/tool-specs/README.md` - Tool index and quick reference
- `docs/tool-specs/INVENTORY.md` - Detailed inventory from source code
- `scripts/validateToolSpecs.ts` - Validation script

## Questions?

See the [Tool Specs README](./tool-specs/README.md) or check existing specs for examples.

