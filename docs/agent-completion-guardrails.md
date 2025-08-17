# Agent Completion Guardrails

This document describes the completion notification guardrails system implemented to ensure background agents always notify when tasks complete or fail.

## Problem Statement

Background agents need to reliably notify when tasks complete, but can fail to do so due to:

- Unexpected crashes or termination
- Unhandled exceptions
- Memory issues
- Network failures
- Developer oversight

## Solution: Completion Guardrails

### 1. Task Completion Utility (`@myloware/shared`)

**File**: `packages/shared/src/utils/task-completion.ts`

Provides wrapper functions and decorators for automatic completion notifications:

```typescript
import {
  withTaskCompletion,
  notifySuccess,
  notifyFailure,
  setupCompletionGuardrails,
} from '@myloware/shared';

// Wrap any async task with automatic notifications
const result = await withTaskCompletion(
  'My Task',
  async () => {
    // Your task logic here
    return await doSomeWork();
  },
  {
    customSuccessMessage: '🎉 Custom success message',
    customFailureMessage: '💔 Custom failure message',
  }
);
```

### 2. Agent Completion Handler Script

**File**: `scripts/agent-completion-handler.js`

Standalone script for background agents:

```javascript
const AgentCompletionHandler = require('./scripts/agent-completion-handler');

const handler = new AgentCompletionHandler('Story Development Task');

try {
  // Your agent work here
  await developStory();

  // Mark success (this sends notification automatically)
  await handler.markSuccess('3 stories completed successfully');
} catch (error) {
  // Mark failure (this sends notification automatically)
  await handler.markFailure(error.message);
}
```

### 3. Process Exit Guardrails

The system automatically handles unexpected termination:

- **SIGINT/SIGTERM**: Graceful shutdown with notification
- **Uncaught exceptions**: Crash notification with stack trace
- **Unhandled rejections**: Promise rejection notification
- **Process exit**: Final check for completion notification

## Usage Patterns

### Pattern 1: Wrapper Function (Recommended)

```typescript
import { withTaskCompletion } from '@myloware/shared';

async function developStory() {
  return withTaskCompletion('Story Development', async () => {
    // Implementation here
    await implementStory();
    return { success: true };
  });
}
```

### Pattern 2: Manual Notifications

```typescript
import { notifySuccess, notifyFailure } from '@myloware/shared';

async function developStory() {
  try {
    await implementStory();
    await notifySuccess('Story Development', '3 stories completed');
  } catch (error) {
    await notifyFailure('Story Development', error.message);
    throw error;
  }
}
```

### Pattern 3: Decorator (Class Methods)

```typescript
import { TaskCompletion } from '@myloware/shared';

class StoryDeveloper {
  @TaskCompletion('Story Development')
  async developStory() {
    // Implementation here - notifications handled automatically
    return await implementStory();
  }
}
```

### Pattern 4: Process-Level Guardrails

```typescript
import { setupCompletionGuardrails } from '@myloware/shared';

const markCompleted = setupCompletionGuardrails('Long Running Task');

try {
  await doLongRunningWork();
  markCompleted(); // Prevents exit handler from triggering
  await notifySuccess('Long Running Task', 'Completed successfully');
} catch (error) {
  // Exit handlers will automatically notify failure
  throw error;
}
```

## Notification Types

### Success Notifications

- **Priority**: 0 (Normal)
- **Title**: "MyloWare Task Complete" or custom
- **Message**: Includes task name, duration, and details
- **Format**: `✅ {taskName} completed successfully - {details}`

### Failure Notifications

- **Priority**: 2 (Emergency)
- **Title**: "MyloWare Task Failed" or custom
- **Message**: Includes task name, error details, and duration
- **Format**: `❌ {taskName} failed - {error}`

### Warning Notifications

- **Priority**: 1 (High)
- **Title**: "MyloWare Agent Warning"
- **Message**: For unexpected termination or crashes
- **Format**: `⚠️ {taskName} terminated unexpectedly`

