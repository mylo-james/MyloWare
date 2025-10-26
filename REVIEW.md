# Code Review – 26 Oct 2025

## Critical Findings

1. **Chat persona never receives the curated prompts**  Approved
   `Prepare Agent Input` falls back to `'You are a helpful AI assistant.'` whenever `personaData.system_prompt` is missing, and the value is always missing because `Load Persona` only emits a `prompt_text` field and never builds `system_prompt`. The code also collapses the aggregated prompt array with `String()` and strips quotes/newlines, so even other personas lose heading structure and JSON examples before they reach the LLM (workflows/chat.workflow.json:155, workflows/load-persona.workflow.json:130-150). Result: the Telegram bot behaves like a generic helper with no project memory. **Fix:** have `Load Persona` return a structured `system_prompt` (join persona/project/combination prompts with real newlines) and update callers to use that field rather than silently falling back.



2. **Final render URL is overwritten, so downstream uploads cannot work**  Apprvoed
   The edit workflow correctly marks the run complete and stores the Shotstack URL in `runs.result` (workflows/edit-aismr.workflow.json:260-284). Immediately afterward the parent AISMR workflow unconditionally overwrites the same row with `{status: 'complete', result: 'success'}` (workflows/aismr.workflow.json:450-459). Anything that relies on the stored URL—e.g., the TikTok uploader that performs `HTTP GET $('Get a row').item.json.result`—now receives the literal string `"success"` instead of a video (workflows/upload-to-tiktok.workflow.json:244). **Fix:** let the edit workflow own the terminal status/result write or propagate the URL back to AISMR so it can persist it once.

3. **Idea generator output schema and parser config drifted from the spec**  
   The persona prompt still requires twelve objects with `idea`, `userIdea`, `vibe`, **and `why`** plus strict JSON-only responses (prompts/ideagenerator-aismr.md:8-33). The structured parser, however, only defines `idea`, `userIdea`, and `vibe`, and the `Set` node only persists those fields (workflows/idea-generator.workflow.json:153-165 and 206-250). The missing `why` means downstream reviewers never see the rationale the prompt promises, and schema violations slip through because auto-generated JSON Schema + `autoFix` were never configured despite the documentation claiming they were (STRUCTURED_OUTPUT_FIX.md:15-42). **Fix:** align the parser schema and persistence layer with the contract (add `why`, enforce array length) and update the prompt text or docs accordingly.

4. **Runs can hang forever because every gating workflow polls until success with no timeout or failure path**  For now I'm watching for failures until we can focus on robust error handling. Skip for now.
   The shared `poll-db` workflow just loops `Get a row → Switch → Wait 30 seconds → Get a row` until the target column “exists” (workflows/poll-db.workflow.json:1-183). There is no attempt counter, elapsed-time guard, or error reporting back to the parent run, so a single stuck idea/script/video blocks the entire AISMR orchestration indefinitely. Combined with `Call 'Generate Video'` spawning twelve concurrent renders, a single Veo failure keeps the run in limbo because nothing escalates to `runs.status = failed`. **Fix:** add max-attempt / timeout logic, propagate failures to the `runs` table, and let the parent workflow bail out or skip the offending row instead of spinning forever.

5. **`videos.status` never reaches `upload` or `complete`, so operational dashboards cannot tell when an idea finished**  Approved
   The enum allows `idea_gen`, `script_gen`, `video_gen`, `upload`, `complete`, `failed` (sql/dev-reset.sql:109-121), but the only code path that mutates the field after scripts are written sets `status = video_gen` (workflows/generate-video.workflow.json:280-288). The edit workflow never writes back to `videos`, so rows are permanently stuck in `video_gen`. **Fix:** after the Shotstack montage (or once `video_link` is saved) update the relevant video rows to `complete` (and later `upload`) so progress tracking works.

6. **TikTok automation references a persona that does not exist and depends on the clobbered `runs.result`**  Approved
   The workflow hard-codes persona ID `86fe…` when calling `Load Persona` (workflows/upload-to-tiktok.workflow.json:120-133), but the seed data only defines `7a2c68…` for the Caption & Hashtag Expert (sql/dev-reset.sql:143-147). Load Persona therefore returns zero prompts, and the agent writes captions without any guardrails. The same workflow then tries to download the final edit from `runs.result`, which—as described above—now reads `"success"`. **Fix:** use the canonical persona UUID from the seed data (or a lookup) and stop overwriting the stored edit URL.

## High-Impact Functional Bugs

