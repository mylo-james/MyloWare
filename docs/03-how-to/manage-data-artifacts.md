# Managing Data Artifacts

**Audience:** Developers adding or modifying personas, projects, workflows, or guardrails  
**Outcome:** Understand how to create, validate, and ingest data artifacts

---

## Overview

MyloWare uses a structured `data/v1/` directory for all configuration artifacts. This guide explains the conventions, schemas, and ingestion pipeline.

---

## Directory Structure

```
data/v1/
├── personas/
│   └── <persona-name>/
│       ├── persona.json          # Core config
│       ├── prompt.md             # System prompt
│       ├── capabilities.json     # What they can do
│       └── checklists.json       # Validation rules
├── projects/
│   └── <project-slug>/
│       ├── project.json          # Core config
│       └── guardrails/
│           └── <category>.<name>.json  # Individual rules
├── workflows/
│   └── <project>/<workflow-key>/
│       ├── workflow.json         # Core config
│       ├── nodes/                # Individual steps
│       │   └── 01.*.json
│       ├── schemas/              # Output schemas
│       └── guardrails/           # Workflow-specific rules
├── schemas/                      # JSON Schemas for validation
└── manifests/
    └── all.json                  # Registry (auto-generated)
```

---

## Artifact Conventions

### IDs and Keys

- **Personas:** Lowercase name (e.g., `iggy`, `riley`)
- **Projects:** Lowercase slug with underscores (e.g., `aismr`, `test_video_gen`)
- **Guardrails:** `<project>.<category>.<name>.v<version>` (e.g., `aismr.timing.runtime.v1`)
- **Workflows:** `<project>.<workflow-name>.v<version>` (e.g., `aismr.idea_generation.v1`)

### Versioning

All artifacts include `metadata.version` using semantic versioning:

```json
{
  "metadata": {
    "version": "1.0.0",
    "tags": ["persona", "creative-director"]
  }
}
```

### Links

Artifacts use `links` blocks to reference other entities:

```json
{
  "links": {
    "defaultProject": "aismr",
    "personas": ["casey", "iggy", "riley"]
  }
}
```

---

## Adding a New Persona

1. Create directory:
   ```bash
   mkdir -p data/v1/personas/myagent
   ```

2. Create `persona.json`:
   ```json
   {
     "name": "myagent",
     "title": "My Agent",
     "description": "What this agent does",
     "tone": "professional, helpful",
     "allowedTools": ["memory_search", "memory_store", "handoff_to_agent"],
     "defaultProject": "general",
     "metadata": {
       "version": "1.0.0",
       "tags": ["persona"]
     },
     "links": {
       "defaultProject": "general"
     }
   }
   ```

3. Create `prompt.md`:
   ```markdown
   # My Agent System Prompt
   
   You are My Agent. You do X, Y, and Z.
   
   ## Core Principles
   - Principle 1
   - Principle 2
   ```

4. Create `capabilities.json`:
   ```json
   {
     "capabilities": [
       "Capability 1",
       "Capability 2"
     ]
   }
   ```

5. Create `checklists.json`:
   ```json
   {
     "before_handoff": [
       "Check 1",
       "Check 2"
     ],
     "definition_of_done": [
       "Done 1",
       "Done 2"
     ]
   }
   ```

6. Validate and ingest:
   ```bash
   npm run ingest-data:dry-run  # Check validation
   npm run ingest-data          # Upsert to DB
   ```

---

## Adding a New Project

1. Create directory:
   ```bash
   mkdir -p data/v1/projects/myproject/guardrails
   ```

2. Create `project.json`:
   ```json
   {
     "name": "myproject",
     "title": "My Project",
     "description": "What this project produces",
     "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
     "optionalSteps": [],
     "specs": {
       "videoCount": 12,
       "videoDuration": 8.0
     },
     "settings": {
       "provider": "runway"
     },
     "guardrails": {
       "summary": "Brief summary of guardrails",
       "categories": ["timing", "visual", "audio"]
     },
     "metadata": {
       "version": "1.0.0",
       "tags": ["project", "video-production"]
     },
     "links": {
       "personas": ["casey", "iggy", "riley", "veo", "alex", "quinn"]
     }
   }
   ```

