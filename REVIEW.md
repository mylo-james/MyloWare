# AISMR Review Notes

## Polling & Gating
- Confirmed the orchestration intentionally fires sub-workflows without waiting, relying on the `poll-db` helper as an external gate. Each poll request loops until all 12 rows expose the required column (e.g., `prompt`, `video_link`), so the downstream node only executes when the entire batch is ready. This matches observed behavior in production; the only required follow-up is future hardening (timeouts, max-attempt counters, consolidated failure reporting) so one stuck idea cannot block the batch indefinitely.

## n8n Node Conventions
- Revalidated that leading `=` prefixes in Supabase node configs (e.g., `tableId: "=videos"`, `column: "=video_link"`) are an n8n syntax quirk that signals “treat the value literally.” Removing them could break node resolution, so no action is needed. Documenting this prevents future refactors from “fixing” something that is already correct.

## Spec Alignment
- Project requirements have shifted: AISMR assets must now be 10 seconds long in a 9:16 aspect ratio. The existing prompts and workflows still describe the legacy 4-second, 2.39:1 brief, so we need to update `prompts/project-aismr.md`, `prompts/screenwriter-aismr.md`, the Veo request builder, and the Shotstack montage logic to keep instructions, generated scripts, and renders consistent with the new art direction.

## Run-Level Tracking
- The database currently tracks per-video status but lacks a holistic `runs` lifecycle indicator. Adding flexible `status`/`result` fields (or similar) gives the orchestrator a single place to record progress: pending → ideas → scripts → videos → complete/failure. This will make it easier for the chat agent or dashboards to report real-time state without inspecting every child video row.

## Idea Generator Scope
- The idea generator still queries the entire `videos` table when checking for duplicates, which will become noisy once additional projects are onboarded. Scoping the Supabase tool to the AISMR project (by `project_id`) keeps uniqueness checks relevant, avoids accidentally blocking good ideas because another project reused a descriptor, and sets the stage for multi-project support later.

## Deferred / Future Items
- Hard-coded persona IDs remain acceptable because the seed data guarantees they exist; we can revisit dynamic lookups when migrations stabilize.
- Centralized error logging and more graceful failure propagation are explicitly deferred until after the project-scoped uniqueness and run-tracking updates land.
- Polling logic hardening (timeouts, aggregated failure output) is acknowledged as a future enhancement once the current priorities are delivered.
