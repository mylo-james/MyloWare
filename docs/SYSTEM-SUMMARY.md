# Prompt Management System - Summary

## ✅ What Was Built

A complete automated system for managing AI prompts that:

1. **Reads prompts from markdown files** (`prompts/*.md`)
2. **Automatically generates SQL INSERT statements**
3. **Updates `dev-reset.sql`** with the latest prompts
4. **Validates the entire system** with automated tests

## 🚀 How to Use

### Quick Command

```bash
npm run update:dev-reset
```

This single command:

- Reads all `.md` files from `prompts/`
- Generates SQL INSERT statements
- Updates `sql/dev-reset.sql` with new prompts
- Preserves all other parts of dev-reset.sql

### After Updating Prompts

1. Edit any `.md` file in `prompts/`
2. Run `npm run update:dev-reset`
3. Apply `sql/dev-reset.sql` to your database

## 📁 File Structure

```
prompts/
  ├── persona-chat.md              ✅ Chatbot persona
  ├── persona-ideagenerator.md     ✅ Idea Generator persona
  ├── persona-screenwriter.md      ✅ Screen Writer persona
  ├── project-aismr.md             ✅ AISMR project context
  ├── ideagenerator-aismr.md       ✅ Idea Gen + AISMR specific
  └── screenwriter-aismr.md        ✅ Screen Writer + AISMR specific

scripts/
  ├── build-prompts-sql.js         📝 Generate SQL from .md
  ├── update-dev-reset.js          🔄 Update dev-reset.sql
  ├── test-prompts.js              🧪 Validate system
  └── README.md                    📚 Full documentation

sql/
  ├── prompts-inserts.sql          🤖 Auto-generated SQL
  └── dev-reset.sql                💾 Database reset script

PROMPTS.md                         📖 Quick reference
```

## 🏷️ Naming Convention

| Pattern                  | Example                  | Database Mapping                       |
| ------------------------ | ------------------------ | -------------------------------------- |
| `persona-{name}.md`      | `persona-chat.md`        | `persona_id` SET, `project_id` NULL    |
| `project-{name}.md`      | `project-aismr.md`       | `project_id` SET, `persona_id` NULL    |
| `{persona}-{project}.md` | `ideagenerator-aismr.md` | Both `persona_id` AND `project_id` SET |

## 🎯 Prompt Types (Auto-Detected)

The system automatically assigns `prompt_type`:

- **system** - Role/identity prompts ("You are...")
- **instructions** - Task instructions and workflows
- **creative-direction** - Creative guidelines and formats
- **context** - Project context and specifications

## 📊 Current State

```
✅ 3 persona prompts (Chatbot, Idea Generator, Screen Writer)
✅ 1 project prompt (AISMR)
✅ 2 persona-project prompts (Idea Gen+AISMR, Screen Writer+AISMR)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   6 total prompts
```

## 🛠️ Available Commands

```bash
# Generate SQL from markdown files
npm run build:prompts

# Update dev-reset.sql with generated SQL
npm run update:dev-reset

# Validate the entire system
npm run test:prompts
```

## 🔍 How It Works

### 1. Parse Filenames

```
persona-chat.md → { type: 'persona', persona: 'Chatbot' }
project-aismr.md → { type: 'project', project: 'AISMR' }
ideagenerator-aismr.md → { type: 'persona-project', persona: 'Idea Generator', project: 'AISMR' }
```

### 2. Generate SQL

```sql
INSERT INTO prompts (persona_id, project_id, prompt_text, display_order, prompt_type, metadata)
VALUES
((SELECT id FROM personas WHERE name = 'Chatbot'), NULL,
 E'<escaped prompt content>',
 1, 'system', '{"model":"gpt-4","temperature":0.7}');
```

### 3. Update dev-reset.sql

```
Finds: -- Insert Prompts using new simplified schema
Replaces prompts section
Keeps: Everything else (tables, projects, personas, sample data)
```

## ✨ Benefits

1. **Single Source of Truth**: Prompts live in readable `.md` files
2. **Automatic Generation**: No manual SQL writing
3. **Type Safety**: Filename convention ensures correct relationships
4. **Easy Updates**: Change `.md`, run one command
5. **Version Control**: Track prompt changes in git with diffs
6. **Validated**: Automated tests ensure correctness

## 📚 Documentation

- **Full Guide**: `scripts/README.md`
- **Quick Reference**: `PROMPTS.md`
- **Prompt Content**: `prompts/README.md`

## 🎉 Example Workflow

```bash
# Edit a prompt
vim prompts/persona-chat.md

# Regenerate SQL and update dev-reset.sql
npm run update:dev-reset

# Verify
npm run test:prompts

# Apply to database
psql -d your_database -f sql/dev-reset.sql

# Commit
git add prompts/ sql/
git commit -m "Update chat persona prompt"
```

## 🚨 Important Notes

- **Never edit** `sql/prompts-inserts.sql` manually (auto-generated)
- **Never edit** the prompts section in `sql/dev-reset.sql` manually
- **Always run** `npm run update:dev-reset` after changing `.md` files
- **Backup files** starting with `bak.` are automatically ignored
- **README.md** in prompts/ is automatically ignored

## 🔮 Future Enhancements

Potential additions:

- Prompt versioning/changelog generation
- Validation of prompt content structure
- Automatic metadata extraction from YAML frontmatter
- Multi-language prompt support
- Prompt template system
- Automated testing of prompts with LLMs

---

**Built**: October 2025  
**Status**: ✅ Production Ready  
**Test Coverage**: 6/6 tests passing