3. Create guardrails (one file per rule):
   ```json
   {
     "key": "myproject.timing.runtime.v1",
     "category": "timing",
     "name": "runtime",
     "rule": "Exactly 8.0s per video",
     "validation": "Riley must validate before storing",
     "tolerance": "±0.1s",
     "enforcement": "strict",
     "metadata": {
       "version": "1.0.0",
       "tags": ["guardrail", "timing"]
     },
     "links": {
       "project": "myproject"
     }
   }
   ```

4. Ingest:
   ```bash
   npm run ingest-data
   ```

---

## Adding a New Workflow

1. Create directory:
   ```bash
   mkdir -p data/v1/workflows/myproject/my-workflow/{nodes,schemas,guardrails}
   ```

2. Create `workflow.json`:
   ```json
   {
     "workflowKey": "myproject.my_workflow.v1",
     "name": "My Workflow",
     "description": "What this workflow does",
     "ownerPersona": "iggy",
     "project": "myproject",
     "metadata": {
       "version": "1.0.0",
       "tags": ["workflow", "procedural"]
     },
     "links": {
       "project": "myproject",
       "ownerPersona": "iggy",
       "guardrails": ["myproject.timing.runtime.v1"]
     }
   }
   ```

3. Create nodes (one file per step):
   ```json
   {
     "id": "load_context",
     "step": 1,
     "type": "mcp_call",
     "description": "Load upstream context",
     "mcp_call": {
       "tool": "memory_search",
       "params": {
         "query": "context query",
         "traceId": "${context.traceId}",
         "limit": 10
       },
       "storeAs": "context"
     },
     "links": {
       "workflow": "myproject.my_workflow.v1"
     }
   }
   ```

4. Ingest:
   ```bash
   npm run ingest-data
   ```

---

## Validation

All artifacts are validated against JSON Schemas before ingestion:

```bash
# Dry run to check validation
npm run ingest-data:dry-run

# View validation errors
# Errors will show which schema failed and why
```

Schemas are in `data/v1/schemas/*.schema.json`.

---

## Ingestion Pipeline

The ingestion script (`scripts/ingest-data.ts`) performs:

1. **Validation:** Checks all artifacts against JSON Schemas
2. **Upsert:** Inserts or updates database records
3. **Link Resolution:** Builds `related_to` edges between memories
4. **Idempotency:** Safe to run multiple times (updates existing records)

### Ingestion Mapping

- **Personas** → `personas` table
- **Projects** → `projects` table
- **Guardrails** → `memories` table (semantic, tagged `guardrail`)
- **Workflows** → `memories` table (procedural, tagged `workflow`)

### Link Graph

After ingestion, workflows are linked to their guardrails via `memories.related_to`:

```
workflow (procedural memory)
  ├─► guardrail 1 (semantic memory)
  ├─► guardrail 2 (semantic memory)
  └─► guardrail 3 (semantic memory)
```

This enables:
- Agents to retrieve workflows and their guardrails together
- Graph traversal for related rules
- Version tracking (link to specific guardrail versions)

---

## Best Practices

### File Organization

- **One artifact per file:** Easier to review and diff
- **Descriptive names:** `timing.runtime.json` not `rule1.json`
- **Consistent structure:** Follow existing examples

### Versioning

- **Semantic versioning:** `1.0.0` for initial, `1.1.0` for features, `2.0.0` for breaking changes
- **Version in keys:** Guardrails and workflows include version in key (e.g., `.v1`)
- **Deprecation:** Keep old versions for rollback; mark deprecated in metadata

### Metadata

- **Always include:** `version`, `tags`
- **Use tags for filtering:** `["persona"]`, `["guardrail", "timing"]`, `["workflow", "procedural"]`
- **Add source refs:** `sourceDocRef` for linking to external docs

### Links

- **Explicit references:** Use `links` block for all cross-references
- **Validate targets:** Ensure linked entities exist before ingestion
- **Bidirectional:** Link both ways when appropriate (workflow ↔ guardrail)

---

## Troubleshooting

### Validation Errors

```bash
# Check schema validation
npm run ingest-data:dry-run

# Common issues:
# - Missing required fields (name, version, etc.)
# - Invalid version format (must be X.Y.Z)
# - Invalid links (referencing non-existent entities)
```

### Ingestion Failures

```bash
# Check database connection
npm run db:status

# Reset and re-ingest
npm run db:reset
npm run ingest-data
```

### Link Graph Issues

