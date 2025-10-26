# AISMR Project Implementation Plan

**Date:** October 17, 2025  
**Goal:** Improve reliability, observability, and data integrity of the AISMR workflow system

## Project Direction

Based on the approved TODO items, this project is focused on:

1. **Observability First** - Implement comprehensive logging to monitor all workflows
2. **Data Integrity** - Strengthen database schema with proper constraints and types
3. **Resilience** - Add error handling, retry logic, and validation throughout
4. **Performance** - Enable parallel processing for better throughput
5. **Maintainability** - Clean up naming inconsistencies and update documentation

The approach is pragmatic: fix what's broken, add visibility where it's missing, and optimize for reliability over complexity.

---

## Phase 1: Foundation & Quick Wins

**Objective:** Fix critical naming issues and strengthen database schema

### 1.1 Fix Screen Writer Naming Inconsistency

**Problem:** File is named `scriptwriter-aismr.md` but the persona key is `screenwriter`, causing Level 3 prompts to be miscategorized as Level 2.

- [x] **Rename prompt file**
  - [x] Rename `prompts/scriptwriter-aismr.md` to `prompts/screenwriter-aismr.md`
  - [x] Verify no other files reference `scriptwriter` name
  - [x] Run `npm run build:prompts` to regenerate SQL
- [x] **Regenerate and apply database**
  - [x] Run `npm run update:dev-reset` to update SQL
  - [x] Review generated SQL in `sql/dev-reset.sql` to confirm the INSERT now uses correct persona lookup
  - [ ] Run `npm run dev-reset` to apply changes to database
- [ ] **Verify fix**
  - [ ] Check that the prompt now appears as Level 3 (persona-project) in database
  - [ ] Test Screen Writer workflow to ensure it loads all three prompt levels correctly

**Files to modify:**

- `prompts/scriptwriter-aismr.md` → `prompts/screenwriter-aismr.md`

---

### 1.2 Database Schema Improvements

**Objective:** Add constraints, proper types, and foreign keys to ensure data integrity

#### 1.2.1 Add Status ENUM Type

**Why:** Text fields are error-prone; ENUMs enforce valid values at the database level.

- [x] **Create migration file**
  - [ ] Create new file: `supabase/migrations/20251017_status_enum.sql`
  - [ ] Add SQL to create ENUM type:
    ```sql
    CREATE TYPE video_status AS ENUM ('pending', 'generating', 'completed', 'failed');
    ```
  - [ ] Add SQL to convert existing column:
    ```sql
    ALTER TABLE aismr
    ALTER COLUMN status TYPE video_status
    USING status::video_status;
    ```
- [x] **Update dev-reset.sql**
  - [ ] Add ENUM type creation before the `aismr` table definition
  - [ ] Update table definition to use `video_status` type instead of TEXT
  - [ ] Update CHECK constraint to reference the ENUM
- [ ] **Test migration**
  - [ ] Run `npm run dev-reset` to test the updated schema
  - [ ] Verify that invalid status values are rejected by the database
  - [ ] Check that existing data migrates correctly

**Files to modify:**

- `supabase/migrations/20251017_status_enum.sql` (new)
- `sql/dev-reset.sql`

---

#### 1.2.2 Add Foreign Key to AISMR Table

**Why:** Ensures referential integrity between AISMR ideas and their projects.

- [x] **Update migration file**
  - [ ] Add to the same migration or create `supabase/migrations/20251017_aismr_fk.sql`
  - [ ] Add SQL:
    ```sql
    ALTER TABLE aismr ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
    CREATE INDEX idx_aismr_project ON aismr(project_id);
    ```
  - [ ] Add SQL to backfill existing rows:
    ```sql
    UPDATE aismr SET project_id = (SELECT id FROM projects WHERE name = 'AISMR' LIMIT 1) WHERE project_id IS NULL;
    ```
- [x] **Update dev-reset.sql**
  - [ ] Add `project_id UUID REFERENCES projects(id)` to table definition
  - [ ] Add the index creation
  - [ ] Update sample data inserts to include `project_id`
- [x] **Update workflows**
  - [ ] In `idea-generator.workflow.json`, update the Supabase insert node to include `project_id` field
  - [ ] Pass `projectId` from the AISMR workflow to the idea generator
- [ ] **Test**
  - [ ] Run `npm run dev-reset`
  - [ ] Verify foreign key constraint works (try inserting with invalid project_id)
  - [ ] Test idea generation workflow to ensure project_id is populated

**Files to modify:**

- `supabase/migrations/20251017_aismr_fk.sql` (new)
- `sql/dev-reset.sql`
- `workflows/idea-generator.workflow.json`

---

#### 1.2.3 Add Unique Constraints to Prompts Table

**Why:** Prevents duplicate prompts from being inserted for the same persona/project combination.

