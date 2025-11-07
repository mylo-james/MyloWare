# n8n Workflow ID Mapping System

## Overview

The workflow mapping system resolves human-readable workflow keys to environment-specific n8n workflow IDs. This enables portable workflow imports across different n8n instances (dev, staging, production) without hard-coding workflow IDs.

## Architecture

### Database Table

**Table:** `workflow_mappings`

```sql
CREATE TABLE workflow_mappings (
  id UUID PRIMARY KEY,
  workflow_key TEXT UNIQUE NOT NULL,  -- e.g., 'upload-google-drive'
  workflow_id TEXT NOT NULL,          -- n8n workflow ID (instance-specific)
  workflow_name TEXT NOT NULL,        -- Human-readable name
  environment TEXT NOT NULL DEFAULT 'production',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### MCP Tool

**Tool:** `workflow_resolve`

Resolves a workflow key to the current workflow ID for the specified environment.

**Parameters:**
- `workflowKey` (string, required): Human-readable key (e.g., `upload-google-drive`)
- `environment` (string, optional): Environment name (default: `production`)

**Returns:**
```json
{
  "workflowKey": "upload-google-drive",
  "workflowId": "zvJoSOEUDr9hXOLV",
  "workflowName": "Upload file to Google Drive",
  "environment": "production"
}
```

## Registration Script

**File:** `scripts/register-workflow-mappings.ts`

**Usage:**
```bash
# Set workflow IDs via environment variables
N8N_WORKFLOW_ID_UPLOAD_GOOGLE_DRIVE=zvJoSOEUDr9hXOLV \
N8N_WORKFLOW_ID_UPLOAD_TIKTOK=uIWB6d8OslTpJl1G \
npm run register:workflows

# Or specify environment
N8N_ENVIRONMENT=staging npm run register:workflows
```

**Default Mappings:**
- `upload-google-drive` → `zvJoSOEUDr9hXOLV`
- `upload-tiktok` → `uIWB6d8OslTpJl1G`
- `shotstack-edit` → `9bJoXKRxCLs0B0Ww`
- `generate-video` → `ZzHQ2hTTYcdwN63q`

## Using Workflow Resolution

### In n8n Workflows

Before calling a `toolWorkflow` node, resolve the workflow ID:

```javascript
// Code node: Resolve Workflow ID
const resolved = await fetch('https://mcp-vector.mjames.dev/mcp', {
  method: 'POST',
  headers: {
    'X-API-Key': 'your-mcp-auth-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    tool: 'workflow_resolve',
    arguments: {
      workflowKey: 'upload-google-drive',
      environment: 'production'
    }
  })
});

const { workflowId } = await resolved.json();
return [{ json: { workflowId } }];
```

Then use the resolved ID in the `toolWorkflow` node:

```json
{
  "parameters": {
    "workflowId": {
      "value": "={{ $json.workflowId }}",
      "mode": "id"
    }
  }
}
```

### In MCP Tools

Call `workflow_resolve` before invoking tool workflows:

```typescript
const mapping = await workflowResolve({
  workflowKey: 'upload-google-drive',
  environment: 'production'
});

// Use mapping.workflowId to invoke workflow
```

## Workflow Keys

### Standard Keys

| Key | Workflow Name | Description |
|-----|---------------|-------------|
| `upload-google-drive` | Upload file to Google Drive | Uploads files to Google Drive. Called by Quinn. |
| `upload-tiktok` | Upload to TikTok | Uploads videos to TikTok. Called by Quinn. |
| `shotstack-edit` | Edit_AISMR | Edits videos via Shotstack API. Called by Alex. |
| `generate-video` | Generate Video | Generates video clips from screenplays. Called by Veo. |

### Adding New Workflows

1. **Create workflow in n8n**
2. **Register mapping:**
   ```bash
   N8N_WORKFLOW_ID_NEW_WORKFLOW=abc123 \
   npm run register:workflows
   ```
3. **Update registration script** with new mapping
4. **Update documentation** with new workflow key

## Environment Management

### Multiple Environments

The mapping system supports multiple environments:

```bash
# Production
N8N_ENVIRONMENT=production npm run register:workflows

# Staging
N8N_ENVIRONMENT=staging npm run register:workflows

# Development
N8N_ENVIRONMENT=development npm run register:workflows
```

Each environment maintains its own workflow ID mappings.

### Environment-Specific Workflows

Some workflows may differ between environments:
- Development: Mock/test workflows
- Staging: Production-like workflows with test data
- Production: Live workflows

Use the `environment` parameter when resolving workflows to get the correct ID.

## Migration Guide

### From Hard-Coded IDs

**Before:**
```json
{
  "workflowId": {
    "value": "zvJoSOEUDr9hXOLV",
    "mode": "list"
  }
}
```

**After:**
1. Register workflow mapping
2. Resolve workflow ID before toolWorkflow node
3. Use resolved ID dynamically

### Workflow Import Process

1. **Import workflows** to n8n instance
2. **Get workflow IDs** from n8n UI
3. **Register mappings:**
   ```bash
   N8N_WORKFLOW_ID_UPLOAD_GOOGLE_DRIVE=<new-id> \
   npm run register:workflows
   ```
4. **Verify mappings:**
   ```bash
   npm run register:workflows  # Lists all mappings
   ```

## Troubleshooting

### Workflow Not Found

**Error:** `Workflow mapping not found for key: upload-google-drive`

**Resolution:**
1. Check workflow key spelling
2. Verify mapping exists: `SELECT * FROM workflow_mappings WHERE workflow_key = 'upload-google-drive'`
3. Register mapping if missing

### Wrong Workflow ID

**Symptom:** Tool workflow calls wrong workflow

**Resolution:**
1. Verify workflow ID in database
2. Update mapping: `npm run register:workflows` with correct ID
3. Check environment matches (production vs staging)

### Environment Mismatch

**Symptom:** Resolving workflow returns wrong ID

**Resolution:**
1. Verify `environment` parameter matches registration
2. Check multiple environments don't conflict
3. Use explicit environment in `workflow_resolve` call

## Best Practices

1. **Always register workflows** after importing to new environment
2. **Use workflow keys** instead of hard-coded IDs
3. **Document workflow keys** in workflow README
4. **Version control mappings** via registration script
5. **Test workflow resolution** before deploying
6. **Monitor workflow ID changes** (n8n may regenerate IDs)

## Repository

**File:** `src/db/repositories/workflow-mapping-repository.ts`

**Methods:**
- `findByKey(workflowKey, environment)` - Find mapping by key
- `upsert(mapping)` - Create or update mapping
- `listByEnvironment(environment)` - List all mappings for environment
- `deactivate(id)` - Deactivate a mapping

