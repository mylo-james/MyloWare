# Adding New Projects to the Workflow System

This guide explains how to add a new video/content generation project to the MCP Prompts system, making it work alongside AISMR and other projects.

## Overview

The system uses **RAG-driven workflows** where:
- **Workflow definitions** are stored in RAG as procedural memory
- **Project configurations** define project-specific requirements
- **n8n workflows** load and execute these definitions dynamically
- **Manual review gates** provide quality control between stages

## Step-by-Step Guide

### Step 1: Create Project Configuration

Create a project configuration file in `prompts/projects/`:

**File:** `prompts/projects/your-project-config.json`

```json
{
  "id": "your-project",
  "title": "Your Project Title",
  "project": ["your-project"],
  "memoryType": "project",
  "workflow": {
    "taskDescription": "Clear description of what this project generates",
    "outputSchema": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "content": { "type": "string" }
      },
      "required": ["title", "content"]
    },
    "guardrails": [
      {
        "type": "duration",
        "rule": {
          "name": "content_duration",
          "rule": {
            "min": 30,
            "max": 120
          }
        },
        "onViolation": "halt"
      }
    ]
  },
  "generation_api": "https://api.example.com/v1/generate",
  "generation_config": {
    "aspect_ratio": "16:9",
    "resolution": "1920x1080"
  },
  "publishing_platforms": ["youtube", "tiktok"],
  "evaluation_criteria": [
    "Quality metric 1",
    "Quality metric 2"
  ]
}
```

### Step 2: Create Workflow Definitions

Create workflow JSON files for each stage in `prompts/workflows/`:

#### 2a. Idea Generation Workflow

**File:** `prompts/workflows/your-project-idea-generation-workflow.json`

```json
{
  "title": "Your Project Idea Generation Workflow",
  "memoryType": "procedural",
  "project": ["your-project"],
  "persona": ["your-persona"],
  "version": "1.0.0",
  "workflow": {
    "name": "Generate Ideas",
    "description": "Generate ideas for your project",
    "steps": [
      {
        "id": "remember_past",
        "step": 1,
        "type": "mcp_call",
        "mcp_call": {
          "tool": "conversation.remember",
          "params": {
            "sessionId": "${context.sessionId}",
            "query": "past ideas",
            "limit": 20
          },
          "storeAs": "pastIdeas"
        }
      },
      {
        "id": "generate_ideas",
        "step": 2,
        "type": "llm_generation",
        "dependsOn": ["remember_past"],
        "llm_generation": {
          "model": "gpt-4",
          "prompt": "Generate ideas about ${context.userInput}...",
          "schema": {
            "type": "object",
            "properties": {
              "ideas": {
                "type": "array",
                "items": { "type": "object" }
              }
            }
          },
          "structuredOutput": true,
          "storeAs": "generatedIdeas"
        }
      },
      {
        "id": "store_result",
        "step": 3,
        "type": "mcp_call",
        "dependsOn": ["generate_ideas"],
        "mcp_call": {
          "tool": "conversation.store",
          "params": {
            "sessionId": "${context.sessionId}",
            "role": "assistant",
            "content": "Generated ideas",
            "tags": ["your-project", "idea-generation"],
            "metadata": {
              "stage": "idea_generation",
              "workflowRunId": "${context.workflowRunId}"
            }
          }
        }
      }
    ],
    "output_format": {
      "type": "object",
      "properties": {
        "ideas": { "type": "array" }
      }
    }
  }
}
```

#### 2b. Create Other Stage Workflows

Repeat for:
- `your-project-content-generation-workflow.json`
- `your-project-production-workflow.json`
- `your-project-publishing-workflow.json`

### Step 3: Ingest into RAG

Run the ingestion script to add your new prompts to RAG:

```bash
npm run ingest:prompts
```

This will:
- Parse all JSON files in `prompts/`
- Generate embeddings
- Store in the database
- Make them searchable via MCP tools

### Step 4: Update n8n Workflows (Optional)

If your project needs custom n8n workflow logic beyond the generic templates:

1. Copy `workflows/generate-ideas.workflow.json` to `workflows/your-project-generate-ideas.workflow.json`
2. Update workflow to:
   - Call MCP Bot with your `projectId`
   - Handle your project-specific outputs
   - Include manual approval gates where needed

3. The MCP Bot will automatically:
   - Load your workflow definition from RAG
   - Execute steps according to your definition
   - Respect your guardrails and validation rules

### Step 5: Test Your Workflow