- [x] **Create migration**
  - [ ] Create `supabase/migrations/20251017_prompts_unique.sql`
  - [ ] Add three partial unique indexes:

    ```sql
    -- Prevent duplicate persona-only prompts
    CREATE UNIQUE INDEX idx_unique_persona_prompt
    ON prompts(persona_id)
    WHERE persona_id IS NOT NULL AND project_id IS NULL;

    -- Prevent duplicate project-only prompts
    CREATE UNIQUE INDEX idx_unique_project_prompt
    ON prompts(project_id)
    WHERE persona_id IS NULL AND project_id IS NOT NULL;

    -- Prevent duplicate persona-project prompts
    CREATE UNIQUE INDEX idx_unique_persona_project_prompt
    ON prompts(persona_id, project_id)
    WHERE persona_id IS NOT NULL AND project_id IS NOT NULL;
    ```
- [x] **Update dev-reset.sql**
  - [x] Add these index definitions after the prompts table creation
  - [ ] Ensure no duplicate prompts exist in the sample data
- [ ] **Test**
  - [ ] Run `npm run dev-reset`
  - [ ] Try running `npm run dev-reset` again (should succeed with unique constraints)
  - [ ] Attempt to manually insert duplicate prompts to verify constraints work

**Files to modify:**

- `supabase/migrations/20251017_prompts_unique.sql` (new)
- `sql/dev-reset.sql`

---

#### 1.2.4 Add Timestamp Fields for Analytics

**Why:** Track when video generation starts and completes for performance monitoring.

- [x] **Create migration**
  - [ ] Add to `supabase/migrations/20251017_aismr_timestamps.sql`
  - [ ] Add columns:
    ```sql
    ALTER TABLE aismr ADD COLUMN started_at TIMESTAMPTZ;
    ALTER TABLE aismr ADD COLUMN completed_at TIMESTAMPTZ;
    ```
- [x] **Update dev-reset.sql**
  - [ ] Add these columns to the `aismr` table definition
  - [ ] Update sample data to include example timestamps
- [x] **Update workflows**
  - [ ] In `screen-writer.workflow.json`, when setting status to 'generating', also set `started_at = NOW()`
  - [ ] In `generate-video.workflow.json`, when status becomes 'completed', set `completed_at = NOW()`
- [x] **Add analytics query**
  - [ ] Create `sql/queries/generation-analytics.sql` with queries like:
    ```sql
    -- Average generation time by month
    SELECT
      month,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_seconds
    FROM aismr
    WHERE started_at IS NOT NULL AND completed_at IS NOT NULL
    GROUP BY month;
    ```
- [ ] **Test**
  - [ ] Run `npm run dev-reset`
  - [ ] Run a test workflow and verify timestamps are populated
  - [ ] Run analytics query to verify it works

**Files to modify:**

- `supabase/migrations/20251017_aismr_timestamps.sql` (new)
- `sql/dev-reset.sql`
- `workflows/screen-writer.workflow.json`
- `workflows/generate-video.workflow.json`
- `sql/queries/generation-analytics.sql` (new)

---

### 1.3 Clean Up Package.json

- [x] **Remove unused script**
  - [ ] Open `package.json`
  - [ ] Remove the `"validate:split": "node --test tests/workflow-invariants.test.js"` line
  - [ ] Verify no other files reference this script
- [ ] **Test**
  - [ ] Run `npm test` to ensure remaining scripts work

**Files to modify:**

- `package.json`

---

## Phase 2: Observability Infrastructure (CRITICAL)

**Objective:** Implement comprehensive logging system to monitor all workflow executions

### 2.1 Create Workflow Logs Database Table

- [x] **Design schema**
  - [ ] Create `supabase/migrations/20251017_workflow_logs.sql`
  - [ ] Define table:

    ```sql
    CREATE TABLE workflow_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_name TEXT NOT NULL,
      workflow_id TEXT,
      execution_id TEXT,
      node_name TEXT,
      status TEXT NOT NULL CHECK (status IN ('started', 'success', 'error', 'warning')),
      message TEXT,
      error_details JSONB,
      metadata JSONB DEFAULT '{}',
      duration_ms INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX idx_workflow_logs_name ON workflow_logs(workflow_name, created_at DESC);
    CREATE INDEX idx_workflow_logs_status ON workflow_logs(status, created_at DESC);
    CREATE INDEX idx_workflow_logs_execution ON workflow_logs(execution_id);
    ```
- [x] **Update dev-reset.sql**
  - [ ] Add the table creation to dev-reset.sql
- [ ] **Test**
  - [ ] Run `npm run dev-reset`
  - [ ] Verify table exists with correct schema
  - [ ] Test manual insert to verify constraints work

**Files to modify:**

- `supabase/migrations/20251017_workflow_logs.sql` (new)
- `sql/dev-reset.sql`

---

### 2.2 Create Reusable Logging Workflow

**Why:** Centralized logging logic that can be called from any workflow