```bash
# Query memories to verify links
psql $DATABASE_URL -c "
  SELECT id, content, related_to, metadata->>'workflowKey'
  FROM memories
  WHERE metadata->>'sourceType' = 'workflow';
"
```

---

## Migration from Legacy data/

The old `data/` directory is deprecated. To migrate:

1. New artifacts go in `data/v1/`
2. Run ingestion: `npm run ingest-data`
3. Verify in DB: Check `personas`, `projects`, `memories` tables
4. Once stable, remove old `data/` files

**Do not edit old `data/` files.** They are read-only for reference.

---

## Knowledge Ingestion Workflow

The `knowledge_ingest` tool allows agents to enrich the knowledge base by ingesting external sources (URLs or raw text). This is useful when agents need to learn about new APIs, documentation, or domain knowledge.

### Basic Usage

Casey receives a knowledge dump and wants to enrich the knowledge base:

```javascript
// Casey calls knowledge_ingest with URLs
knowledge_ingest({
  traceId: "trace-001",
  urls: ["https://shotstack.io/docs/api"],
  bias: { persona: ["veo"], project: ["aismr"] }
})
// Returns: { inserted: 12, updated: 3, skipped: 0 }
```

### How It Works

1. **Fetch URLs** (if provided): Uses `web_read` to fetch and extract text from URLs
2. **Chunk Text**: Splits content into ~1500 character chunks at sentence boundaries
3. **Classify**: Uses GPT-4o-mini to classify each chunk:
   - Which personas would find this useful?
   - Which projects does this relate to?
   - What memory type (semantic/procedural/episodic)?
4. **Deduplicate**: Searches for similar memories using vector similarity (0.92 threshold by default)
   - If duplicate found: Merges persona/project arrays, updates metadata
   - If new: Detects related memories and stores with links
5. **Store**: Creates semantic memories with proper tags and metadata

### Bias Parameters

Use `bias` to guide classification toward specific personas/projects:

```javascript
knowledge_ingest({
  traceId: "trace-001",
  text: "API documentation about video generation",
  bias: {
    persona: ["veo", "alex"],  // Likely relevant to these personas
    project: ["aismr"]         // Likely relevant to this project
  }
})
```

The bias is merged with LLM classification - if the LLM says "iggy" but you bias with "veo", both will be included.

### Deduplication Threshold

The `minSimilarity` parameter controls how strict deduplication is:

- **0.92 (default)**: Moderate deduplication - updates existing memories if very similar
- **0.95**: Loose - only updates if almost identical
- **0.88**: Strict - more likely to create new memories

```javascript
knowledge_ingest({
  traceId: "trace-001",
  text: "Similar content to existing memory",
  minSimilarity: 0.95  // Only update if 95%+ similar
})
```

### Example: Enriching Knowledge Base

Casey receives a request to learn about a new video API:

```javascript
// 1. Search for existing knowledge
memory_search({ query: "Shotstack API", traceId: "trace-001" })
// Returns sparse results

// 2. Ingest documentation
knowledge_ingest({
  traceId: "trace-001",
  urls: [
    "https://shotstack.io/docs/api",
    "https://shotstack.io/docs/api/rate-limits"
  ],
  bias: { persona: ["veo"], project: ["aismr"] }
})

// 3. Now Veo can search and find enriched knowledge
memory_search({
  query: "Shotstack rate limits",
  persona: "veo",
  traceId: "trace-002"
})
// Returns enriched results with source URLs in metadata
```

### Best Practices

- **Always include traceId**: Required for coordination and tracking
- **Use bias when you know relevance**: Helps classification accuracy
- **Batch URLs**: Pass multiple URLs in one call for efficiency
- **Check for duplicates**: Use `memory_search` first to see if knowledge already exists
- **Review inserted/updated counts**: High `updated` count suggests good deduplication

### Related Tools

- `web_search` - Search the web for sources before ingesting
- `web_read` - Fetch and extract text from a single URL
- `memory_search` - Query ingested knowledge

---

## Next Steps

- [Add a Persona](add-a-persona.md) - Detailed persona creation guide
- [Add a Project](add-a-project.md) - Detailed project creation guide
- [Schema Reference](../06-reference/schema.md) - Database schema details
- [MCP Tools](../06-reference/mcp-tools.md) - Available tools for workflows

---

**Questions?** See [Troubleshooting](../05-operations/troubleshooting.md) or ask in team chat.