1. **Create a workflow run:**
   ```bash
   curl -X POST https://mcp-vector.mjames.dev/api/workflow-runs \
     -H "Content-Type: application/json" \
     -d '{
       "projectId": "your-project",
       "sessionId": "test-session-id",
       "input": {"userInput": "test input"}
     }'
   ```

2. **Trigger your workflow via n8n** or directly via API

3. **Review approvals** via the workflow run details API

4. **Verify outputs** match your `output_format`

## Examples

### Example 1: YouTube Shorts

See:
- `prompts/projects/youtube-shorts-config.json` - Project config
- `prompts/workflows/youtube-shorts-idea-generation-workflow.json` - Workflow definition

### Example 2: Podcast Clips

See:
- `prompts/projects/podcast-clips-config.json` - Project config
- `prompts/workflows/podcast-clips-extraction-workflow.json` - Workflow definition

### Example 3: AISMR (Reference)

See:
- `prompts/workflows/aismr-idea-generation-workflow.json`
- `prompts/workflows/aismr-screenplay-workflow.json`
- `prompts/workflows/aismr-video-generation-workflow.json`
- `prompts/workflows/aismr-publishing-workflow.json`

## Workflow Definition Reference

### Step Types

1. **`mcp_call`** - Call an MCP tool
   ```json
   {
     "type": "mcp_call",
     "mcp_call": {
       "tool": "prompts.search",
       "params": { "query": "test" },
       "storeAs": "result"
     }
   }
   ```

2. **`llm_generation`** - Generate content with LLM
   ```json
   {
     "type": "llm_generation",
     "llm_generation": {
       "prompt": "Generate...",
       "schema": { "type": "object" },
       "structuredOutput": true
     }
   }
   ```

3. **`api_call`** - Call external API
   ```json
   {
     "type": "api_call",
     "api_call": {
       "method": "POST",
       "url": "https://api.example.com",
       "body": {}
     }
   }
   ```

4. **`parallel`** - Execute multiple MCP calls in parallel
   ```json
   {
     "type": "parallel",
     "parallel_calls": [
       { "tool": "prompts.search", "params": {} },
       { "tool": "prompts.search", "params": {} }
     ]
   }
   ```

5. **`validation`** - Validate step output
   ```json
   {
     "type": "validation",
     "validation": {
       "schema": { "schema": {}, "onViolation": "halt" }
     }
   }
   ```

### Variable Resolution

Use `${context.*}` to reference execution context:
- `${context.sessionId}` - Session ID
- `${context.userInput}` - User input
- `${context.projectId}` - Project ID
- `${context.workflowRunId}` - Workflow run ID

Use `${stepId.*}` to reference previous step outputs:
- `${step1.output}` - Output from step with id "step1"

### Dependencies

Use `dependsOn` to control execution order:

```json
{
  "id": "step2",
  "dependsOn": ["step1"],
  "type": "mcp_call",
  ...
}
```

## Validation and Guardrails

Define validation rules in your workflow:

```json
{
  "validation": {
    "schema": {
      "schema": { "type": "object", "properties": {...} },
      "onViolation": "halt"
    },
    "timing": {
      "runtime": 60,
      "onViolation": "halt"
    },
    "uniqueness": {
      "against": ["${pastIdeas}"],
      "threshold": 0.7,
      "onViolation": "halt"
    }
  }
}
```

## Testing Checklist

- [ ] Project config ingested to RAG
- [ ] Workflow definitions ingested to RAG
- [ ] MCP Bot can find workflow definitions via search
- [ ] Workflow executes all steps correctly
- [ ] Validation rules work as expected
- [ ] Manual review gates trigger at correct stages
- [ ] Output matches `output_format` schema
- [ ] Error handling works gracefully

## Troubleshooting

### Workflow not found

- Check workflow JSON is valid
- Verify `project` array includes your project ID
- Ensure workflow was ingested: `npm run ingest:prompts`
- Search RAG manually: Use `prompts.search` tool with `project: "your-project"`

### Validation failures

- Check `output_format` matches actual output structure
- Verify guardrail rules are correct
- Ensure timing/duration values match your requirements

### Variables not resolving

- Check variable names match context keys
- Verify previous step IDs are correct
- Use `${context.*}` for execution context, `${stepId.*}` for step outputs

## Next Steps

Once your project is working:

1. **Add more stages** as needed (editing, enhancement, etc.)
2. **Tune validation rules** based on real outputs
3. **Add project-specific personas** if needed
4. **Create integration tests** for your workflows
5. **Document project-specific patterns** in your team wiki

## Questions?

- See `REVIEW.md` for architecture overview
- Check existing workflows in `prompts/workflows/`
- Review example projects in `prompts/projects/`
