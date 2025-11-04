# Workflow Data Flow Analysis

## Overview
This document analyzes the data flow consistency across the generate video, edit video, and post video workflows in the n8n automation system, ensuring they properly use the database as a state manager.

## Database State Structure

### WorkflowRun Schema
```typescript
{
  id: UUID,
  projectId: string,
  sessionId: UUID,
  currentStage: 'idea_generation' | 'screenplay' | 'video_generation' | 'publishing',
  status: 'running' | 'completed' | 'failed' | 'needs_revision',
  stages: {
    idea_generation: { status: string, output?: any, error?: any },
    screenplay: { status: string, output?: any, error?: any },
    video_generation: { status: string, output?: any, error?: any },
    publishing: { status: string, output?: any, error?: any }
  },
  input: {
    userInput: string,
    turnId: string,
    personaId: string,
    // ... other metadata
  },
  output: {
    idea_generation?: any,
    screenplay?: any,
    video_generation?: any,
    publishing?: any
  }
}
```

### Videos Schema
```typescript
{
  id: UUID,
  runId: UUID,  // References workflowRuns.id
  projectId: string,
  idea: string,
  userIdea: string,
  vibe: string,
  prompt: string,
  videoLink: string,
  status: 'idea_gen' | 'script_gen' | 'video_gen' | 'upload' | 'complete' | 'failed',
  errorMessage: string,
  metadata: JSONB
}
```

## Current Workflow Analysis

### 1. Generate Video Workflow

**Expected Inputs:**
- `id`: video ID (from videos table)
- `runId`: workflow run ID (from workflow_runs table)

**Current Data Flow:**
1. ✅ **When Called** trigger receives: `{ id, runId }`
2. ✅ **Get Run (API)** fetches workflow run state from `/api/workflow-runs/{runId}`
3. ✅ **Get Idea (API)** fetches video record from `/api/videos/{id}`
4. ✅ **Normalize** nodes transform API responses to consistent shape
5. ✅ **Mark Run Videos** updates workflow run stage to `video_generation: in_progress`
6. ⚠️ **Text to Video2** calls external Veo API with video prompt
7. ⚠️ **Poll loop** checks video generation status
8. ✅ **Update a row** updates video record with `videoLink` and status
9. ✅ **Update Run Video Complete** updates workflow run:
   - Sets `stages.video_generation.status = 'completed'`
   - Sets `stages.video_generation.output = { ideaId, idea, videoUrl, status }`
   - Sets `output.video_generation = { ... }`
   - Advances `currentStage` to `'publishing'`
   - Sets `stages.publishing.status = 'in_progress'`

**Issues:**
- ❌ The workflow uses both `videos` table and `workflow_runs` table, but doesn't always sync properly
- ❌ Video status updates happen separately from workflow run updates
- ❌ Error handling doesn't consistently update both tables

**Expected Outputs:**
- `workflow_runs.stages.video_generation.output`:
  ```json
  {
    "ideaId": "uuid",
    "idea": "two word idea",
    "videoUrl": "https://...",
    "status": "video_gen"
  }
  ```
- `videos.videoLink`: URL to generated video
- `videos.status`: "video_gen"

### 2. Edit Video Workflow (Edit_AISMR)

**Expected Inputs:**
- `runId`: workflow run ID

**Current Data Flow:**
1. ✅ **When Executed** trigger receives: `{ runId }`
2. ✅ **Get Run (API)** fetches workflow run state
3. ✅ **Get many rows (API)** fetches ALL videos for this run from `/api/videos?run={runId}`
4. ✅ **Normalize Run** extracts metadata from workflow run
5. ✅ **Get many rows** transforms video array to consistent shape
6. ✅ **Code in JavaScript** builds Shotstack edit JSON from multiple videos:
   - Reads `video_link` from each video
   - Reads `idea` for text overlays
   - Builds complex multi-clip timeline with transitions
7. ✅ **HTTP Request** submits edit to Shotstack API
8. ⚠️ **Poll loop** waits for edit completion
9. ✅ **Mark Run Complete** updates workflow run:
   - Sets `stages.publishing.status = 'in_progress'`
   - Sets `stages.publishing.output.editUrl = {url}`
   - Sets `output.publishing.editUrl = {url}`

**Issues:**
- ✅ Correctly reads from workflow_runs as state manager
- ✅ Correctly reads multiple videos for compilation
- ⚠️ Should potentially update a "compiled video" record or store editUrl in a more structured way
- ❌ Error handling doesn't provide enough context about which video failed

**Expected Outputs:**
- `workflow_runs.stages.publishing.output`:
  ```json
  {
    "editUrl": "https://shotstack.io/...",
  }
  ```

### 3. Post Video Workflow (Upload to TikTok)

**Expected Inputs:**
- `runId`: workflow run ID