7. **Prompt aggregation destroys formatting and JSON examples**  Approved
   Before prompts reach any agent, `Load Persona` converts the list of prompts into a single string with `String(item.json.prompt_text)` and then `.replace(/\"/g, "")` and `.replace(/\r?\n|\r/g, " ")` (workflows/load-persona.workflow.json:130-150). That strips JSON quotes, removes newline boundaries, and fuses headings, which makes instructions like “respond with ONLY JSON” ambiguous and harder for the LLM to follow. **Fix:** preserve multi-line Markdown (or render it with actual newline characters) and avoid deleting quotes.

8. **Analytics SQL references columns/tables that are not in the schema**  month is gone, workflow_logs is gone all references (besides month in edit) can be removed
   `sql/queries/generation-analytics.sql` groups by a `month` column that the `videos` table does not have, and `sql/queries/workflow-analytics.sql` depends on a `workflow_logs` table that is never created anywhere in `sql/dev-reset.sql`. The same phantom table is listed as part of the reset verification checklist (docs/DATABASE_RESET.md:81). These scripts currently error out if executed. **Fix:** update the queries to derive month from `created_at` (e.g., `date_trunc('month', created_at)`) and either add the missing `workflow_logs` table or drop the references.

9. **Repository tests are broken and provide zero signal**  no tests have been run really. Remove all tests, they're fake and bad.
   - `npm run test:prompts` fails because `scripts/test-prompts.js` counts every Markdown file except README/backups, so the documentation file `prompts/PROMPT_UPDATES.md` inflates the expected INSERT count to eight while the SQL generator intentionally skips it (scripts/test-prompts.js:29-60, prompts/PROMPT_UPDATES.md:1-4).  
   - The default `npm test` script points to `node --test tests/*.test.js`, but the `tests/` directory is empty, so the command is a no-op (package.json:6-14).  
   Until these are fixed, CI cannot catch regressions in the prompt tooling or workflows. **Fix:** teach the test harness to ignore documentation files (or move them), seed real integration tests under `tests/`, and keep `npm run test:prompts` green.

10. **Documentation and workflow assets are out of sync, leading to bad operator assumptions**  Approved to update documentation. remove old dead files.
    Examples:  
    - `STRUCTURED_OUTPUT_FIX.md` claims both agents now use manual JSON Schema + `autoFix`, but the corresponding nodes still rely on a simple `jsonSchemaExample` and have no format safeguards (STRUCTURED_OUTPUT_FIX.md:15-42 vs. workflows/idea-generator.workflow.json:153-165 and workflows/screen-writer.workflow.json:152-164).  
    - `prompts/README.md` still mentions legacy files such as `chatbot-assistant.md` and 4-second scripts, omitting the new caption persona entirely (prompts/README.md:7-38).  
    - `docs/schema.md` refers to `videos.mood` even though the table column is named `vibe` and shows queries that select a nonexistent `month` field (docs/schema.md:255-276 vs. sql/dev-reset.sql:112-120).  
    These mismatches make it easy for contributors to follow the wrong spec. **Fix:** refresh the docs to match the current schema and prompt set.

## Additional Observations

- `Upload to TikTok` fetches one arbitrary row per run (`limit: 1` without ordering), so even after the persona ID is fixed it will caption a random idea rather than the final edit (workflows/upload-to-tiktok.workflow.json:188-236). Consider sorting by `created_at` or feeding the edit URL deterministically. 

It grabs 1 runId then queries all the videos with that run id.
- `scripts/build-prompts-sql.js` serializes Markdown via `JSON.stringify` and inserts it without `E''`/`$$`, so the database stores literal `\n` sequences; when combined with the prompt-scrubbing code the resulting system prompts are hard to read (scripts/build-prompts-sql.js:52-87).

I've noticed this and it's driving me nuts.
- The comment above the prompts section still advertises `display_order`/`prompt_type`, yet those columns no longer exist (sql/dev-reset.sql:149-151), which can confuse anyone editing the SQL directly.

Remove those.

## Suggested Next Steps

1. Fix the prompt-loading workflow (preserve structure, populate `system_prompt`, add unit tests that assert the string contains headings and JSON instructions).  
2. Remove the redundant run-state overwrite in AISMR, then patch the TikTok uploader to pull the real persona + final video URL.  
3. Bring the idea-generator contract, parser schema, and persistence layer back into alignment (including validation for 12 rows and `why`).  
4. Add bounded retries/timeouts to `poll-db` (and Veo polling) so failed ideas/scripts bubble up to `runs.status = failed` instead of hanging forever.  
5. Repair the test harness (`npm run test:prompts`) and seed meaningful workflow tests so CI catches the above regressions automatically.  
6. Refresh supporting docs/analytics queries to match the actual schema and workflows so handoffs stay accurate.
