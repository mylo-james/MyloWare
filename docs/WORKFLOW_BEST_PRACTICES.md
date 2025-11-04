# n8n Workflow Best Practices for State Management

## Overview
This document outlines best practices for creating n8n workflows that use the database as a state manager, ensuring consistent data flow and preventing state inconsistencies.

## Core Principles

### 1. Single Source of Truth
**The `workflow_runs` table is the single source of truth for workflow state.**

- Always read from `/api/workflow-runs/{runId}` at workflow start
- Always write to `/api/workflow-runs/{runId}` after significant state changes
- Use `videos` table only for detailed video-level tracking, not orchestration state

### 2. Output Preservation
**Never overwrite prior stage outputs - always merge.**

```javascript
// ❌ BAD - Overwrites everything
return {
  output: {
    video_generation: { videoUrl: '...' }
  }
};

// ✅ GOOD - Preserves prior outputs
const mergedOutput = {
  ...run.output,  // Keep all prior stage outputs
  video_generation: {
    ...run.output?.video_generation,  // Keep prior video_generation if exists
    videoUrl: '...',  // Add new data
    completedAt: new Date().toISOString()
  }
};
return { output: mergedOutput };
```

### 3. Explicit Stage Status
**Always set explicit stage status and preserve stage structure.**

```javascript
const stages = run.stages ?? {};
const clone = (value) => (value && typeof value === 'object' ? { ...value } : {});

// Set prior stages to completed if not set
const ideaStage = clone(stages.idea_generation);
if (!ideaStage.status) {
  ideaStage.status = 'completed';
}

// Update current stage
const videoStage = {
  ...clone(stages.video_generation),
  status: 'completed',
  output: { /* stage output */ }
};

return {
  stages: {
    idea_generation: ideaStage,
    screenplay: screenplayStage,
    video_generation: videoStage,
    publishing: publishingStage
  }
};
```

## Standard Workflow Pattern

### Required Nodes

1. **Trigger Node**
   - `executeWorkflowTrigger` with `runId` parameter
   - Or `When Executed by Another Workflow` with input params

2. **Load State Node**
   - HTTP Request to `/api/workflow-runs/{runId}`
   - GET method
   - Returns full workflow run object

3. **Normalize State Node**
   - Code node that extracts and flattens state
   - Builds consistent metadata object
   - Provides clean data structure

4. **Mark Stage Start Node**
   - HTTP Request PATCH to `/api/workflow-runs/{runId}`
   - Sets current stage status to `in_progress`
   - Preserves all prior outputs

5. **Execute Work Node(s)**
   - Your actual workflow logic
   - External API calls
   - Data transformations
   - Polling loops

6. **Mark Stage Complete Node**
   - HTTP Request PATCH to `/api/workflow-runs/{runId}`
   - Sets current stage status to `completed`
   - Adds stage output
   - Advances to next stage
   - Preserves all prior outputs

7. **Error Handler Nodes**
   - `errorTrigger` node
   - Mark Run Failed HTTP node
   - Preserves prior outputs in error state

### Template Code Blocks

#### Normalize State Code Node
```javascript
const payload = $json?.workflowRun ?? $json?.data?.workflowRun ?? null;
if (!payload) {
  throw new Error('Workflow run payload missing from API response.');
}

// Extract metadata
const metadata = {};
if (payload.input && typeof payload.input === 'object') {
  if (payload.input.metadata && typeof payload.input.metadata === 'object') {
    Object.assign(metadata, payload.input.metadata);
  }
  // ... extract other metadata fields
}

// Extract stage outputs
const ideaOutput = payload.output?.idea_generation ?? {};
const screenplayOutput = payload.output?.screenplay ?? {};
const videoOutput = payload.output?.video_generation ?? {};
const publishingOutput = payload.output?.publishing ?? {};

// Build normalized output
const normalized = {
  ...payload,
  metadata,
  idea_output: ideaOutput,
  screenplay_output: screenplayOutput,
  video_output: videoOutput,
  publishing_output: publishingOutput,
  runId: payload.id
};

return [{ json: normalized }];
```

