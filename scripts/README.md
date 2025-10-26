# Prompt Management System

This directory contains scripts for managing AI prompts that are stored in markdown files and automatically converted to SQL for database insertion.

## Quick Start

### Update Prompts

When you update any `.md` file in the `prompts/` folder, run:

```bash
npm run update:dev-reset
```

This will:

1. Generate SQL INSERT statements from all markdown files
2. Update `sql/dev-reset.sql` with the new prompts
3. Preserve all other parts of the dev-reset script

### Reset Database ⭐ NEW

**Option 1: Using Supabase CLI (Recommended)**

```bash
./scripts/reset-database.sh
```

This will:

1. Confirm you want to reset (destructive operation)
2. Run `supabase db reset` which:
   - Drops all tables
   - Re-applies the single clean migration
   - Sets up the fresh schema

**Option 2: Manual Reset**

To execute the complete database reset manually:

```bash
npm run dev-reset
```

This will:

1. Build and update SQL files (as above)
2. Connect to your Supabase PostgreSQL database
3. Execute the complete dev-reset.sql script
4. Show verification results

**Requirements:**

- Add `DATABASE_URL` to your `.env` file
- Get it from: Supabase Dashboard → Settings → Database → Connection String (URI format)

⚠️ **WARNING:** This destroys all data in your database!

## File Structure

```
prompts/                    # Markdown prompt files
  persona-{name}.md        # Persona-level prompts
  project-{name}.md        # Project-level prompts
  {persona}-{project}.md   # Persona+Project prompts
  README.md                # Documentation
  bak.*.md                 # Backup files (ignored)

scripts/
  build-prompts-sql.js     # Generates SQL from markdown
  update-dev-reset.js      # Updates dev-reset.sql

sql/
  prompts-inserts.sql      # Generated SQL (auto-generated)
  dev-reset.sql            # Main database reset script
```

## Naming Convention

The script automatically determines prompt type and relationships based on filename:

### Persona-Level Prompts

**Pattern**: `persona-{name}.md`

Examples:

- `persona-chat.md` → Chatbot persona
- `persona-ideagenerator.md` → Idea Generator persona
- `persona-screenwriter.md` → Screen Writer persona

**Database**: `persona_id` set, `project_id` NULL  
**Scope**: Applies to the persona everywhere

### Project-Level Prompts

**Pattern**: `project-{name}.md`

Examples:

- `project-aismr.md` → AISMR project context

**Database**: `project_id` set, `persona_id` NULL  
**Scope**: Applies to all personas working on this project

### Persona-Project Prompts

**Pattern**: `{persona}-{project}.md`

Examples:

- `ideagenerator-aismr.md` → Idea Generator working on AISMR
- `screenwriter-aismr.md` → Screen Writer working on AISMR

**Database**: Both `persona_id` and `project_id` set  
**Scope**: Specific instructions for a persona on a specific project

## How It Works

### 1. Build Prompts SQL

```bash
npm run build:prompts
```

This script (`scripts/build-prompts-sql.js`):

- Reads all `.md` files from `prompts/`
- Parses filenames to determine prompt type
- Extracts content and metadata
- Generates SQL INSERT statements
- Writes to `sql/prompts-inserts.sql`

### 2. Update Dev Reset

```bash
npm run update:dev-reset
```

This script (`scripts/update-dev-reset.js`):

- Runs `build:prompts` first
- Reads the generated `prompts-inserts.sql`
- Finds the prompts section in `dev-reset.sql`
- Replaces old prompts with new ones
- Preserves all other sections

### 3. Combined Command

```bash
npm run update:dev-reset
```

This is the main command you'll use. It does both steps automatically.

## Database Schema

The prompts are inserted into this table structure:

```sql
CREATE TABLE prompts (
  id UUID PRIMARY KEY,
  persona_id UUID REFERENCES personas(id),  -- NULL for project prompts
  project_id UUID REFERENCES projects(id),  -- NULL for persona prompts
  prompt_text TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  prompt_type TEXT,  -- 'system', 'instructions', 'context', 'creative-direction'
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (persona_id IS NOT NULL OR project_id IS NOT NULL)
);
```

