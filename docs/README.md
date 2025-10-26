# AISMR Prompts

Markdown sources for every persona, project, and persona×project system prompt that the AISMR workflows consume. The `scripts/build-prompts-sql.js` task converts these files into SQL seed statements, and the shared **Load Persona** workflow fetches them at runtime to assemble a newline-preserving `system_prompt` for the LLMs.

## File Map

| Scope | File | Purpose |
| --- | --- | --- |
| Persona | `persona-chat.md` | Telegram assistant tone, safety policy, and tool usage |
| Persona | `persona-ideagenerator.md` | Baseline rules for the 12-idea generator agent |
| Persona | `persona-screenwriter.md` | Craft guidelines for the cinematic prompt writer |
| Persona | `persona-captionhashtag.md` | Caption & Hashtag Expert used by the TikTok uploader |
| Project | `project-aismr.md` | AISMR brand DNA: impossible-but-tactile vibe, audio rules, deliverable format |
| Persona × Project | `ideagenerator-aismr.md` | Adds AISMR-specific constraints (uniqueness checks, vibes, JSON contract) to the idea agent |
| Persona × Project | `screenwriter-aismr.md` | AISMR version of the scripting prompt (10-second Veo brief, texture/audiobed requirements) |
| Reference | `PROMPT_UPDATES.md` | Changelog + manual test steps for prompt edits |

> **Tip:** Base persona files stay short and timeless. Project files capture shared production context, and the combined `*-aismr.md` files add run-specific instructions that only make sense when both IDs are present.

## How the files reach Supabase

1. Run `npm run build:prompts` after editing any Markdown file.
2. The script reads every `prompts/*.md` file (except `PROMPT_UPDATES.md`), escapes markdown, and writes `sql/prompts-inserts.sql` plus inline blocks in `sql/dev-reset.sql`.
3. The Supabase migrations ingest those statements, keeping persona-, project-, and combo-level prompts in a single `prompts` table. The generated `level` column (1, 2, or 3) indicates which scope each row belongs to and drives sorting in the loader workflow.

## How workflows consume prompts

- Workflows call **Load Persona** with a `personaId` (and optionally a `runId`).
- The loader pulls:
  - Level 1 prompts (`persona_id` only)
  - Level 2 prompts (`project_id` only)
  - Level 3 prompts (both IDs)
- Prompts are sorted by `level` and creation order, then joined with real newline characters into a single `system_prompt` string returned to the caller.
- Downstream nodes (Idea Generator, Screen Writer, Chatbot, Caption writer) now bind `system_prompt` directly to their LangChain agent `systemMessage`, ensuring headings, JSON examples, and code blocks survive intact.

## Editing checklist

1. Update the relevant Markdown file(s) in this folder.
2. Add a note to `PROMPT_UPDATES.md` describing the change and why.
3. Run `npm run build:prompts` to regenerate the SQL artifacts.
4. Run `npm run test:prompts` (once the harness is restored) to make sure every Markdown file has a matching INSERT.
5. Commit both the Markdown changes and the regenerated SQL so Supabase stays in sync.

Sticking to this flow keeps the docs, migrations, and workflows aligned—no more mystery prompts living only inside n8n exports.
