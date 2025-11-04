# Workflow Data Flow Fix Summary

## Date: November 4, 2025

## Overview
This document summarizes the fixes applied to ensure consistent data flow across all video generation workflows, using the database (`workflow_runs` table) as the source of truth for state management.

## Key Principles Enforced

### 1. Database as State Manager
All workflows now:
- Read workflow run state from `/api/workflow-runs/{runId}` at the start
- Update workflow run state via PATCH to `/api/workflow-runs/{runId}` after each major step
- Preserve all prior stage outputs when updating (no data loss)
- Use consistent stage status values: `pending`, `in_progress`, `completed`, `failed`

### 2. Output Preservation Pattern
Every workflow update follows this pattern:
```javascript
const mergedOutput = {
  ...run.output,  // Preserve ALL prior outputs
  [currentStage]: {
    ...run.output?.[currentStage],  // Preserve prior stage output if exists
    ...newStageOutput  // Add new output
  }
};
```

### 3. Stage Completion Tracking
Each stage output includes:
- Stage-specific data (videoUrl, editUrl, etc.)
- `completedAt` timestamp for completion tracking
- Error objects with `message`, `stack`, `lastNode` for failures

## Workflow-Specific Fixes

### Generate Video Workflow ✅

**File:** `workflows/generate-video.workflow.json`

**Inputs:**
- `id`: Video record ID (from videos table)
- `runId`: Workflow run ID (from workflow_runs table)

**Changes Made:**
1. ✅ **Output Preservation** - Now preserves `idea_generation` and `screenplay` outputs when updating `video_generation`
2. ✅ **Completion Timestamps** - Added `completedAt` to video_generation output
3. ✅ **Stage Status Tracking** - Added `startedAt` when marking video_generation as `in_progress`
4. ✅ **Error Handling** - Preserves all prior stage outputs even on failure

**State Flow:**
```
1. Load workflow run → Extract idea_generation & screenplay outputs
2. Fetch video record → Get video idea and prompt
3. Mark video_generation as 'in_progress' → Preserve prior outputs
4. Call Veo API → Generate video
5. Poll for completion → Wait for videoUrl
6. Update video record → Set videoLink
7. Update workflow run → Set video_generation output with videoUrl, advance to publishing
```

**Output Structure:**
```typescript
{
  status: 'running',
  currentStage: 'publishing',
  stages: {
    idea_generation: { status: 'completed', output: {...} },
    screenplay: { status: 'completed', output: {...} },
    video_generation: {
      status: 'completed',
      output: {
        ideaId: 'uuid',
        idea: 'two words',
        videoUrl: 'https://...',
        status: 'video_gen',
        completedAt: '2025-11-04T...'
      }
    },
    publishing: { status: 'in_progress' }
  },
  output: {
    idea_generation: {...},  // PRESERVED
    screenplay: {...},        // PRESERVED
    video_generation: {       // NEW
      ideaId: 'uuid',
      idea: 'two words',
      videoUrl: 'https://...',
      status: 'video_gen',
      completedAt: '2025-11-04T...'
    }
  }
}
```

### Edit Video Workflow (Edit_AISMR) ✅

**File:** `workflows/edit-aismr.workflow.json`

**Inputs:**
- `runId`: Workflow run ID

**Changes Made:**
1. ✅ **Output Preservation** - Now preserves `video_generation` output when setting publishing output
2. ✅ **Edit Metadata** - Added both `editUrl` AND `editId` (Shotstack render ID) to output
3. ✅ **Completion Timestamps** - Added `completedAt` to publishing stage output
4. ✅ **Error Handling** - Preserves video_generation output even on editing failure

**State Flow:**
```
1. Load workflow run → Extract video_generation output (videoUrl)
2. Fetch all videos for run → Get video_link from each video record
3. Build Shotstack timeline → Create multi-clip edit with transitions
4. Submit to Shotstack → Get render ID
5. Poll for completion → Wait for editUrl
6. Update workflow run → Set publishing.editUrl, preserve video_generation output
```

**Output Structure:**
```typescript
{
  status: 'running',
  currentStage: 'publishing',
  stages: {
    idea_generation: { status: 'completed', output: {...} },
    screenplay: { status: 'completed', output: {...} },
    video_generation: { status: 'completed', output: {...} },
    publishing: {
      status: 'in_progress',
      output: {
        editUrl: 'https://shotstack...',
        editId: 'abc123',
        completedAt: '2025-11-04T...'
      }
    }
  },
  output: {
    idea_generation: {...},    // PRESERVED
    screenplay: {...},          // PRESERVED
    video_generation: {...},    // PRESERVED
    publishing: {              // NEW
      editUrl: 'https://shotstack...',
      editId: 'abc123',
      completedAt: '2025-11-04T...'
    }
  }
}
```

### Post Video Workflow (Upload to TikTok) ✅

**File:** `workflows/upload-to-tiktok.workflow.json`

**Inputs:**
- `runId`: Workflow run ID

**Critical Changes Made:**
1. ✅ **Smart Video Selection** - Now prioritizes `editUrl` over `videoUrl`:
   ```javascript
   const videoUrl = publishingOutput.editUrl ?? videoOutput.videoUrl ?? null;
   ```
