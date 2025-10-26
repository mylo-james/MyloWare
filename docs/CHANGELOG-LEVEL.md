# Schema Update: prompt_type → level

## Changes Made

Replaced the `prompt_type` text field with an auto-computed `level` integer field that automatically categorizes prompts based on their foreign key relationships.

## Database Schema Changes

### Old Schema

```sql
CREATE TABLE prompts (
  ...
  prompt_type TEXT,  -- 'system', 'instructions', 'context', 'creative-direction'
  ...
);
```

### New Schema

```sql
CREATE TABLE prompts (
  ...
  level INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN persona_id IS NOT NULL AND project_id IS NULL THEN 1
      WHEN persona_id IS NULL AND project_id IS NOT NULL THEN 2
      WHEN persona_id IS NOT NULL AND project_id IS NOT NULL THEN 3
    END
  ) STORED,
  ...
);
```

## Level Values

| Level | Description             | Foreign Keys                           |
| ----- | ----------------------- | -------------------------------------- |
| 1     | Persona prompts         | `persona_id` set, `project_id` NULL    |
| 2     | Project prompts         | `persona_id` NULL, `project_id` set    |
| 3     | Persona-Project prompts | Both `persona_id` and `project_id` set |

## Benefits

1. **Automatic categorization** - No need to manually specify prompt type
2. **Guaranteed accuracy** - Level is computed from actual relationships
3. **Simpler inserts** - One less field to manage
4. **Clear ordering** - Level provides natural sort order (persona → project → persona-project)
5. **Type safety** - Integer instead of free-form text

## Files Updated

### Database

- `/sql/dev-reset.sql` - Updated schema with generated column
- `/sql/prompts-inserts.sql` - Regenerated without prompt_type field

### Scripts

- `/scripts/build-prompts-sql.js` - Removed prompt_type from INSERT statements
- Removed `inferPromptType()` function (no longer needed)

### Workflows

- `/workflows/load-persona.workflow.json` - Can now use `level` field directly for ordering

## Migration

If you have an existing database with `prompt_type`:

```sql
-- Drop old column
ALTER TABLE prompts DROP COLUMN prompt_type;

-- Add new computed column
ALTER TABLE prompts ADD COLUMN level INTEGER GENERATED ALWAYS AS (
  CASE
    WHEN persona_id IS NOT NULL AND project_id IS NULL THEN 1
    WHEN persona_id IS NULL AND project_id IS NOT NULL THEN 2
    WHEN persona_id IS NOT NULL AND project_id IS NOT NULL THEN 3
  END
) STORED;

-- Update indexes
DROP INDEX IF EXISTS idx_prompts_persona;
DROP INDEX IF EXISTS idx_prompts_project;
DROP INDEX IF EXISTS idx_prompts_persona_project;

CREATE INDEX idx_prompts_persona ON prompts(persona_id, display_order) WHERE level = 1;
CREATE INDEX idx_prompts_project ON prompts(project_id, display_order) WHERE level = 2;
CREATE INDEX idx_prompts_persona_project ON prompts(persona_id, project_id, display_order) WHERE level = 3;
```

## Usage in Queries

### Before

```sql
SELECT * FROM prompts
WHERE prompt_type = 'system'
ORDER BY display_order;
```

### After

```sql
SELECT * FROM prompts
WHERE level = 1
ORDER BY display_order;
```

### Ordering by Level

```sql
SELECT * FROM prompts
ORDER BY level ASC, display_order ASC;
-- Returns: All level 1 (persona), then level 2 (project), then level 3 (persona-project)
```

## Testing

All tests pass after the update:

```bash
npm run test:prompts
# ✅ All tests passed!
```

To regenerate with new schema:

```bash
npm run update:dev-reset
```

---

**Date**: October 16, 2025  
**Status**: ✅ Complete  
**Backward Compatible**: No - requires schema migration