#### Mark Stage In Progress
```javascript
const run = $('Get a row').item?.json ?? {};
const stages = run.stages ?? {};
const clone = (value) => (value && typeof value === 'object' ? { ...value } : {});

// Set prior stages as completed if not set
const ideaStage = clone(stages.idea_generation);
if (!ideaStage.status) {
  ideaStage.status = 'completed';
}

// ... repeat for other prior stages

// Mark current stage as in progress
const currentStage = {
  ...clone(stages.video_generation),
  status: 'in_progress',
  startedAt: new Date().toISOString()
};

return {
  status: 'running',
  currentStage: 'video_generation',
  stages: {
    idea_generation: ideaStage,
    screenplay: screenplayStage,
    video_generation: currentStage,
    publishing: publishingStage
  },
  output: {
    ...(run.output ?? {}),
    // Preserve all prior stage outputs
    idea_generation: run.output?.idea_generation ?? ideaStage.output ?? {},
    screenplay: run.output?.screenplay ?? screenplayStage.output ?? {}
  }
};
```

#### Mark Stage Complete
```javascript
const run = $('Get a row').item?.json ?? {};
const stages = run.stages ?? {};
const clone = (value) => (value && typeof value === 'object' ? { ...value } : {});

// Set prior stages as completed
const ideaStage = clone(stages.idea_generation);
if (!ideaStage.status) {
  ideaStage.status = 'completed';
}

// ... set other prior stages

// Build current stage output
const stageOutput = {
  videoUrl: $json.data?.videoUrl ?? null,
  ideaId: $json.data?.ideaId ?? null,
  completedAt: new Date().toISOString()
};

// Mark current stage complete
const currentStage = {
  ...clone(stages.video_generation),
  status: 'completed',
  output: stageOutput
};

// Mark next stage in progress
const nextStage = {
  ...clone(stages.publishing),
  status: 'in_progress'
};

return {
  status: 'running',
  currentStage: 'publishing',
  stages: {
    idea_generation: ideaStage,
    screenplay: screenplayStage,
    video_generation: currentStage,
    publishing: nextStage
  },
  output: {
    ...(run.output ?? {}),
    // CRITICAL: Preserve ALL prior stage outputs
    idea_generation: run.output?.idea_generation ?? ideaStage.output ?? {},
    screenplay: run.output?.screenplay ?? screenplayStage.output ?? {},
    // Add new stage output
    video_generation: stageOutput
  }
};
```

#### Error Handler
```javascript
const run = $('Get a row').item?.json ?? {};
const stages = run.stages ?? {};
const clone = (value) => (value && typeof value === 'object' ? { ...value } : {});

// Set prior stages as completed
const ideaStage = clone(stages.idea_generation);
if (!ideaStage.status) {
  ideaStage.status = 'completed';
}

// Mark current stage failed
const currentStage = {
  ...clone(stages.video_generation),
  status: 'failed',
  error: {
    message: $json.error?.message ?? 'Workflow failed.',
    stack: $json.error?.stack ?? null,
    lastNode: $json.execution?.lastNodeExecuted ?? null
  }
};

return {
  status: 'failed',
  currentStage: 'video_generation',
  stages: {
    idea_generation: ideaStage,
    screenplay: screenplayStage,
    video_generation: currentStage,
    publishing: publishingStage
  },
  output: {
    ...(run.output ?? {}),
    // CRITICAL: Preserve ALL prior outputs even on failure
    idea_generation: run.output?.idea_generation ?? ideaStage.output ?? {},
    screenplay: run.output?.screenplay ?? screenplayStage.output ?? {},
    video_generation: {
      error: {
        message: $json.error?.message ?? 'Workflow failed.',
        stack: $json.error?.stack ?? null,
        lastNode: $json.execution?.lastNodeExecuted ?? null
      }
    }
  }
};
```

## Common Pitfalls

### ❌ Pitfall 1: Overwriting Prior Outputs
```javascript
// BAD - Loses all prior stage data
return {
  output: {
    video_generation: { videoUrl: '...' }
  }
};
```

### ❌ Pitfall 2: Not Preserving Stage Structure
```javascript
// BAD - Loses stage.output when updating
const videoStage = {
  status: 'completed'  // Missing output field!
};
```

