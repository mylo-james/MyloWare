# Quick Reference: Prompt Management

## Update Prompts

After editing any file in `prompts/`:

```bash
npm run update:dev-reset
```

This regenerates the SQL and updates `sql/dev-reset.sql`.

## Naming Convention

- `persona-{name}.md` → Persona-level prompt (applies everywhere)
- `project-{name}.md` → Project-level prompt (applies to all personas)
- `{persona}-{project}.md` → Specific combination prompt

Examples:

- `persona-chat.md` → Chatbot persona
- `project-aismr.md` → AISMR project context
- `ideagenerator-aismr.md` → Idea Generator for AISMR

## Available Personas

- `chat` → Chatbot
- `ideagenerator` → Idea Generator
- `screenwriter` → Screen Writer

## Available Projects

- `aismr` → AISMR

## Full Documentation

See `/scripts/README.md` for complete documentation.
