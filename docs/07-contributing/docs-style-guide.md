# Documentation Style Guide

**Audience:** Contributors writing or updating documentation  
**Outcome:** Consistent, high-quality docs that match the North Star voice

---

## Core Principles

1. **Concise** - Short sentences, active voice, minimal jargon
2. **Task-focused** - Start with outcome, provide steps, validate success
3. **North Star aligned** - Link to [NORTH_STAR.md](../../NORTH_STAR.md); don't duplicate it
4. **Code over prose** - Show working examples; explain only what's non-obvious

---

## Page Structure

Every documentation page follows this template:

```markdown
# Page Title

**Audience:** Who this is for  
**Outcome:** What you'll accomplish  
**Time:** How long it takes (optional)

---

## Overview

1-2 sentence summary of the page.

---

## Prerequisites

- Bullet list of what you need first
- Link to setup guides if needed

---

## Steps

### 1. First Step

Clear, actionable instruction.

\`\`\`bash
# Example command
npm run something
\`\`\`

### 2. Second Step

Another clear instruction.

---

## Validation

✅ Checklist of success criteria  
✅ How to verify it worked  
✅ What the output should look like

---

## Next Steps

- [Related Guide](#) - What to do next
- [Reference](#) - Deep dive

---

## Troubleshooting

**Common issue?**
- Symptom description
- Solution steps
```

---

## Voice and Tone

### Do
- **Use active voice:** "Create a trace" not "A trace is created"
- **Use present tense:** "The agent loads context" not "The agent will load context"
- **Be direct:** "Run this command" not "You might want to consider running this command"
- **Use imperatives:** "Install dependencies" not "You should install dependencies"

### Don't
- **Avoid passive voice:** "The trace is created by Casey" → "Casey creates the trace"
- **Avoid future tense:** "This will do X" → "This does X"
- **Avoid hedging:** "Usually", "typically", "might" → Be definitive
- **Avoid jargon:** Define technical terms on first use

---

## Code Examples

### Inline Code
Use backticks for:
- File paths: `src/mcp/tools.ts`
- Commands: `npm run dev`
- Function names: `handoff_to_agent()`
- Variables: `traceId`
- Values: `'active'`

### Code Blocks
Always specify language:

```markdown
\`\`\`bash
npm run dev
\`\`\`

\`\`\`typescript
const trace = await trace_create({ projectId: 'aismr' });
\`\`\`

\`\`\`json
{
  "traceId": "trace-001",
  "status": "active"
}
\`\`\`
```

### Command Output
Show expected output:

```markdown
\`\`\`bash
curl http://localhost:3456/health
\`\`\`

Expected response:
\`\`\`json
{
  "status": "healthy"
}
\`\`\`
```

---

## Links

### Internal Links
Use relative paths:

```markdown
See [System Overview](../02-architecture/system-overview.md) for details.
```

### External Links
Include context:

```markdown
Read the [MCP specification](https://modelcontextprotocol.io) for protocol details.
```

### North Star Links
Always link to North Star for narrative:

```markdown
For the complete vision, see [NORTH_STAR.md](../../NORTH_STAR.md).
```

---

## Headings

### Hierarchy
- `#` - Page title (one per page)
- `##` - Major sections
- `###` - Subsections
- `####` - Rare; prefer restructuring

### Naming
- **Use sentence case:** "Getting started" not "Getting Started"
- **Be specific:** "Install dependencies" not "Setup"
- **Avoid gerunds:** "Install" not "Installing"

---

## Lists

### Ordered Lists
Use for sequential steps:

```markdown
1. First step
2. Second step
3. Third step
```

### Unordered Lists
Use for non-sequential items:

```markdown
- Item one
- Item two
- Item three
```

### Nested Lists
Indent with 2 spaces:

```markdown
- Parent item
  - Child item
  - Another child
- Another parent
```

---

## Tables

Use for structured data:

```markdown
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Persona name |
```

Keep tables simple:
- Max 4-5 columns
- Short cell content
- Use abbreviations if needed

---

## Admonitions

### Warnings
```markdown
> ⚠️ **Warning:** This will delete all data.
```

### Notes
```markdown
> **Note:** This is optional.
```

### Tips
```markdown
> 💡 **Tip:** Use Context7 for vendor docs.
```

---

## Banned Terms