### ❌ Pitfall 3: Fetching Data From Multiple Sources
```javascript
// BAD - Creates inconsistency
const videoUrl = $('Get Videos API').item.json.videoLink;  // From videos table
const runState = $('Get Run API').item.json;  // From workflow_runs table
// Which is the source of truth?
```

### ❌ Pitfall 4: Not Checking Prior Stages
```javascript
// BAD - Assumes videoUrl exists
const videoUrl = run.output.video_generation.videoUrl;
// Could be null if edit workflow ran first!

// GOOD - Check editUrl first
const videoUrl = run.output.publishing?.editUrl ?? run.output.video_generation?.videoUrl ?? null;
```

### ❌ Pitfall 5: Missing Error Preservation
```javascript
// BAD - Loses prior outputs on error
return {
  status: 'failed',
  output: {
    error: { message: 'Failed' }
  }
};

// GOOD - Preserves prior outputs
return {
  status: 'failed',
  output: {
    ...(run.output ?? {}),  // Keep everything
    [currentStage]: {
      error: { message: 'Failed' }
    }
  }
};
```

## Testing Checklist

When creating a new workflow, verify:

- [ ] Workflow reads from `/api/workflow-runs/{runId}` at start
- [ ] Workflow preserves ALL prior stage outputs in every update
- [ ] Workflow sets explicit status for current stage
- [ ] Workflow sets default status for prior stages if missing
- [ ] Workflow includes `completedAt` timestamp in stage output
- [ ] Workflow includes `startedAt` timestamp when marking `in_progress`
- [ ] Error handler preserves prior outputs
- [ ] Error handler includes `message`, `stack`, and `lastNode`
- [ ] Workflow handles missing optional fields gracefully (e.g., editUrl)
- [ ] Workflow never fetches data from multiple conflicting sources

## Integration Patterns

### Conditional Execution Based on Prior Stage
```javascript
// Check if edit workflow ran
const publishingOutput = run.output?.publishing ?? {};
const hasEditUrl = !!publishingOutput.editUrl;

if (hasEditUrl) {
  // Use edited video
  videoUrl = publishingOutput.editUrl;
} else {
  // Use raw generated video
  videoUrl = run.output?.video_generation?.videoUrl;
}
```

### Merging Stage Outputs
```javascript
// Publishing stage may have outputs from both edit and post workflows
const publishingOutput = {
  ...(run.output?.publishing ?? {}),  // Existing publishing output (e.g., editUrl)
  tiktokUrl: $json.tiktokUrl,  // New data
  platform: 'tiktok',
  caption: $json.caption,
  completedAt: new Date().toISOString()
};
```

### Conditional Stage Advancement
```javascript
// Only advance if current stage is complete
if (currentStage.status === 'completed') {
  return {
    currentStage: 'publishing',  // Advance
    stages: { /* ... */ }
  };
} else {
  return {
    currentStage: 'video_generation',  // Stay
    stages: { /* ... */ }
  };
}
```

## Workflow Composition

### Sequential Workflows
```
Workflow Run Created
  ↓
Generate Ideas (idea_generation)
  ↓
Write Screenplay (screenplay)
  ↓
Generate Video (video_generation)
  ↓
Edit Video (publishing - edit)
  ↓
Post Video (publishing - post)
```

### Parallel Workflows
```
Workflow Run Created
  ↓
Generate Ideas (idea_generation)
  ├─→ Generate Video A (video_generation)
  ├─→ Generate Video B (video_generation)
  └─→ Generate Video C (video_generation)
        ↓
      Edit Video (publishing - compile all)
        ↓
      Post Video (publishing - post)
```

### Optional Workflows
```
Workflow Run Created
  ↓
Generate Ideas
  ↓
Generate Video
  ↓
  ├─→ [Optional] Edit Video
  │     ↓
  │   Post Edited Video
  │
  └─→ [Skip Edit] Post Raw Video
```

## Conclusion

Following these patterns ensures:
1. ✅ Consistent state management
2. ✅ No data loss during workflow execution
3. ✅ Flexible workflow composition
4. ✅ Robust error handling
5. ✅ Easy debugging and state inspection
6. ✅ Support for optional workflow steps

Always remember: **The database is the source of truth. Preserve all outputs. Never overwrite prior stage data.**

