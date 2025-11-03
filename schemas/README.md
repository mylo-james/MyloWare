# AISMR Output Schemas

This directory contains JSON Schema files for AI Agent structured outputs. These schemas are injected into n8n workflows' Structured Output Parser nodes.

## Schema Files

- `aismr-idea-output.schema.json` - Used by `generate-ideas.workflow.json`
- `aismr-screenplay-output.schema.json` - Used by `screen-writer.workflow.json`

## Workflow Integration

The schemas in this directory are the **source of truth**. They get injected into workflows via:

```bash
npm run schemas:inject    # Inject schemas into workflows (before n8n:push)
npm run schemas:extract   # Extract schemas from workflows (after n8n:pull)
```

## Editing Schemas

1. Edit the `.schema.json` file in this directory
2. Run `npm run schemas:inject` to update the workflows
3. Run `npm run n8n:push` to sync to n8n cloud

## Schema Format

Schemas are standard JSON Schema (draft-07) that n8n's Structured Output Parser node understands.

The schemas are stored in workflows as stringified JSON in the `inputSchema` or `jsonSchema` parameter of the Structured Output Parser node.