- [x] **Create logging sub-workflow**
  - [ ] Create new n8n workflow named "Log to Database"
  - [ ] Add "When Executed by Another Workflow" trigger node
  - [ ] Configure trigger to accept inputs:
    - `workflow_name` (required)
    - `workflow_id` (optional)
    - `execution_id` (optional)
    - `node_name` (optional)
    - `status` (required: started/success/error/warning)
    - `message` (optional)
    - `error_details` (optional, object)
    - `metadata` (optional, object)
    - `duration_ms` (optional)
- [x] **Add Supabase insert node**
  - [ ] Connect to `workflow_logs` table
  - [ ] Map all input fields to table columns
  - [ ] Set `created_at` to use NOW()
- [ ] **Add error handling**
  - [ ] Wrap insert in try/catch
  - [ ] On logging failure, output to console (don't fail the parent workflow)
- [x] **Export workflow**
  - [x] Save as `workflows/log-to-database.workflow.json`
  - [x] Document the workflow inputs in the file

**Files to create:**

- `workflows/log-to-database.workflow.json`

---

### 2.3 Add Logging to AISMR Workflow

- [x] **Add workflow start logging**
  - [ ] At the beginning of AISMR workflow, after "When Executed by Another Workflow"
  - [ ] Add "Execute Workflow" node calling "Log to Database"
  - [ ] Pass parameters:
    ```json
    {
      "workflow_name": "AISMR",
      "execution_id": "={{ $execution.id }}",
      "node_name": "Workflow Start",
      "status": "started",
      "message": "AISMR workflow started",
      "metadata": {
        "userInput": "={{ $json.userInput }}",
        "sessionId": "={{ $json.sessionId }}"
      }
    }
    ```
- [ ] **Add project config logging**
  - [ ] After "Get Project Config1" succeeds
  - [ ] Log success with project details in metadata
- [ ] **Add error logging for project not found**
  - [ ] In the "Error - Project Not Found1" branch
  - [ ] Log error status with error message
- [ ] **Add idea generation logging**
  - [ ] Before calling "Generate Ideas" sub-workflow
  - [ ] Log "started" status
  - [ ] After it returns, log "success" with idea count in metadata
- [ ] **Add loop iteration logging**
  - [ ] Inside the loop, log each iteration start
  - [ ] Track iteration number and current idea in metadata
- [ ] **Add completion logging**
  - [ ] After loop completes successfully
  - [ ] Log "success" status with total count and duration
- [ ] **Add error handling with logging**
  - [ ] Wrap the entire workflow in error handling
  - [ ] On any error, log it with full error details
- [ ] **Test logging**
  - [ ] Run AISMR workflow with test data
  - [ ] Query `workflow_logs` table to verify all events are captured
  - [ ] Verify error paths log correctly

**Files to modify:**

- `workflows/AISMR.workflow.json`

---

### 2.4 Add Logging to Idea Generator Workflow

- [x] **Add start logging**
  - [ ] After trigger, log workflow start with input parameters
- [ ] **Add persona loading logging**
  - [ ] Before and after "Load Persona" call
  - [ ] Log the number of prompts loaded
- [ ] **Add AI generation logging**
  - [ ] Before AI agent call, log "started"
  - [ ] After AI agent returns, log "success" with output preview
- [ ] **Add validation logging**
  - [ ] Log validation results (number of ideas, duplicate checks)
- [ ] **Add database insert logging**
  - [ ] Before bulk insert, log "started"
  - [ ] After insert, log "success" with IDs of created ideas
- [ ] **Add error logging**
  - [ ] Catch any errors and log with full context
  - [ ] Include AI output if generation failed during validation
- [ ] **Test**
  - [ ] Run workflow and verify logs
  - [ ] Intentionally trigger validation errors and verify they're logged

**Files to modify:**

- `workflows/idea-generator.workflow.json`

---

### 2.5 Add Logging to Screen Writer Workflow

- [ ] **Add start logging**
  - [ ] Log workflow start with idea ID
- [ ] **Add data fetch logging**
  - [ ] Log when fetching AISMR row from database
- [ ] **Add persona loading logging**
  - [ ] Log persona loading operation
- [ ] **Add AI generation logging**
  - [ ] Before and after AI agent call
  - [ ] Log prompt generation success
- [ ] **Add validation logging**
  - [ ] Log validation of generated prompt
- [ ] **Add database update logging**
  - [ ] Log database update with new prompt and status
- [ ] **Add error logging**
  - [ ] Catch and log all errors with context
- [ ] **Test**
  - [ ] Run workflow and verify all logs
  - [ ] Test error scenarios

**Files to modify:**

- `workflows/screen-writer.workflow.json`

---

### 2.6 Add Logging to Generate Video Workflow

- [ ] **Add start logging**
  - [ ] Log workflow start with idea ID
- [ ] **Add API call logging**
  - [ ] Log before calling Sora API to create video
  - [ ] Log success with video_id returned
- [ ] **Add polling logging**
  - [ ] Log each status check (but rate-limit to avoid spam)
  - [ ] Log status transitions (queued → in_progress → completed)
- [ ] **Add completion logging**
  - [ ] Log when video is fully generated and downloaded
  - [ ] Include generation time in metadata
- [ ] **Add error logging**
  - [ ] Log API failures
  - [ ] Log timeout if polling exceeds limit
  - [ ] Log failed status from API
- [ ] **Test**
  - [ ] Run workflow and verify polling logs
  - [ ] Verify timeout logging (if implemented)

**Files to modify:**

- `workflows/generate-video.workflow.json`

---

### 2.7 Add Logging to Upload Workflow

- [ ] **Add start logging**
  - [ ] Log upload start with file details
- [ ] **Add folder search logging**
  - [ ] Log folder search and creation if needed
- [ ] **Add upload logging**
  - [ ] Log successful upload with Drive link
  - [ ] Log file size and upload duration if available
- [ ] **Add database update logging**
  - [ ] Log when updating AISMR row with video_link
- [ ] **Add error logging**
  - [ ] Log upload failures with error details
- [ ] **Test**
  - [ ] Run upload and verify logs
  - [ ] Test with missing folder scenario

**Files to modify:**

- `workflows/upload-google-drive.workflow.json`

---

### 2.8 Create Logging Dashboard Query

- [x] **Create analytics queries**
  - [ ] Create `sql/queries/workflow-analytics.sql`
  - [ ] Add queries:

    ```sql
    -- Success rate by workflow
    SELECT
      workflow_name,
      COUNT(*) FILTER (WHERE status = 'success') as successes,
      COUNT(*) FILTER (WHERE status = 'error') as errors,
      ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'success') / COUNT(*), 2) as success_rate
    FROM workflow_logs
    GROUP BY workflow_name;

    -- Recent errors
    SELECT created_at, workflow_name, node_name, message, error_details
    FROM workflow_logs
    WHERE status = 'error'
    ORDER BY created_at DESC
    LIMIT 20;

    -- Average duration by workflow
    SELECT
      workflow_name,
      AVG(duration_ms) as avg_duration_ms,
      MAX(duration_ms) as max_duration_ms
    FROM workflow_logs
    WHERE duration_ms IS NOT NULL
    GROUP BY workflow_name;
    ```
- [ ] **Test queries**
  - [ ] Run each query against populated logs
  - [ ] Verify they return useful insights

**Files to create:**

- `sql/queries/workflow-analytics.sql`

---

## Phase 3: Validation & Error Handling

**Objective:** Add robust validation and graceful error handling throughout the system

### 3.1 Improve Idea Generator Validation

- [ ] **Add output validation node**
  - [ ] After "Convert to Items" node in idea-generator workflow
  - [ ] Add JavaScript code node named "Validate Ideas"
  - [ ] Implement validation:

    ```javascript
    const ideas = $input.all();

    // Check count
    if (ideas.length !== 12) {
      throw new Error(`Expected 12 ideas, got ${ideas.length}`);
    }

    // Check structure
    ideas.forEach((item, idx) => {
      const json = item.json;
      if (!json.month || !json.idea || !json.mood) {
        throw new Error(
          `Idea ${idx} missing required fields: ${JSON.stringify(json)}`
        );
      }
      if (typeof json.month !== 'string' || json.month.length === 0) {
        throw new Error(`Idea ${idx} has invalid month: ${json.month}`);
      }
      if (typeof json.idea !== 'string' || json.idea.length < 3) {
        throw new Error(`Idea ${idx} has invalid idea: ${json.idea}`);
      }
      if (typeof json.mood !== 'string' || json.mood.length === 0) {
        throw new Error(`Idea ${idx} has invalid mood: ${json.mood}`);
      }
    });

    // Check for duplicates
    const ideaTexts = ideas.map((item) => item.json.idea.toLowerCase().trim());
    const uniqueIdeas = new Set(ideaTexts);
    if (uniqueIdeas.size !== ideaTexts.length) {
      throw new Error('Duplicate ideas detected in batch');
    }

    // Check for duplicate months
    const months = ideas.map((item) => item.json.month);
    const uniqueMonths = new Set(months);
    if (uniqueMonths.size !== months.length) {
      throw new Error('Duplicate months detected in batch');
    }

    return ideas;
    ```
- [ ] **Add error handler**
  - [ ] Wrap validation in try/catch
  - [ ] On error, log to database
  - [ ] Include the AI output in error_details for debugging
  - [ ] Optionally: retry the AI generation once on validation failure
- [ ] **Test validation**
  - [ ] Mock AI output with wrong count (e.g., 11 ideas)
  - [ ] Mock AI output with missing fields
  - [ ] Mock AI output with duplicate ideas
  - [ ] Verify each triggers appropriate error with clear message

**Files to modify:**

- `workflows/idea-generator.workflow.json`

---

### 3.2 Improve Screen Writer Validation

- [ ] **Add output validation node**
  - [ ] After extracting prompt in screen-writer workflow
  - [ ] Add JavaScript code node named "Validate Prompt"
  - [ ] Implement validation:

    ```javascript
    const output = $input.all()[0].json.output;

    // Check output is array
    if (!output || !Array.isArray(output) || output.length === 0) {
      throw new Error('AI did not generate output array');
    }

    const promptData = output[0];

    // Check structure
    if (!promptData.month || !promptData.idea || !promptData.prompt) {
      throw new Error(
        `Invalid prompt structure: ${JSON.stringify(promptData)}`
      );
    }

    // Check prompt length
    if (promptData.prompt.length < 100) {
      throw new Error(
        `Generated prompt too short (${promptData.prompt.length} chars), likely incomplete`
      );
    }

    // Check prompt has required sections (basic check)
    const requiredSections = ['Scene', 'Camera', 'Audio'];
    const missingSection = requiredSections.find(
      (section) => !promptData.prompt.includes(section)
    );
    if (missingSection) {
      console.warn(`Warning: Prompt may be missing ${missingSection} section`);
    }

    return [{ json: promptData }];
    ```
- [ ] **Add error handler**
  - [ ] Wrap validation in try/catch
  - [ ] Log errors with full context
  - [ ] Include idea details in error log
- [ ] **Test validation**
  - [ ] Mock short prompt
  - [ ] Mock malformed output
  - [ ] Verify errors are caught and logged

**Files to modify:**

- `workflows/screen-writer.workflow.json`

---

### 3.3 Add Error Handling to AISMR Loop

**Objective:** Prevent one failed idea from stopping the entire batch

- [ ] **Restructure loop with error handling**
  - [ ] Inside the "Loop Over Ideas", after each sub-workflow call:
  - [ ] Add an "IF" node to check if the sub-workflow succeeded
  - [ ] On success: continue to next step
  - [ ] On error: log the error and continue to next iteration
- [ ] **Create error tracking**
  - [ ] At workflow start, initialize an array to collect errors
  - [ ] After each loop iteration, if there was an error, append it to the array
  - [ ] At workflow end, if errors array is not empty, log a summary
- [ ] **Update loop completion logging**
  - [ ] Log total ideas processed
  - [ ] Log successful count
  - [ ] Log failed count
  - [ ] Include error summary in metadata
- [ ] **Test error handling**
  - [ ] Intentionally break one idea (e.g., invalid data)
  - [ ] Verify workflow continues and processes remaining ideas
  - [ ] Verify error is logged and summarized at end

**Files to modify:**

- `workflows/AISMR.workflow.json`

---

### 3.4 Add Timeout and Retry to Video Generation Polling

- [ ] **Add polling counter**
  - [ ] Before the "Wait" node in generate-video workflow
  - [ ] Add a "Set" node to initialize or increment a counter
  - [ ] Store counter in workflow static data or context
- [ ] **Add timeout check**
  - [ ] After "Wait" node, before "Check Status"
  - [ ] Add "IF" node to check if counter exceeds maximum (e.g., 40 iterations = 20 minutes)
  - [ ] On timeout:
    - [ ] Log error with timeout details
    - [ ] Update AISMR row status to 'failed'
    - [ ] Exit workflow with error
- [ ] **Add failed status handling**
  - [ ] In the "Status Switch" node, add a new output branch
  - [ ] Add condition for `status === 'failed'` or `status === 'error'`
  - [ ] On failed status:
    - [ ] Log the failure
    - [ ] Update database status to 'failed'
    - [ ] Include API error details in log
    - [ ] Exit workflow
- [ ] **Test timeout**
  - [ ] Mock a video that never completes (by setting max iterations to 2)
  - [ ] Verify timeout is triggered and logged
  - [ ] Verify database is updated with 'failed' status

**Files to modify:**

- `workflows/generate-video.workflow.json`

---

### 3.5 Add Retry Logic for API Calls

**Objective:** Make workflows resilient to transient API failures

- [ ] **Create retry wrapper workflow**
  - [ ] Create new workflow named "Retry API Call"
  - [ ] Accept inputs: target_workflow, params, max_retries (default 3), backoff_ms (default 1000)
  - [ ] Implement retry logic:

    ```javascript
    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
      try {
        // Call target workflow
        const result = await executeWorkflow(targetWorkflow, params);
        return result;
      } catch (error) {
        attempt++;
        lastError = error;
        if (attempt < maxRetries) {
          // Exponential backoff: wait 1s, 2s, 4s, etc.
          await sleep(backoffMs * Math.pow(2, attempt - 1));
        }
      }
    }
    throw new Error(`Failed after ${maxRetries} attempts: ${lastError}`);
    ```
- [ ] **Update idea generator to use retry**
  - [ ] Wrap the AI agent call with retry logic
  - [ ] Set max_retries to 2 for AI calls
- [ ] **Update screen writer to use retry**
  - [ ] Wrap the AI agent call with retry logic
- [ ] **Update generate video to use retry**
  - [ ] Wrap the "Create Video" API call with retry logic
  - [ ] Set max_retries to 3 for video creation
- [ ] **Test retry logic**
  - [ ] Mock an API that fails twice then succeeds
  - [ ] Verify retry happens and eventually succeeds
  - [ ] Verify logs show retry attempts

**Files to create:**

- `workflows/retry-api-call.workflow.json`

**Files to modify:**

- `workflows/idea-generator.workflow.json`
- `workflows/screen-writer.workflow.json`
- `workflows/generate-video.workflow.json`

---

## Phase 4: Performance & Optimization

**Objective:** Improve throughput and processing speed

### 4.1 Enable Parallel Execution for Ideas

- [ ] **Update AISMR workflow batch settings**
  - [ ] Open `workflows/AISMR.workflow.json` in n8n editor
  - [ ] Select the "Loop Over Ideas" (SplitInBatches) node
  - [ ] In node settings, find the batch/parallel execution options
  - [ ] Enable "Execute in parallel" if available
  - [ ] Set parallel execution limit (e.g., 3-5 concurrent ideas)
- [ ] **Test parallel execution**
  - [ ] Run AISMR workflow with 12 ideas
  - [ ] Monitor logs to verify multiple ideas are processed simultaneously
  - [ ] Verify all ideas complete successfully
  - [ ] Check for race conditions or resource conflicts
- [ ] **Monitor performance**
  - [ ] Compare total execution time before and after parallelization
  - [ ] Query workflow_logs to calculate duration improvement
  - [ ] Document the performance gain in SYSTEM-SUMMARY.md

**Files to modify:**

- `workflows/AISMR.workflow.json`

---

### 4.2 Optimize Prompt Loading (Research First)

- [ ] **Research Supabase node capabilities**
  - [ ] Check if Supabase node in n8n supports complex WHERE clauses with OR
  - [ ] Test a single query with OR conditions:
    ```sql
    WHERE
      (persona_id = :persona_id AND project_id IS NULL) OR
      (project_id = :project_id AND persona_id IS NULL) OR
      (persona_id = :persona_id AND project_id = :project_id)
    ```
  - [ ] Document findings
- [ ] **If possible: Implement single-query approach**
  - [ ] Replace the three separate Supabase query nodes in load-persona workflow
  - [ ] Create one query node with the combined OR logic
  - [ ] Ensure results are still sorted by level
  - [ ] Test that all three levels are still loaded correctly
- [ ] **If not possible: Document limitation**
  - [ ] Add comment to load-persona workflow explaining why three queries are needed
  - [ ] Mark this optimization as "not feasible with current n8n Supabase node"
- [ ] **Benchmark if changed**
  - [ ] Compare query performance before and after
  - [ ] Verify no regression in functionality

**Files to modify (if possible):**

- `workflows/load-persona.workflow.json`

---

## Phase 5: Documentation & Polish

**Objective:** Update documentation to reflect all changes and improve maintainability

### 5.1 Update scripts/README.md

- [ ] **Remove obsolete schema references**
  - [ ] Open `scripts/README.md`
  - [ ] Find the "Database Schema" section
  - [ ] Remove all references to `display_order` column
  - [ ] Remove all references to `prompt_type` column
  - [ ] Update the schema to show the `level` column as `GENERATED ALWAYS AS`
- [ ] **Update example queries**
  - [ ] Update any SQL examples that use old columns
  - [ ] Show the new level-based query pattern
- [ ] **Add migration information**
  - [ ] Document the new migrations added in Phase 1
  - [ ] Explain the video_status ENUM
  - [ ] Explain the workflow_logs table
- [ ] **Update workflow section**
  - [ ] Add section about the logging system
  - [ ] Explain how to query workflow logs for debugging

**Files to modify:**

- `scripts/README.md`

---

### 5.2 Document Sub-Workflows

- [ ] **Create workflow documentation file**
  - [ ] Create `docs/WORKFLOWS.md`
  - [ ] Add high-level architecture diagram (ASCII art or mermaid)
- [ ] **Document AISMR workflow**
  - [ ] Purpose and trigger
  - [ ] Input parameters
  - [ ] Processing steps
  - [ ] Output and side effects
  - [ ] Error handling approach
- [ ] **Document Idea Generator workflow**
  - [ ] Purpose
  - [ ] How it uses Load Persona
  - [ ] AI agent configuration
  - [ ] Database tool usage for uniqueness checking
  - [ ] Output format
  - [ ] Error handling
- [ ] **Document Screen Writer workflow**
  - [ ] Purpose
  - [ ] How it transforms ideas to Sora prompts
  - [ ] Prompt structure validation
  - [ ] Database updates
- [ ] **Document Generate Video workflow**
  - [ ] Purpose
  - [ ] Sora API integration details
  - [ ] Polling mechanism
  - [ ] Status transitions
  - [ ] Timeout handling
  - [ ] Output (binary video data)
- [ ] **Document Upload workflow**
  - [ ] Purpose
  - [ ] Google Drive folder structure
  - [ ] Binary data handling
  - [ ] Database link updates
- [ ] **Document Load Persona workflow**
  - [ ] Purpose (shared utility)
  - [ ] Three-tier prompt system explanation
  - [ ] How prompts are merged and ordered
  - [ ] Reusability across workflows
- [ ] **Document Log to Database workflow**
  - [ ] Purpose (observability utility)
  - [ ] Input parameters
  - [ ] Usage examples from other workflows

**Files to create:**

- `docs/WORKFLOWS.md`

---

### 5.3 Add YAML Frontmatter Support to Prompts

- [ ] **Update build-prompts-sql.js**
  - [ ] Install `gray-matter` npm package for parsing frontmatter: `npm install --save-dev gray-matter`
  - [ ] Import at top of file: `const matter = require('gray-matter');`
  - [ ] Update `generateInsert` function to parse frontmatter:
    ```javascript
    function generateInsert(filename, content, info) {
      // Parse frontmatter
      const parsed = matter(content);
      const frontmatter = parsed.data;
      const promptContent = parsed.content;

      // Use frontmatter metadata if provided, otherwise infer
      const metadata = {
        ...inferMetadata(info),
        ...frontmatter, // frontmatter overrides inference
      };

      // ... rest of function using promptContent instead of content
    }
    ```
- [ ] **Update documentation**
  - [ ] In `scripts/README.md`, add section on YAML frontmatter
  - [ ] Show example:

    ```markdown
    ---
    model: gpt-4o
    temperature: 0.9
    max_tokens: 4000
    custom_param: value
    ---

    # Your prompt content here...
    ```

  - [ ] Explain that frontmatter overrides default metadata inference
- [ ] **Test with example prompt**
  - [ ] Add frontmatter to one prompt file (e.g., `persona-ideagenerator.md`)
  - [ ] Set custom model and temperature
  - [ ] Run `npm run build:prompts`
  - [ ] Verify generated SQL uses the custom metadata
  - [ ] Run `npm run update:dev-reset`
  - [ ] Verify prompt is inserted with correct metadata

**Files to modify:**

- `package.json` (add gray-matter dependency)
- `scripts/build-prompts-sql.js`
- `scripts/README.md`
- `prompts/persona-ideagenerator.md` (test case)

---

### 5.4 Update SYSTEM-SUMMARY.md

- [ ] **Update current state section**
  - [ ] Reflect the new database schema changes
  - [ ] Add information about workflow_logs table
  - [ ] Update prompt count if it changed after fixing screenwriter
- [ ] **Add observability section**
  - [ ] Document the logging system
  - [ ] Show example queries from workflow-analytics.sql
  - [ ] Explain how to monitor workflow health
- [ ] **Add validation section**
  - [ ] Document the validation added to AI outputs
  - [ ] Explain error handling improvements
- [ ] **Update available commands**
  - [ ] Remove `validate:split` if deleted
  - [ ] Add any new utility scripts created

**Files to modify:**

- `docs/SYSTEM-SUMMARY.md`

---

### 5.5 Create Quick Start Guide

- [ ] **Create QUICKSTART.md**
  - [ ] Create `docs/QUICKSTART.md`
  - [ ] Add sections:
    - **Prerequisites** (Node.js, n8n, Supabase account, API keys)
    - **Initial Setup** (clone repo, install deps, configure .env)
    - **Database Setup** (run dev-reset)
    - **n8n Configuration** (import workflows, set credentials)
    - **Running Your First AISMR Generation** (step by step)
    - **Monitoring** (how to check logs, query analytics)
    - **Troubleshooting** (common issues and solutions)
- [ ] **Add examples**
  - [ ] Show example .env file (with placeholder values)
  - [ ] Show example workflow execution
  - [ ] Show example log query
- [ ] **Link from main README**
  - [ ] Update root README.md (if exists) or create it
  - [ ] Link to QUICKSTART.md, SYSTEM-SUMMARY.md, WORKFLOWS.md

**Files to create:**

- `docs/QUICKSTART.md`

---

## Phase 6: Testing & Validation

**Objective:** Ensure all changes work correctly end-to-end

### 6.1 Integration Testing

- [ ] **Test full AISMR workflow**
  - [ ] Clear database: `npm run dev-reset`
  - [ ] Import all updated workflows into n8n
  - [ ] Trigger AISMR workflow with test input: "make ASMR videos about coffee"
  - [ ] Verify workflow completes successfully
  - [ ] Check that all 12 ideas are generated
  - [ ] Verify each idea has a screen prompt generated
  - [ ] Verify workflow_logs has entries for all steps
- [ ] **Test error paths**
  - [ ] Test with invalid project name → should log error
  - [ ] Test with AI that returns invalid data → should log validation error
  - [ ] Test with timeout scenario → should log timeout
  - [ ] Verify all errors are captured in workflow_logs
- [ ] **Test parallel execution**
  - [ ] Run AISMR workflow
  - [ ] Monitor workflow_logs with timestamps
  - [ ] Verify multiple ideas are processed in parallel
  - [ ] Verify no race conditions or data corruption

---

### 6.2 Database Testing

- [ ] **Test unique constraints**
  - [ ] Try to insert duplicate persona prompt → should fail
  - [ ] Try to insert duplicate project prompt → should fail
  - [ ] Try to insert duplicate persona-project prompt → should fail
  - [ ] Verify constraint names are meaningful in error messages
- [ ] **Test ENUM constraints**
  - [ ] Try to update aismr.status to invalid value → should fail
  - [ ] Verify only valid statuses are accepted
- [ ] **Test foreign keys**
  - [ ] Try to insert aismr row with invalid project_id → should fail
  - [ ] Delete a project → verify cascade behavior (or restrict)
- [ ] **Test timestamps**
  - [ ] Generate a video
  - [ ] Verify started_at and completed_at are populated
  - [ ] Verify completed_at > started_at
  - [ ] Run analytics query and verify results make sense

---

### 6.3 Prompt System Testing

- [ ] **Test screenwriter prompt loading**
  - [ ] Run screen writer workflow
  - [ ] Query the prompts it loaded
  - [ ] Verify it now loads Level 3 screenwriter-aismr prompt
  - [ ] Verify all three levels are present
- [ ] **Test YAML frontmatter**
  - [ ] Update a prompt with frontmatter
  - [ ] Run `npm run update:dev-reset`
  - [ ] Query the prompt in database
  - [ ] Verify metadata matches frontmatter
- [ ] **Test prompt uniqueness**
  - [ ] Run `npm run update:dev-reset` twice
  - [ ] Verify no errors about duplicate prompts
  - [ ] Verify prompts are updated, not duplicated

---

### 6.4 Logging System Testing

- [ ] **Test log visibility**
  - [ ] Run AISMR workflow
  - [ ] Query workflow_logs for the execution_id
  - [ ] Verify all major steps are logged
  - [ ] Verify log entries are in chronological order
- [ ] **Test log queries**
  - [ ] Run each query in `sql/queries/workflow-analytics.sql`
  - [ ] Verify they return sensible results
  - [ ] Verify performance is acceptable (< 1 second)
- [ ] **Test error logging**
  - [ ] Trigger an error in a workflow
  - [ ] Query recent errors
  - [ ] Verify error_details JSONB contains useful debugging info

---

## Completion Checklist

**Phase 1: Foundation ✓**

- [ ] Naming fixed
- [ ] Database schema updated
- [ ] Migrations created
- [ ] Package.json cleaned

**Phase 2: Observability ✓**

- [ ] workflow_logs table created
- [ ] Logging workflow created
- [ ] All workflows instrumented with logs
- [ ] Analytics queries created

**Phase 3: Validation ✓**

- [ ] Idea validation implemented
- [ ] Screen writer validation implemented
- [ ] Loop error handling added
- [ ] Timeout logic added
- [ ] Retry logic implemented

**Phase 4: Performance ✓**

- [ ] Parallel execution enabled
- [ ] Prompt loading optimized (if possible)

**Phase 5: Documentation ✓**

- [ ] scripts/README.md updated
- [ ] Sub-workflows documented
- [ ] YAML frontmatter supported
- [ ] SYSTEM-SUMMARY.md updated
- [ ] QUICKSTART.md created

**Phase 6: Testing ✓**

- [ ] Integration tests passed
- [ ] Database tests passed
- [ ] Prompt system tests passed
- [ ] Logging system tests passed

---

## Post-Implementation

- [ ] **Update TODO.md**
  - [ ] Mark all completed items
  - [ ] Move incomplete items to new TODO.md for next iteration
- [ ] **Create CHANGELOG.md**
  - [ ] Document all changes made
  - [ ] List new features (logging, validation, parallel execution)
  - [ ] List bug fixes (screenwriter naming)
  - [ ] List breaking changes (if any)
- [ ] **Git commit**
  - [ ] Commit all changes with descriptive messages
  - [ ] Tag release with version number

---

## Notes

- Each checkbox should be completed in order within its phase
- Phases can overlap slightly, but later phases depend on earlier ones
- Testing should be done continuously, not just in Phase 6
- If a task is blocked, document the blocker and move to the next task
- All database changes should be tested with `npm run dev-reset` before considering complete
- All workflow changes should be exported to JSON files after editing in n8n