2. ✅ **Removed Redundant Fetches** - Deleted unnecessary `Get many rows (API)` and `Get many rows` nodes
3. ✅ **Caption from State** - AI agent now uses workflow run output, not video list
4. ✅ **Complete Output Preservation** - Preserves editUrl when adding tiktokUrl
5. ✅ **Caption Tracking** - Stores generated caption in publishing output

**State Flow:**
```
1. Load workflow run → Extract video_generation AND publishing outputs
2. Determine video source → Use editUrl if exists, else videoUrl
3. Load caption persona → Get TikTok caption/hashtag guidelines
4. Generate caption with AI → Use workflow run context (idea, videoUrl)
5. Download video → From editUrl or videoUrl
6. Upload to TikTok → Post with caption
7. Update workflow run → Set tiktokUrl and caption, mark complete
```

**Output Structure:**
```typescript
{
  status: 'completed',  // WORKFLOW COMPLETE
  currentStage: 'publishing',
  stages: {
    idea_generation: { status: 'completed', output: {...} },
    screenplay: { status: 'completed', output: {...} },
    video_generation: { status: 'completed', output: {...} },
    publishing: {
      status: 'completed',
      output: {
        editUrl: 'https://shotstack...',      // PRESERVED from edit
        editId: 'abc123',                     // PRESERVED from edit
        tiktokUrl: 'https://tiktok.com/...',  // NEW
        platform: 'tiktok',                   // NEW
        caption: '...',                       // NEW
        completedAt: '2025-11-04T...'
      }
    }
  },
  output: {
    idea_generation: {...},    // PRESERVED
    screenplay: {...},          // PRESERVED
    video_generation: {...},    // PRESERVED
    publishing: {              // MERGED
      editUrl: 'https://shotstack...',
      editId: 'abc123',
      tiktokUrl: 'https://tiktok.com/...',
      platform: 'tiktok',
      caption: '...',
      completedAt: '2025-11-04T...'
    }
  }
}
```

## Validation Checklist

### ✅ Generate Video
- [x] Reads workflow run state from DB
- [x] Preserves idea_generation output
- [x] Preserves screenplay output
- [x] Updates video_generation output with videoUrl
- [x] Advances to publishing stage
- [x] Handles errors without data loss

### ✅ Edit Video
- [x] Reads workflow run state from DB
- [x] Preserves video_generation output
- [x] Updates publishing output with editUrl
- [x] Stores editId for tracking
- [x] Handles errors without data loss

### ✅ Post Video
- [x] Reads workflow run state from DB
- [x] Uses editUrl if present, else videoUrl
- [x] Preserves all prior stage outputs
- [x] Updates publishing output with tiktokUrl
- [x] Marks workflow as completed
- [x] Handles errors without data loss

## Data Flow Diagram

```
workflow_runs (DB)
├── stages
│   ├── idea_generation { status, output }
│   ├── screenplay { status, output }
│   ├── video_generation { status, output }
│   └── publishing { status, output }
└── output (consolidated)
    ├── idea_generation { ... }
    ├── screenplay { ... }
    ├── video_generation { videoUrl, ... }
    └── publishing { editUrl, tiktokUrl, caption, ... }

videos (DB)
└── Individual video records with status tracking

FLOW:
1. Generate Video: workflow_runs → video_generation → videos → workflow_runs
2. Edit Video: workflow_runs → videos (all for run) → Shotstack → workflow_runs
3. Post Video: workflow_runs → (editUrl OR videoUrl) → TikTok → workflow_runs
```

## Testing Recommendations

### Test Scenario 1: Full Pipeline
1. Start workflow run with idea generation
2. Run generate video → Verify videoUrl in output.video_generation
3. Run edit video → Verify editUrl in output.publishing AND videoUrl still present
4. Run post video → Verify uses editUrl, adds tiktokUrl, preserves all outputs

### Test Scenario 2: Skip Edit
1. Start workflow run
2. Run generate video → Verify videoUrl
3. Run post video directly → Verify uses videoUrl (no editUrl), still works

### Test Scenario 3: Error Handling
1. Start workflow run
2. Simulate generate video failure → Verify prior outputs preserved
3. Simulate edit video failure → Verify video_generation output preserved
4. Simulate post video failure → Verify all outputs preserved

## n8n-Specific Considerations

### Expression Access Patterns
All workflows use consistent node access:
```javascript
// Load workflow run
$('Get Run (API)').item.json  // or $('Get a row').item.json

// Access prior outputs
$('Get a row').item.json.output?.video_generation
$('Get a row').item.json.output?.publishing

// Update with preservation
{
  ...(run.output ?? {}),
  [stage]: { ...(run.output?.[stage] ?? {}), ...newData }
}
```

### State Normalization
All workflows use a "Get a row" or "Normalize" code node to:
- Extract workflow run from API response
- Build consistent metadata object
- Flatten nested API structure
- Provide clean data to downstream nodes

### Error Handling
All workflows have:
- "On Error" trigger node
- "Mark Run Failed" HTTP node
- Preserve prior outputs in error state
- Include error message, stack, and lastNode

## Conclusion

All three workflows now:
1. ✅ Use workflow_runs as the single source of truth
2. ✅ Preserve all prior stage outputs
3. ✅ Follow consistent state update patterns
4. ✅ Handle errors without data loss
5. ✅ Support flexible execution order (skip edit workflow if needed)
6. ✅ Track completion timestamps
7. ✅ Store comprehensive output for downstream consumers

The database state management is now robust, consistent, and ready for production use.

