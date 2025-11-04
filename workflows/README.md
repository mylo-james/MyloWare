# n8n Workflows

This directory contains n8n workflow definitions for the MCP Prompts project.

## Workflow State Management

All workflows that use `workflow_runs` MUST follow the patterns documented in [`docs/WORKFLOW_BEST_PRACTICES.md`](../docs/WORKFLOW_BEST_PRACTICES.md).

### Validation

Before committing workflow changes, run the validator:

```bash
npm run validate:workflows
```

This will check for:

- Output preservation violations
- Stage overwrite without cloning
- Missing error handlers
- Missing merge operations in PATCH requests

### Code Templates

Standard code templates are available in [`docs/WORKFLOW_CODE_TEMPLATES.md`](../docs/WORKFLOW_CODE_TEMPLATES.md).

Generate templates with:

```bash
npm run generate:workflow-templates
```

View specific template:

```bash
npx tsx scripts/generateWorkflowTemplates.ts show 1  # Normalize State
npx tsx scripts/generateWorkflowTemplates.ts show 2  # Mark Stage In Progress
npx tsx scripts/generateWorkflowTemplates.ts show 3  # Mark Stage Complete
npx tsx scripts/generateWorkflowTemplates.ts show 4  # Error Handler
```

## Workflow Inventory

### Active Workflows (use workflow_runs)

1. **AISMR.workflow.json** - Main orchestrator for AISMR video generation
2. **generate-ideas.workflow.json** - Idea generation stage
3. **screen-writer.workflow.json** - Screenplay writing stage
4. **generate-video.workflow.json** - Video generation stage
5. **edit-aismr.workflow.json** - Video editing stage
6. **upload-to-tiktok.workflow.json** - TikTok publishing
7. **upload-file-to-google-drive.workflow.json** - Google Drive backup

### Utility Workflows (no workflow_runs)

8. **chat.workflow.json** - General chat interface
9. **mylo-mcp-bot.workflow.json** - MCP bot orchestrator
10. **load-persona.workflow.json** - Persona loading utility
11. **poll-db.workflow.json** - Database polling utility

## Workflow Development Checklist

When creating or modifying workflows:

- [ ] Follow naming convention: `{purpose}.workflow.json`
- [ ] Include required nodes for state management workflows:
  - [ ] Load State node (GET `/api/workflow-runs/{runId}`)
  - [ ] Normalize State node (extract and flatten)
  - [ ] Mark Stage Start nodes
  - [ ] Mark Stage Complete nodes
  - [ ] Error Trigger node with state preservation
- [ ] Always preserve prior outputs: `output: { ...(run.output ?? {}), ... }`
- [ ] Always clone stages before modification
- [ ] Include error handlers that preserve state
- [ ] Test with validator: `npm run validate:workflows`
- [ ] Document any custom behavior in this README

## Common Pitfalls

### ❌ Bad: Overwriting outputs

```javascript
return {
  output: {
    video_generation: { videoUrl: '...' },
  },
};
```

### ✅ Good: Preserving outputs

```javascript
const run = $('Get Run').item?.json ?? {};
return {
  output: {
    ...(run.output ?? {}), // Preserve all prior outputs
    video_generation: {
      ...(run.output?.video_generation ?? {}),
      videoUrl: '...',
      completedAt: new Date().toISOString(),
    },
  },
};
```

### ❌ Bad: Direct stage assignment

```javascript
return {
  stages: {
    idea_generation: { status: 'completed' },
  },
};
```

### ✅ Good: Clone and preserve

```javascript
const run = $('Get Run').item?.json ?? {};
const stages = run.stages ?? {};
const clone = (value) => (value && typeof value === 'object' ? { ...value } : {});

return {
  stages: {
    idea_generation: clone(stages.idea_generation),
    screenplay: clone(stages.screenplay),
    video_generation: {
      ...clone(stages.video_generation),
      status: 'completed',
      output: { ... }
    },
    publishing: clone(stages.publishing)
  }
};
```

## Exporting Workflows

From n8n UI:

1. Open workflow
2. Click "..." menu
3. Select "Export"
4. Save to this directory

Or use n8n CLI:

```bash
n8n export:workflow --id=WORKFLOW_ID --output=./workflows/my-workflow.workflow.json
```

## Importing Workflows

```bash
# Import single workflow
n8n import:workflow --input=./workflows/my-workflow.workflow.json

# Import all workflows
n8n import:workflow --input=./workflows/
```

## Testing Workflows

After making changes:

1. **Validate structure**: `npm run validate:workflows`
2. **Import to n8n**: Import updated JSON
3. **Test execution**: Run with test data
4. **Verify state**: Check workflow_runs table for proper state preservation
5. **Test error scenarios**: Trigger failures and verify error handling

## Continuous Integration

Workflow validation runs automatically in CI:

- Pre-commit hook checks all workflows
- GitHub Actions validates on every PR
- Violations block merge until fixed

## Resources

- [n8n Workflow Best Practices](../docs/WORKFLOW_BEST_PRACTICES.md) - Required reading
- [Workflow Code Templates](../docs/WORKFLOW_CODE_TEMPLATES.md) - Standard patterns
- [Workflow Validation Report](../docs/WORKFLOW_VALIDATION_REPORT.md) - Latest validation results
- [n8n Documentation](https://docs.n8n.io/) - Official n8n docs

## Support

For workflow issues:

1. Check validator output
2. Review best practices guide
3. Compare with working workflows
4. Check execution logs in n8n UI