## Prompt Type Inference

The script automatically infers `prompt_type` based on content:

- **system**: Contains "you are a/an" or "## role" section
- **instructions**: Generic task instructions
- **creative-direction**: Contains format rules or creative guidelines
- **context**: Project-level context information

## Metadata Inference

The script automatically adds metadata:

### Persona Prompts

```json
{
  "model": "gpt-4",
  "temperature": 0.7 // or 0.8 for idea generator
}
```

### Project Prompts

```json
{
  "project": "AISMR"
}
```

### Persona-Project Prompts

```json
{
  "project": "AISMR",
  "persona": "Idea Generator"
}
```

## Workflow

### Adding a New Prompt

1. Create a new `.md` file in `prompts/` following the naming convention
2. Write your prompt content
3. Run `npm run update:dev-reset`
4. Verify the changes in `sql/dev-reset.sql`
5. Test with your database

### Updating an Existing Prompt

1. Edit the `.md` file in `prompts/`
2. Run `npm run update:dev-reset`
3. The corresponding SQL will be regenerated
4. Apply `dev-reset.sql` to your database

### Adding a New Persona or Project

1. Update the mapping in `scripts/build-prompts-sql.js`:

```javascript
const PERSONAS = {
  chat: 'Chatbot',
  ideagenerator: 'Idea Generator',
  screenwriter: 'Screen Writer',
  newpersona: 'New Persona Name', // Add here
};

const PROJECTS = {
  aismr: 'AISMR',
  newproject: 'New Project', // Add here
};
```

2. Create your markdown files using the naming convention
3. Run `npm run update:dev-reset`

## Files Ignored

- `bak.*.md` - Backup files
- `README.md` - Documentation

## Best Practices

1. **Keep prompts focused**: Each file should contain one logical prompt
2. **Use markdown formatting**: Makes prompts readable and maintainable
3. **Test locally first**: Run `dev-reset.sql` on a dev database before production
4. **Version control**: Commit both `.md` changes and generated SQL
5. **Document intent**: Use markdown headers and comments to explain prompt purpose

## Troubleshooting

### "Could not parse filename pattern"

- Ensure filename follows one of the three naming patterns
- Check for typos in persona/project names
- Update the mappings in `build-prompts-sql.js` if needed

### "Could not find start/end marker"

- The markers in `dev-reset.sql` may have been modified
- Look for these comments:
  - Start: `-- Insert Prompts using new simplified schema`
  - End: `-- Sample AISMR data`

### Generated SQL looks wrong

- Check that persona/project names in `dev-reset.sql` match those in mappings
- Verify the persona/project rows are inserted before prompts
- Check for SQL escaping issues (single quotes should be doubled)

## Example: Adding a New Chatbot Prompt for AISMR

1. Create `prompts/chat-aismr.md`:

```markdown
# Chatbot: AISMR-Specific Instructions

When users request AISMR videos, follow these guidelines:

- Ask for the object/subject they want to see
- Confirm before generating
- Provide status updates during generation
```

2. Run the update:

```bash
npm run update:dev-reset
```

3. The script generates:

```sql
INSERT INTO prompts (persona_id, project_id, prompt_text, display_order, prompt_type, metadata) VALUES
((SELECT id FROM personas WHERE name = 'Chatbot'),
 (SELECT id FROM projects WHERE name = 'AISMR'),
 E'# Chatbot: AISMR-Specific Instructions...',
 1, 'instructions', '{"project":"AISMR","persona":"Chatbot"}');
```

4. Apply to database:

```bash
psql -d your_database -f sql/dev-reset.sql
```

## Scripts Reference

| Command                    | Description                           |
| -------------------------- | ------------------------------------- |
| `npm run build:prompts`    | Generate SQL from markdown files      |
| `npm run update:dev-reset` | Update dev-reset.sql with new prompts |
| `npm test`                 | Run test suite                        |
| `npm run validate:split`   | Validate workflow structure           |

## Related Files

- `/prompts/README.md` - Documentation about prompt content
- `/sql/refactor-idea-generator-prompts.sql` - Legacy migration script
- `/sql/dev-reset.sql` - Main database reset script
