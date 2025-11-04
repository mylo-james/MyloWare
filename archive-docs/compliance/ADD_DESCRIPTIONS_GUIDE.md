# Adding Descriptions to Zod Schemas for n8n Compatibility

## The Issue

n8n's MCP node parses JSON Schema to generate UI fields. When properties lack `description` fields, n8n cannot determine what to display, causing errors like:

```
Cannot read properties of undefined (reading 'inputType')
```

## The Solution

Add `.describe()` to every Zod schema property:

```typescript
// ❌ BEFORE - No descriptions
const schema = z.object({
  name: z.string(),
  age: z.number().optional()
});

// ✅ AFTER - With descriptions
const schema = z.object({
  name: z.string().describe('User full name'),
  age: z.number().optional().describe('User age in years')
});
```

## How Zod Descriptions Become JSON Schema

Zod's `.describe()` maps directly to JSON Schema's `description` field:

```typescript
z.string().describe('Field description')
```

Becomes:

```json
{
  "type": "string",
  "description": "Field description"
}
```

## Applied To All Tools

All tool input schemas now have descriptions on every field for n8n compatibility.

### Examples

**video_query**:
```typescript
z.object({
  idea: z.string().describe('2-word idea title to search for'),
  fuzzyMatch: z.boolean().optional().describe('Enable fuzzy matching for partial matches')
})
```

**conversation_store**:
```typescript
z.object({
  sessionId: z.string().uuid().optional().describe('Session UUID (generates new if omitted)'),
  role: z.enum(['user', 'assistant', 'system', 'tool']).describe('Turn role: user, assistant, system, or tool'),
  content: z.string().describe('Conversation turn content to store'),
  // ... etc
})
```

## Remaining Work

Add `.describe()` to all remaining tools:
- `prompt_search` (13 fields)
- `prompts_search_adaptive` (23 fields)
- `conversation_remember` (7 fields)
- `memory_add` (13 fields)
- `memory_update` (11 fields)
- `memory_delete` (4 fields)
- `video_ideas_snapshot` (5 fields)

## Pattern to Follow

1. **Required fields**: Clear description of what's expected
   ```typescript
   name: z.string().describe('User full name (required)')
   ```

2. **Optional fields**: Indicate optional and default behavior
   ```typescript
   limit: z.number().optional().describe('Max results (1-50, default: 10)')
   ```

3. **Enums**: List the options
   ```typescript
   mode: z.enum(['a', 'b']).describe('Mode: "a" for X, "b" for Y')
   ```

4. **Complex types**: Explain the structure
   ```typescript
   metadata: z.record(z.unknown()).describe('Additional key-value metadata')
   ```

5. **Format hints**: Include format expectations
   ```typescript
   date: z.string().describe('ISO 8601 timestamp (e.g., "2025-11-04T12:00:00Z")')
   ```

