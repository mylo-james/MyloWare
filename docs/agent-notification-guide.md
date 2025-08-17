# AI Agent Notification Guide

This guide shows AI agents how to easily notify completion status using the MyloWare notification system.

## ⚠️ **Temporary Solution Notice**

**This Pushover notification system is a temporary solution until Slack integration is implemented as part of Epic 2: Slack Integration & HITL Framework.**

### **Current Status:**

- **Active:** Pushover notifications for immediate agent communication
- **Future:** Will transition to Slack integration for better team collaboration
- **Timeline:** Temporary until Epic 2 completion

## Quick Start

### 1. Using npm scripts (Easiest)

```bash
# Basic success notification
npm run notify:success

# Error notification
npm run notify:error

# Story completion notification
npm run notify:story

# Custom notification
npm run notify "Your custom message here" "1" "Custom Title"
```

### 2. Using TypeScript utilities (Recommended for AI agents)

```typescript
import {
  notifySuccess,
  notifyError,
  notifyStoryComplete,
  notifyTestResults,
  notifyDeployment,
} from '@myloware/shared';

// Success notification
notifySuccess('Task completed successfully');

// Error notification
notifyError('Something went wrong - check logs');

// Story completion
notifyStoryComplete('1.2', 'Database schema implemented with all tables');

// Test results
notifyTestResults(47, 0, 89); // 47 passed, 0 failed, 89% coverage

// Deployment status
notifyDeployment('production', 'v1.2.3', true); // success
notifyDeployment('staging', 'v1.2.3', false); // failed
```

## Common Use Cases

### Story Completion

```typescript
// When completing a story
notifyStoryComplete('1.2', 'Database schema with 12 tables, 47 tests passing');
```

### Test Results

```typescript
// After running tests
notifyTestResults(passedTests, failedTests, coveragePercentage);
```

### Build Status

```typescript
// After building
if (buildSuccess) {
  notifySuccess('Build completed successfully');
} else {
  notifyError('Build failed - check compilation errors');
}
```

### Deployment Status

```typescript
// After deployment
notifyDeployment(environment, version, success);
```

### Long-Running Tasks

```typescript
// For tasks that take a while
notifyImportant('Database migration completed - 1,000 records processed');
```

## Priority Levels

- **0 (Normal):** Standard notifications
- **1 (High):** Important completions (stories, deployments)
- **2 (Emergency):** Errors or critical issues

## Best Practices

### 1. Always notify story completions

```typescript
// At the end of each story implementation
notifyStoryComplete('1.2', 'All acceptance criteria met, tests passing');
```

## Future Migration to Slack

When Epic 2 (Slack Integration) is implemented, this notification system will be enhanced with:

- **Slack channels** for different agent types and workflows
- **Rich message formatting** with attachments and threading
- **Team collaboration** features for better coordination
- **Integration with other development tools** (GitHub, CI/CD, etc.)
- **Better notification management** with search and history

**Current Pushover notifications will continue to work until the Slack integration is fully deployed.**

### 2. Notify test results

```typescript
// After running test suites
notifyTestResults(passed, failed, coverage);
```

### 3. Notify deployment status

```typescript
// After CI/CD deployments
notifyDeployment('staging', version, success);
```

### 4. Notify errors with context

```typescript
// When something goes wrong
notifyError('Database migration failed: connection timeout');
```

### 5. Use appropriate priorities

```typescript
// Normal task completion
notifySuccess('Code formatting completed');

// Important milestone
notifyImportant('All Epic 1 stories completed');

// Critical error
notifyError('Production deployment failed');
```

## Integration Examples

### In a Story Implementation

```typescript
async function implementStory12() {
  try {
    // ... implementation code ...

    // Run tests
    const testResults = await runTests();

    // Notify completion
    notifyStoryComplete('1.2', `Database schema implemented, ${testResults.passed} tests passing`);
  } catch (error) {
    notifyError(`Story 1.2 failed: ${error.message}`);
    throw error;
  }
}
```

### In a CI/CD Pipeline

```typescript
async function deployToProduction() {
  try {
    // ... deployment code ...

    notifyDeployment('production', version, true);
  } catch (error) {
    notifyDeployment('production', version, false);
    throw error;
  }
}
```

## Troubleshooting

### Notification not working?

1. Check that `.env` file exists with Pushover credentials
2. Verify `PUSHOVER_USER_KEY` and `PUSHOVER_APP_TOKEN` are set
3. Test with: `npm run notify:success`

### TypeScript errors?

1. Make sure `@myloware/shared` is imported correctly
2. Check that the shared package is built: `npm run build`

### No notification received?

1. Check your Pushover app settings
2. Verify your device is online
3. Check the notification priority level
