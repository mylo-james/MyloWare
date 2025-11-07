# n8n Error Handling Architecture

## Overview

The n8n workflow system uses a dedicated error handler workflow to catch and process failures across all agent workflows. This provides centralized error handling, trace status updates, user notifications, and observability.

## Error Handler Workflow

**File:** `workflows/error-handler.workflow.json`

### Architecture

```
Error Trigger → Extract Error Data → Has Trace ID? → Update Trace Status → Store Error Memory → Is Telegram Session? → Notify User / Log Error
```

### Components

1. **Error Trigger Node**
   - Monitors all workflows linked via `settings.errorWorkflow`
   - Receives error data when any monitored workflow fails

2. **Extract Error Data Node**
   - Extracts `traceId` from execution metadata or workflow context
   - Extracts error details: message, stack trace, last node executed
   - Handles both trigger node errors and execution errors

3. **Update Trace Status Node**
   - Calls MCP `handoff_to_agent` with `toAgent: 'error'`
   - Marks trace as `failed` in the database
   - Includes error details in trace metadata

4. **Store Error Memory Node**
   - Stores error details in memory with tags `['error', 'workflow-failure']`
   - Includes execution ID, workflow name, error message, stack trace
   - Enables error analysis and debugging

5. **Notify User Node**
   - Sends Telegram notification if `sessionId` starts with `telegram:`
   - Includes workflow name, failed node, error message, execution URL
   - Falls back to logging for non-Telegram sessions

## Universal Workflow Settings

**File:** `workflows/myloware-agent.workflow.json`

### Error Workflow Configuration

```json
{
  "settings": {
    "executionTimeout": 3600,
    "errorWorkflow": "error-handler-workflow-id",
    "saveDataErrorExecution": "all",
    "saveDataSuccessExecution": "all",
    "saveExecutionProgress": true
  }
}
```

**Important:** After importing the error handler workflow, update `errorWorkflow` with the actual workflow ID from your n8n instance.

### Node-Level Retries

**Prepare Trace Context Node:**
- `retryOnFail: true`
- `maxTries: 3`
- `waitBetweenTries: 1000` (1 second)
- `options.timeout: 30000` (30 seconds)

This handles transient MCP server failures and network issues.

## Error Data Structure

### Execution Errors

```json
{
  "execution": {
    "id": "231",
    "url": "https://n8n.example.com/execution/231",
    "error": {
      "message": "Example Error Message",
      "stack": "Stacktrace"
    },
    "lastNodeExecuted": "Node With Error",
    "mode": "manual"
  },
  "workflow": {
    "id": "1",
    "name": "Example Workflow"
  }
}
```

### Trigger Errors

```json
{
  "trigger": {
    "error": {
      "name": "WorkflowActivationError",
      "message": "Error message",
      "stack": "Stacktrace"
    }
  },
  "workflow": {
    "id": "1",
    "name": "Example Workflow"
  }
}
```

## Common Error Scenarios

### MCP Server Down

**Symptoms:**
- `Prepare Trace Context` node fails with connection error
- Error handler workflow triggers
- Trace marked as `failed`

**Resolution:**
- Check MCP health check workflow alerts
- Restart MCP server
- Manually retry failed traces if needed

### Invalid Input

**Symptoms:**
- `Validate Input` node throws validation error
- Error includes specific validation failures

**Resolution:**
- Check error message for validation details
- Fix input format (sessionId prefix, traceId UUID, etc.)
- Retry workflow execution

### Trace Not Found

**Symptoms:**
- `handoff_to_agent` fails with "Trace not found"
- Error handler marks trace as failed

**Resolution:**
- Verify traceId exists in database
- Check if trace was deleted or expired
- Create new trace if needed

## Monitoring and Debugging

### Error Memory Search

Search for errors by traceId:

```typescript
memory_search({
  query: 'workflow failure',
  traceId: 'trace-aismr-001',
  tags: ['error', 'workflow-failure']
})
```

### Execution History

All error executions are saved with full data:
- Access via n8n execution history
- Includes node outputs, error details, execution URL
- Searchable by workflow name, traceId, error message

## Best Practices

1. **Always link error workflow** in workflow settings
2. **Monitor error memory** for patterns and trends
3. **Set appropriate timeouts** to prevent hanging executions
4. **Use retries** for transient failures (network, API rate limits)
5. **Don't retry** expensive operations (LLM calls) automatically
6. **Store error context** in memory for debugging

## Troubleshooting

### Error Workflow Not Triggering

- Verify `settings.errorWorkflow` is set correctly
- Check error workflow is active in n8n
- Ensure error workflow has Error Trigger node configured

### Missing Trace ID in Errors

- Check execution metadata includes traceId
- Verify traceId is passed through workflow nodes
- Use execution custom data to track traceId

### Telegram Notifications Not Sending

- Verify sessionId starts with `telegram:`
- Check Telegram credentials are configured
- Ensure Telegram bot has permission to send messages