**Current Data Flow:**
1. ✅ **When Executed** trigger receives: `{ runId }`
2. ✅ **Get Run (API)** fetches workflow run state
3. ✅ **Get a row** normalizes and extracts `video_output` from `output.video_generation`
4. ✅ **Call 'Load Persona'** fetches caption/hashtag persona
5. ⚠️ **Get many rows (API)** fetches videos (seems redundant?)
6. ⚠️ **AI Agent** generates caption using persona + video metadata
7. ✅ **HTTP Request** downloads video from `video_output.videoUrl`
8. ✅ **Upload Video to TikTok** posts to TikTok with caption
9. ✅ **Update Run TikTok Complete** updates workflow run:
   - Sets `stages.publishing.status = 'completed'`
   - Sets `stages.publishing.output = { tiktokUrl, platform: 'tiktok' }`
   - Sets `output.publishing = { tiktokUrl, platform: 'tiktok' }`
   - Sets overall `status = 'completed'`

**Issues:**
- ⚠️ Fetches video list but only uses workflow run output - inconsistent data source
- ❌ Should use `editUrl` from publishing stage if edit workflow ran first
- ❌ Doesn't handle case where editUrl exists vs raw videoUrl
- ❌ Caption generation uses video list instead of workflow run output

**Expected Outputs:**
- `workflow_runs.stages.publishing.output`:
  ```json
  {
    "editUrl": "https://shotstack.io/...",
    "tiktokUrl": "https://tiktok.com/...",
    "platform": "tiktok",
    "caption": "..."
  }
  ```

## Critical Data Flow Issues

### Issue 1: Inconsistent Video Source
**Problem:** Post video workflow doesn't know whether to use:
- `workflow_runs.output.video_generation.videoUrl` (raw video)
- `workflow_runs.output.publishing.editUrl` (edited compilation)

**Solution:** Post video should check publishing stage first:
```javascript
const videoUrl = $('Get a row').item.json.publishing_output?.editUrl 
  ?? $('Get a row').item.json.video_output?.videoUrl 
  ?? null;
```

### Issue 2: Videos Table vs Workflow Runs Confusion
**Problem:** Some workflows update `videos` table, some update `workflow_runs`, leading to state inconsistency.

**Solution:** 
- `videos` table: Individual video generation tracking
- `workflow_runs`: Overall workflow orchestration state
- Each workflow should ALWAYS update `workflow_runs.stages` as source of truth
- `videos` table is supplementary for detailed video-level data

### Issue 3: Missing Output Consolidation
**Problem:** Edit workflow doesn't merge with previous video generation output.

**Solution:** Edit workflow should preserve prior stage outputs:
```javascript
const mergedOutput = {
  ...run.output,
  publishing: {
    ...run.output?.publishing,
    editUrl: $json.response?.url
  }
};
```

## Recommended Data Flow Pattern

### Standard Workflow Step Pattern
Every workflow should follow this pattern:

1. **Load State**
   ```javascript
   GET /api/workflow-runs/{runId}
   // Returns full workflow run with all stages
   ```

2. **Normalize State**
   ```javascript
   const run = $json.workflowRun;
   const stages = run.stages;
   const previousOutput = run.output;
   ```

3. **Execute Work**
   ```javascript
   // Do the actual work (API calls, transformations, etc.)
   ```

4. **Update State - In Progress**
   ```javascript
   PATCH /api/workflow-runs/{runId}
   {
     status: 'running',
     currentStage: 'video_generation',
     stages: {
       ...existingStages,
       video_generation: { status: 'in_progress' }
     }
   }
   ```

5. **Update State - Completed**
   ```javascript
   PATCH /api/workflow-runs/{runId}
   {
     status: 'running',
     currentStage: 'publishing',
     stages: {
       ...existingStages,
       video_generation: {
         status: 'completed',
         output: { /* stage output */ }
       },
       publishing: { status: 'in_progress' }
     },
     output: {
       ...previousOutput,
       video_generation: { /* stage output */ }
     }
   }
   ```

6. **Update State - Failed**
   ```javascript
   PATCH /api/workflow-runs/{runId}
   {
     status: 'failed',
     currentStage: 'video_generation',
     stages: {
       ...existingStages,
       video_generation: {
         status: 'failed',
         error: { message, stack, lastNode }
       }
     }
   }
   ```

## Required Fixes

### Generate Video Workflow
- ✅ Already follows pattern correctly
- ✅ Updates both videos table and workflow_runs
- ⚠️ Consider consolidating video status updates

### Edit Video Workflow
- ✅ Already follows pattern correctly
- ✅ Reads from workflow_runs as state manager
- ✅ Stores editUrl in publishing stage
- 🔧 Should preserve all previous output fields

### Post Video Workflow
- ❌ **FIX:** Use editUrl if present, fallback to videoUrl
- ❌ **FIX:** Remove redundant video list fetch
- ❌ **FIX:** Generate caption from workflow run output, not video list
- ❌ **FIX:** Preserve editUrl in final output

## Implementation Plan

1. **Fix Post Video input logic** - Check editUrl first
2. **Standardize error handling** - All workflows use same pattern
3. **Add output preservation** - Never overwrite prior stage outputs
4. **Update documentation** - Document expected inputs/outputs for each workflow
5. **Add validation** - Ensure required fields exist before proceeding

