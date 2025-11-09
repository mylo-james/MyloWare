# Knowledge Base

This directory is for ingesting knowledge into the MyloWare memory system.

## Usage

### 1. Add Knowledge Files

Drop any markdown or text files directly into this directory:

```bash
# Example
echo "# API Documentation" > data/kb/api-docs.md
```

### 2. Run Ingestion

```bash
# Process all files in kb/
npx tsx scripts/dev/run-knowledge-ingest.ts

# Or with options
npx tsx scripts/dev/run-knowledge-ingest.ts --dry-run
npx tsx scripts/dev/run-knowledge-ingest.ts --max-chunks=10
npx tsx scripts/dev/run-knowledge-ingest.ts --similarity=0.95
```

### 3. Files Auto-Move

After ingestion, files automatically move to `ingested/`:

```
data/kb/
├── api-docs.md          ← You add files here
└── ingested/
    └── api-docs.md      ← They move here after processing
```

## What Happens During Ingestion

1. **Chunking**: Large files split into manageable chunks (target: 1500 chars)
2. **Classification**: LLM determines which personas/projects each chunk relates to
3. **Deduplication**: Checks for similar existing memories (similarity threshold: 0.92)
4. **Storage**: Creates new memories or updates existing ones
5. **File Move**: Processed file moves to `ingested/` subdirectory

## Options

### Dry Run

Test without database writes or file moves:

```bash
npx tsx scripts/dev/run-knowledge-ingest.ts --dry-run
```

### Limit Chunks

Process only first N chunks per file (useful for testing):

```bash
npx tsx scripts/dev/run-knowledge-ingest.ts --max-chunks=5
```

### Similarity Threshold

Adjust deduplication sensitivity (0.0-1.0, default: 0.92):

```bash
npx tsx scripts/dev/run-knowledge-ingest.ts --similarity=0.95
```

## Environment Variables

You can also set options via environment variables:

```bash
# In .env
KNOWLEDGE_MAX_CHUNKS=10
```

## Example Output

```
Starting knowledge ingestion from /path/to/data/kb

[api-docs.md] Generated traceId: abc-123
[api-docs.md] Ingestion result: inserted=3, updated=1, skipped=0, total=4
[api-docs.md] Moved to /path/to/data/kb/ingested/api-docs.md

==================================================
📋 Knowledge Ingestion Complete
==================================================
📁 Processed files: 1
✅ Successful ingests: 1
❌ Failed ingests: 0
```

## Troubleshooting

### No files found

Make sure files are in `data/kb/` (not in subdirectories).

### Files not moving

Check that you don't have the `--dry-run` flag enabled.

### Deduplication too aggressive

Lower the similarity threshold:

```bash
npx tsx scripts/dev/run-knowledge-ingest.ts --similarity=0.85
```

### Large files taking too long

Limit chunks for testing:

```bash
npx tsx scripts/dev/run-knowledge-ingest.ts --max-chunks=3
```

## See Also

- [Knowledge Ingest Tool](../../src/tools/knowledge/ingestTool.ts) - Core implementation
- [SUMMARIES.md](../../docs/SUMMARIES.md) - Refactor details
- [Coding Standards](../../docs/07-contributing/coding-standards.md) - Best practices

