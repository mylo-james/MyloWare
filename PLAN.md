# AISMR Step-by-Step Plan
**Date:** October 26, 2025

## 1. Scope Idea Uniqueness to the AISMR Project
[x] 1.1 Update `workflows/AISMR.workflow.json` so every call into `idea-generator.workflow.json` passes `projectId` alongside `runId` and `userInput` (value comes from the AISMR project lookup already performed at the start of the workflow).
[x] 1.2 Modify `workflows/idea-generator.workflow.json` to accept `projectId` as an input, threading it to the Supabase tool node.
[x] 1.3 In the "Query Ideas from Database" node, add filters for `project_id = $json.projectId` so duplicates are checked only within AISMR.
[x] 1.4 Regenerate seed data or adjust `sql/dev-reset.sql` if needed to ensure sample rows include `project_id`, then smoke-test the workflow to confirm 12 unique ideas are still produced.

## 2. Add Run-Level Status & Result Tracking
[x] 2.1 Extend the `runs` table definition in `sql/dev-reset.sql` with two new TEXT columns (`status` and `result` or similar) plus comments describing their intent; set sensible defaults (e.g., `status = 'pending'`).
[x] 2.2 Update any seed data inserts in the same file to populate the new columns.
[x] 2.3 In `workflows/AISMR.workflow.json`, add Set/Supabase nodes (or extend existing ones) so the orchestrator writes:
[x]    - `status = 'ideas'` after the idea generator kicks off.
[x]    - `status = 'scripts'` once all prompts are written.
[x]    - `status = 'videos'` when Veo jobs are enqueued and `status/result = 'complete'` once Shotstack finishes.
[x] 2.4 Ensure downstream sub-workflows (`idea-generator`, `screen-writer`, `generate-video`, `edit-aismr`) update `runs.status` or `runs.result` if they hit fatal errors so the chat agent can report back.
[ ] 2.5 Rerun the orchestrator end-to-end (with pinned data if necessary) and verify the `runs` table now shows the lifecycle progression.

## 3. Align Specs & Assets with 10s / 9:16 Output
[x] 3.1 Update `prompts/project-aismr.md` and `prompts/screenwriter-aismr.md` to describe the new 10-second, vertical-format requirement (timeline beats, camera framing, color guidance, etc.).
[x] 3.2 Adjust `workflows/generate-video.workflow.json` so the Set node sends `seconds = 10` and `aspect_ratio = '9:16'` (or whatever keys the provider expects) and confirm the HTTP body actually references those properties.
[x] 3.3 Review `workflows/edit-aismr.workflow.json` (Shotstack assembly) to ensure clip lengths, labels, and render resolution match the new spec.
[x] 3.4 Once workflows and prompts are updated, regenerate any seed/example prompts or video rows in `sql/dev-reset.sql` so documentation, data, and automation stay in sync.

## 4. Future Hardening (Backlog)
- Add timeout/failure aggregation to the `poll-db` gate so one stuck idea can’t block the batch indefinitely.
- Centralize richer error logging/handling once the scoped changes above are shipped.
