# ADR 0009: Knowledge Base Architecture

**Status**: Proposed  
**Date**: 2024-12-06  
**Context**: Epic 5 - Knowledge Base & RAG Optimization

## Context

MyloWare agents need domain knowledge to produce quality content. The current RAG implementation has:

- Llama Stack Vector I/O with `file_search` tool
- Static chunking (512 tokens, 50 token overlap)
- Flat directory structure (`data/knowledge/*.md`)
- No retrieval logging or metrics
- No distinction between global and project-specific knowledge

Production runs reveal quality issues from knowledge gaps:
- Generic object ideas (Ideator lacks variety guidance)
- Poor video framing (Producer lacks Veo3 prompting expertise)
- Inconsistent outputs (no niche-specific context)

## Decision

### 1. Two-Tier Knowledge Architecture

```
data/
├── knowledge/                    # GLOBAL KB (all projects)
│   ├── video-generation/
│   │   ├── veo3-prompting-guide.md
│   │   ├── veo3-pitfalls.md
│   │   └── unique-object-generation.md
│   ├── composition/
│   │   └── vertical-video-framing.md
│   ├── trends/
│   │   ├── viral-patterns.md
│   │   └── hook-strategies.md
│   ├── platform/
│   │   ├── tiktok-specs.md
│   │   └── tiktok-algorithm.md
│   └── ... (see knowledge-base-plan.md)
│
└── projects/
    └── {project}/
        └── knowledge/            # PROJECT KB (project-specific)
            ├── project-brief.md
            ├── niche-guide.md
            ├── brand-voice.md
            └── editing-style.md
```

### 2. Enhanced Chunking Strategy

**Current**: 512 tokens, 50 token overlap (9.7%)

**New**: 512 tokens, 100 token overlap (19.5%)

Rationale: 20% overlap prevents context splitting at chunk boundaries.

### 3. Document Metadata Enhancement

Each chunk stores:
```python
{
    "document": "veo3-prompting-guide.md",
    "section": "## Camera Movement",       # Parent heading
    "category": "video-generation",        # Directory path
    "kb_type": "global",                   # or "project:{project_id}"
}
```

### 4. Retrieval Logging

Every RAG query logged:
```python
logger.info(
    "rag_query",
    query=query,
    vector_store_id=store_id,
    retrieved_count=len(results),
    top_scores=[r.score for r in results[:5]],
    top_documents=[r.metadata["document"] for r in results[:5]],
)
```

### 5. Multi-Store Strategy

```
┌─────────────────────────────────────────────────────┐
│                     Agent Query                      │
└─────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────┐
│              file_search tool call                   │
│         vector_store_ids: [global, project]          │
└─────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                                 ▼
┌──────────────────┐              ┌──────────────────┐
│  Global KB Store │              │ Project KB Store │
│  (shared across  │              │ (project-specific│
│   all projects)  │              │   knowledge)     │
└──────────────────┘              └──────────────────┘
```

## Implementation

### Phase 1: Infrastructure (Story 5.1)

1. Update `knowledge/loader.py`:
   - Support nested directory structure
   - Extract section headings for metadata
   - Return category from path

2. Update `knowledge/setup.py`:
   - Increase chunk overlap to 100 tokens
   - Store enhanced metadata with chunks
   - Add retrieval logging

3. Add validation script (`scripts/validate_kb.py`)

### Phase 2: Content (Stories 5.2-5.4)

1. Create directory structure
2. Write documents following RAG-optimized format
3. Ingest into appropriate vector stores

### Phase 3: Validation (Story 5.5)

1. Define test query suite
2. Measure hit rate (target: >90%)
3. Identify and fill gaps

## Consequences

### Positive

- Agents get relevant, complete context
- Global knowledge shared efficiently
- Project knowledge isolated appropriately
- Retrieval issues debuggable via logs
- Quality improvements measurable

### Negative

- More documents to maintain
- Two vector stores per project (complexity)
- Initial ingestion takes longer

### Risks

- Chunking changes could degrade existing retrieval (mitigated by baseline metrics)
- Document quality varies (mitigated by writing standards)

## Alternatives Considered

### 1. Single Vector Store for Everything

Rejected: Project knowledge would pollute other projects' retrieval.

### 2. Hybrid Search (Vector + BM25)

Deferred: Added complexity without proven need. Can add later if vector-only insufficient.

### 3. Reranking with Cross-Encoder

Deferred: Adds latency and cost. Only needed if top-k retrieval quality insufficient.

## References

- `docs/knowledge-base-plan.md` - Document structure and agent needs
- `docs/rag-optimization.md` - RAG techniques research
- `docs/epics/epic-5-knowledge-base-rag.md` - Epic definition

