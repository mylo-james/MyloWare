# Workflow Review – 2025-11-04

Scope: Verified the “Generate Video”, “Edit_AISMR”, and “Upload to TikTok” n8n workflows against the shared contract of using `workflow_runs` as the state manager plus the `videos` table for per-idea assets. Below are the key findings and required adjustments.

## Shared Expectations Recap
- **Inputs**: Orchestrator calls `Generate Video` with `{ id, runId }`, and the downstream `Edit`/`Upload` flows only receive `{ runId }`. All flows must therefore bootstrap from the database (run + videos) before doing any work.
- **Outputs**: Each stage must patch `workflow_runs.stages` and `workflow_runs.output` without dropping previously recorded data. Video-specific metadata lives in `videos` and is only authoritative for that idea.
- **n8n data constraints**: Binary payloads must travel in the `binary` map (`binary.data` etc.), per the n8n node data-structure spec (Context7 `/n8n-io/n8n-docs`). Relying on JSON fields for binaries will fail downstream nodes.

## Generate Video (`workflows/generate-video.workflow.json`)
- ✅ **State bootstrapping**: `Get Run (API)` pulls the authoritative run via `$json.runId`, and `Mark Run Videos` immediately patches `stages.video_generation = in_progress`, making the DB the single source of truth before any Veo calls (`workflows/generate-video.workflow.json:82-135`).
- ✅ **Output contract**: `Update Run Video Complete` stores `video_generation.output = { ideaId, idea, videoUrl, status, completedAt }` and advances `currentStage` to `publishing`, so later flows can rely solely on `workflow_runs.output.video_generation`.
- ⚠️ **Observation**: The videos table update (`Update a row`) only writes `status` and `videoLink`. If you expect downstream tooling (e.g., analytics) to read the `videos` record for `idea`, `prompt`, etc., consider expanding that payload, but this does not currently block stage alignment.

## Edit_AISMR (`workflows/edit-aismr.workflow.json`)
- ❌ **Run lookup uses the wrong field**: Both `Get many rows (API)` and `Get Run (API)` reference `$json.workflowRun.id`, but the trigger only receives `{ runId }`. Unless the caller inlines an entire run object (it doesn’t—see `Call Edit AISMR` in `workflows/aismr.workflow.json:452-489`), these HTTP nodes call `/api/.../undefined` and the flow never hydrates state (`workflows/edit-aismr.workflow.json:23-42` and `workflows/edit-aismr.workflow.json:208-220`).
  - **Fix**: Swap those expressions to `$('When Executed by Another Workflow').item.json.runId` (consistent with `Generate Video` and `Upload to TikTok`). Once corrected, the downstream `Normalize Run` node can keep using `$json.workflowRun` because the API will finally return the run object.
- ⚠️ **Video list fetch bypasses DB**: For the same reason, `/api/videos?run=` is currently invoked with an empty value, so the edit packager silently falls back on pinned data. After the runId fix, confirm the API is returning the filtered list so the Shotstack JSON builder really composes from database state.
- ✅ **Output contract**: `Mark Run Complete` merges `editUrl`/`editId` into `stages.publishing.output` while leaving the stage `in_progress`, which matches the intent of “editing is part of publishing but not complete yet” (`workflows/edit-aismr.workflow.json:258-279`).

## Upload to TikTok (`workflows/upload-to-tiktok.workflow.json`)
- ✅ **State usage**: The flow pulls the run via `$json.runId`, normalizes it (`Get a row`), and always picks `publishing.editUrl` before falling back to `video_generation.videoUrl`, so it honors the DB-first contract (`workflows/upload-to-tiktok.workflow.json:234-280`).
- ❌ **Binary hand-off is broken**: The download node (`HTTP Request`) never sets `responseFormat: file`, so n8n outputs JSON instead of populating `binary.data`, yet the Upload node expects a binary property called `data` (`workflows/upload-to-tiktok.workflow.json:234-268`). Per the n8n data-structure spec, you must enable “Download”/`responseFormat: file` (and optionally set `binaryPropertyName: data`) so the preceding node writes base64 data under `binary.data`. Without that, TikTok uploads will fail as soon as the response body exceeds JSON limits.
- ⚠️ **Caption dependency**: `Upload Video and Description to TikTok` reads `$json.output.caption`, which only exists if the upstream AI Agent succeeded. Consider guarding this with a default or ensuring `Structured Output Parser` feeds an explicit fallback to avoid PATCH payloads with `undefined` titles.

## Recommendations
1. **Update Edit_AISMR inputs** – Replace every `$json.workflowRun.id` reference in request URLs with the actual `runId` from the trigger so the workflow always hits the DB before composing edits.
2. **Verify video query after fix** – Once the correct runId is sent, confirm `/api/videos?run={runId}` returns only the clips for that run; keep logging in the Code node to ensure the DB remains the single truth for clip ordering.
3. **Fix TikTok binary transfer** – Set `HTTP Request → Response → Response Format = File` and `Binary Property = data`, or drop in a short Code node that maps the binary buffer into `binary.data`, aligning with the n8n spec. This unblocks `Upload Video and Description to Tiktok`.
4. **Optional hardening** – Add lightweight assertions (Code node or IF) before every external call so that missing DB fields (idea prompt, editUrl, caption) fail fast with a DB-backed error entry instead of silent null propagation.

These changes keep every flow aligned on the shared DB-managed contract while complying with n8n’s data requirements. Let me know if you’d like patches for the JSON workflows or accompanying regression tests once the orchestration is updated.