These legacy terms should not appear in new docs:

- `workflow_complete` → Use `handoff_to_agent({ toAgent: 'complete' })`
- `clarify_ask` → Use "Telegram HITL nodes"
- `prompt_discover` → Use "procedural memories + memory_search"
- `run_state_*` → Use "trace_create + memory_search"
- `handoff_create` / `handoff_complete` → Use `handoff_to_agent`
- `casey.workflow.json` → Use "universal workflow (myloware-agent.workflow.json)"

---

## Context7 References

When referencing vendor docs, prefer Context7:

```markdown
For n8n webhook configuration, use Context7 to fetch the latest docs:
\`\`\`
Context7: /n8n/n8n
\`\`\`

The \`docs/official-documentation/\` directory contains convenience snapshots but may be outdated.
```

---

## Auto-Generated Content

Some docs are generated from source:

- `06-reference/mcp-tools.md` - From `src/mcp/tools.ts`
- `06-reference/schema.md` - From `src/db/schema.ts`

**Mark auto-generated files:**

```markdown
# Page Title

**Auto-generated from \`src/path/to/file.ts\`**  
**Last updated:** 2025-01-09

> ⚠️ **Do not edit this file manually.** It is auto-generated from source code.  
> To update, run: \`npm run docs:generate\`
```

---

## File Naming

- **Use kebab-case:** `system-overview.md` not `SystemOverview.md`
- **Be descriptive:** `add-a-persona.md` not `persona.md`
- **Avoid abbreviations:** `configuration.md` not `config.md` (unless widely known)

---

## Directory Organization

```
docs/
├── README.md                    # Index (always start here)
├── 01-getting-started/          # New user onboarding
├── 02-architecture/             # System understanding
├── 03-how-to/                   # Task-oriented guides
├── 04-integration/              # External system integration
├── 05-operations/               # Run and monitor
├── 06-reference/                # Technical specs
├── 07-contributing/             # Development guides
├── archive/                     # Deprecated docs
└── official-documentation/      # Vendor snapshots (non-authoritative)
```

---

## Review Checklist

Before submitting documentation:

- [ ] Follows page structure template
- [ ] Uses active voice and present tense
- [ ] Includes code examples with language tags
- [ ] Links to North Star for narrative (doesn't duplicate)
- [ ] No banned legacy terms
- [ ] Prefers Context7 for vendor docs
- [ ] All links work (run link checker)
- [ ] Spell check passed
- [ ] Matches voice and tone guidelines

---

## Link Checker

Run before committing:

```bash
npm run docs:check-links
```

This validates:
- No broken internal links
- No broken external links (with timeout)
- No orphaned pages (not linked from anywhere)

---

## Spell Check

Use VS Code spell checker or:

```bash
npm run docs:spell-check
```

---

## Vale Linting (Optional)

For automated style checking:

```bash
# Install Vale
brew install vale

# Run linter
vale docs/
```

Vale rules in `.vale.ini`:
- Banned terms (legacy tool names)
- Voice guidelines (active voice, present tense)
- Heading capitalization
- Link format

---

## Templates

### How-To Guide Template

```markdown
# How to [Task]

**Audience:** [Who this is for]  
**Outcome:** [What you'll accomplish]  
**Time:** [How long it takes]

---

## Prerequisites

- [Prerequisite 1]
- [Prerequisite 2]

---

## Steps

### 1. [First Step]

[Instructions]

\`\`\`bash
[Command]
\`\`\`

### 2. [Second Step]

[Instructions]

---

## Validation

✅ [Success criterion 1]  
✅ [Success criterion 2]

---

## Next Steps

- [Related guide]
- [Reference doc]
```

### Reference Template

```markdown
# [Component] Reference

**Auto-generated from \`src/path/to/file.ts\`** (if applicable)  
**Last updated:** [Date]

---

## Overview

[Brief description]

---

## [Section 1]

[Content]

---

## [Section 2]

[Content]

---

## Further Reading

- [Related reference]
- [Source code]
```

---

## Further Reading

- [Development Guide](dev-guide.md) - Contributing workflow
- [Coding Standards](coding-standards.md) - Code quality rules
- [Testing Guide](testing.md) - Test patterns
- [NORTH_STAR.md](../../NORTH_STAR.md) - Vision and narrative