## Integration with Existing Scripts

The guardrails integrate with existing notification scripts:

```bash
# Success notification (priority 0)
npm run notify:success

# Error notification (priority 2)
npm run notify:error

# Story completion (priority 1)
npm run notify:story
```

## Best Practices

### 1. Always Use Guardrails

```typescript
// ✅ Good - automatic notifications
await withTaskCompletion('Task Name', async () => {
  return await doWork();
});

// ❌ Bad - no notification guardrails
await doWork();
```

### 2. Provide Meaningful Messages

```typescript
// ✅ Good - descriptive messages
await withTaskCompletion(
  'Story 1.3 Development',
  async () => {
    return await implementTemporalWorkflow();
  },
  {
    customSuccessMessage:
      '🎉 Temporal workflow engine setup complete! All 5 acceptance criteria met.',
  }
);

// ❌ Bad - generic messages
await withTaskCompletion('Task', async () => {
  return await doWork();
});
```

### 3. Handle Long-Running Tasks

```typescript
// ✅ Good - process-level guardrails for long tasks
const markCompleted = setupCompletionGuardrails('Long Task');
try {
  await longRunningWork();
  markCompleted();
  await notifySuccess('Long Task', 'Completed after extended processing');
} catch (error) {
  // Guardrails handle failure notification
  throw error;
}
```

### 4. Batch Operations

```typescript
// ✅ Good - notify for overall batch completion
await withTaskCompletion('Batch Story Development', async () => {
  const results = await Promise.allSettled([developStory1(), developStory2(), developStory3()]);
  return { completed: results.filter(r => r.status === 'fulfilled').length };
});
```

## Configuration

### Environment Variables

```bash
# Notification settings (in .env)
PUSHOVER_USER_KEY=your-user-key
PUSHOVER_API_TOKEN=your-api-token

# Agent settings
AGENT_NOTIFICATION_ENABLED=true
AGENT_AUTO_EXIT=true
AGENT_NOTIFY_ON_SUCCESS=true
AGENT_NOTIFY_ON_FAILURE=true
```

### Default Options

```typescript
const defaultOptions = {
  notifyOnSuccess: true,
  notifyOnFailure: true,
  customSuccessMessage: undefined,
  customFailureMessage: undefined,
  includeDetails: true,
  autoExit: true, // For background agents
};
```

## Examples

### Background Agent Script

```javascript
const AgentCompletionHandler = require('./scripts/agent-completion-handler');

async function main() {
  const handler = new AgentCompletionHandler('Epic 1 Story Development');

  try {
    await developStory1();
    await developStory2();
    await developStory3();

    await handler.markSuccess(
      '3 stories completed: Temporal, Redis, MCP Services',
      '🚀 Epic 1 foundation complete! Ready for Slack integration.'
    );
  } catch (error) {
    await handler.markFailure(error.message);
  }
}

main();
```

### Service Integration

```typescript
import { withTaskCompletion } from '@myloware/shared';

export class WorkflowService {
  async processWorkOrder(workOrder: WorkOrderInput) {
    return withTaskCompletion(
      `Workflow Processing - ${workOrder.id}`,
      async () => {
        const result = await this.executeWorkflow(workOrder);
        return result;
      },
      {
        customSuccessMessage: `🎯 Workflow ${workOrder.id} processed successfully!`,
      }
    );
  }
}
```

## Testing the Guardrails

```bash
# Test the completion handler
node scripts/agent-completion-handler.js "Test Task"

# Test with your own task
const handler = new AgentCompletionHandler('My Task');
setTimeout(() => handler.markSuccess('Test completed'), 1000);
```

## Monitoring

The guardrails provide comprehensive logging:

```json
{
  "timestamp": "2025-08-17T20:50:00.000Z",
  "level": "info",
  "service": "task-completion",
  "message": "Task completed successfully",
  "taskName": "Story Development",
  "duration": 45000,
  "notificationSent": true
}
```

This ensures full traceability of task completion and notification delivery.
