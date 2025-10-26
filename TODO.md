# AISMR Project TODO List

This document synthesizes action items from the code reviews conducted by Gemini, Claude, and Codex on October 17, 2025.

## 🟥 Critical Bugs

- **[N] Fix Infinite Loop in AISMR Workflow:** The `Call 'Upload file to Google Drive'` node incorrectly connects back to the `Loop Over Ideas` node, creating an infinite loop. This connection must be removed. (Gemini, Claude) - This is inacurate. The loop in n8n runs for each item then is done.
- **[?] Fix Broken Video Upload Pipeline:** The `generate-video` workflow downloads the video but does not pass the binary data to the `upload-google-drive` workflow. The connection is missing, and the nodes need to be configured to handle binary data transfer correctly. (Claude, Codex) - Also inaccurate. it passes the binary automatically. if we can find a way to make it explicit instead of relying on n8n's auto passing binary feature great but we'd need to research. 
- **[Y] Fix Screen Writer Persona Scoping:** A filename mismatch (`scriptwriter-aismr.md` vs. persona key `screenwriter`) causes the Level 3 prompt for the Screen Writer to be miscategorized as a Level 2 prompt, breaking the intended prompt hierarchy. Rename the file to `screenwriter-aismr.md`. (Claude, Codex)


## 🟨 Workflow & Orchestration

- **[Y] Implement Robust Error Handling in Loops:** Add error handling (e.g., try/catch blocks) within the main loop of the `AISMR.workflow.json` to prevent a single failed idea from halting the entire batch process. (Gemini, Claude)
- **[Y] Add Timeouts and Retry Limits to Pollers:** The video generation polling loop in `generate-video.workflow.json` lacks a maximum retry count or timeout, risking an infinite loop if the video job fails silently on the provider's end. (Claude)
- **[Y] Handle "Failed" Status in Video Generation:** The status switch in the `generate-video` workflow only handles `completed`, `in_progress`, and `queued`. It needs a branch to handle `failed` or `error` statuses from the Sora API to log the failure and prevent hangs. (Claude)
- **[Y] Add Retry Logic for API Calls:** Implement retry logic with exponential backoff for all external API calls (OpenAI, Sora) to make the workflows more resilient to transient network failures or rate limiting. (Claude)
- **[Y] Consider Parallel Execution for Ideas:** To improve performance, configure the `SplitInBatches` node in the `AISMR` workflow to process ideas in parallel rather than sequentially. (Gemini)
- **[?] Validate Workflow Inputs and Existence Checks:**
  - Improve the `Project Exists?1` check to validate the data structure, not just existence. (Claude) - Instead just error and we can handle the error.
  - The `load-persona` workflow should validate that the requested persona and project exist before attempting to fetch prompts. (Claude) - Instead just error and we can handle the error.
- **[Y] Validate AI-Generated Content:**
  - In `idea-generator.workflow.json`, validate the AI output to ensure it contains exactly 12 ideas, has the correct structure, and contains no duplicates within the batch. (Claude)
  - In `screen-writer.workflow.json`, make the prompt extraction less fragile by validating the structure and length of the generated prompt. (Claude)

## 🟩 Prompt Management System

- **[N] Harden Prompt Build Script:**
  - Decouple the hardcoded `PERSONAS` and `PROJECTS` maps in `build-prompts-sql.js` by loading them from a config file or the database at build time. (Gemini, Claude) our md files are the source of truth so we need to have them be uploaded to the db. I'll edit the md files then put them in the db so... no.
- **[N] Improve `update-dev-reset.js` Script:**
  - Make the marker-based replacement more robust. (Claude)
  - Create a backup of `dev-reset.sql` before writing to it to prevent corruption on failure. (Claude) - I don't think we need all this.
- **[Y] Support YAML Frontmatter for Metadata:** Enhance `build-prompts-sql.js` to parse YAML frontmatter in markdown files for specifying metadata like `model` and `temperature`, making it more flexible. (Claude)

## DATABASE

- **[Y] Add Unique Constraints:** Add unique constraints to the `prompts` table to prevent duplicate entries for the same persona, project, or persona-project combination. (Claude)
- **[Y] Normalize `status` Field:** Convert the `status` text field in the `aismr` table to a proper SQL `ENUM` type (`'pending', 'generating', 'completed', 'failed'`) for better data integrity. (Claude)
- **[Y] Add Foreign Key to `aismr` Table:** The `aismr` table should have a `project_id` foreign key referencing the `projects` table. (Claude)
- **[Y] Add Timestamps for Analytics:** Add `started_at` and `completed_at` timestamp fields to the `aismr` table to track generation times. (Claude)
- **[N] Consider Prompt Versioning:** For a future enhancement, add versioning support to the `prompts` table to track changes and allow rollbacks. (Claude)
- **[?] Optimize Prompt Loading Query:** Refactor the three separate queries in `load-persona.workflow.json` into a single, more efficient SQL query with `OR` conditions. (Claude) - IDK if this is possible with the supabase nodes. if so.. sure but if not... no. Research required.

## 🟦 Documentation & Naming

- **[Y] Fix Naming Inconsistency:** Standardize on `screenwriter` across all files, prompts, and scripts to resolve the `screenwriter` vs. `scriptwriter` issue. (Claude, Codex)
- **[Y] Update Stale Documentation:** The `scripts/README.md` file documents a schema with `display_order` and `prompt_type`, which are obsolete. Update it to reflect the current `level`-based schema. (Codex)
- **[Y] Document Sub-Workflows:** Add high-level documentation for the "black box" sub-workflows (`generate-video`, `upload-google-drive`, etc.) to provide a complete system overview. (Gemini)

## 🟪 Testing & Observability

- **[?] Create Workflow Integration Tests:** There are no automated tests for the n8n workflows. Create a test suite to run end-to-end integration tests on the `AISMR` workflow. (Claude) - Research required for what works with n8n
- **[Y!] Add Logging and Monitoring:** Implement centralized logging for all workflows. Add logging nodes to report success, failure, and key metadata to a `workflow_logs` table in Supabase to improve observability. (Claude) - VERY MUCH NEEDED
- **[Y] Remove Unused Test Script:** The `validate:split` script in `package.json` points to a non-existent test file. Either create the test or remove the script. (Codex)
