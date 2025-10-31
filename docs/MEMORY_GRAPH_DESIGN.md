# Memory Graph Schema & Link Strategy

**Date:** October 30, 2025  
**Author:** MCP Prompts Team  
**Status:** Draft – delivers Phase 2 · Step 2.3.1 of the modernization plan

---

## Objectives

- Introduce a lightweight graph layer that captures relationships between stored prompt embeddings without disrupting existing query paths.
- Support downstream traversal algorithms (multi-hop retrieval, context stitching) that depend on explicit links instead of repeated similarity searches.
- Keep write amplification minimal so ingestion remains cost-effective even as the graph density grows.

---

## Conceptual Model

```
┌─────────────────────┐        ┌───────────────────────┐
│   prompt_embeddings │        │     memory_links      │
│  (existing chunks)  │◄──────►│  (edge definitions)   │
├─────────────────────┤        ├───────────────────────┤
│ chunk_id (PK)       │   FK   │ id (uuid PK)          │
│ memory_type         │        │ source_chunk_id (text)│
│ embedding (vector)  │        │ target_chunk_id (text)│
│ metadata (jsonb)    │        │ link_type (text)      │
│ updated_at          │        │ strength (double)     │
└─────────────────────┘        │ created_at            │
                               │ metadata (jsonb)      │
                               └───────────────────────┘
```

- **Nodes** reuse `prompt_embeddings` rows, ensuring the graph stays consistent with our RAG chunks.
- **Edges** live in `memory_links`, describing semantic or procedural relationships between two chunks.
- Strongly consider bidirectional link creation for symmetric relationships (`similar`, `related`), while directional (`prerequisite`, `followup`) remain single edges.

---

## Edge Semantics

| Link Type      | Direction     | Typical Source → Target                                                   | Strength Guidance |
| -------------- | ------------- | ------------------------------------------------------------------------- | ----------------- |
| `similar`      | Bidirectional | Chunks covering nearly identical content (cosine ≥ 0.80).                 | 0.8 – 1.0         |
| `related`      | Bidirectional | Conceptually associated content (cosine 0.55 – 0.79).                     | 0.55 – 0.79       |
| `prerequisite` | Directional   | Foundational content required before target chunk (workflow steps, docs). | 0.6 – 0.9         |
| `followup`     | Directional   | Next-step or deeper dive material (how-to guides → troubleshooting).      | 0.4 – 0.8         |
| `contrasts`    | Bidirectional | Deliberately different approaches we want to surface for comparison.      | 0.3 – 0.6         |

- Strength is stored as a float (`double precision`) in range `[0, 1]` to allow rescoring without recomputing embeddings.
- Additional metadata (e.g., `{"source":"auto","algorithm":"rrf-topk"}`) provides auditing for link provenance.

---

## Database Changes (`0005_add_memory_graph.sql`)

1. **Create table:** `memory_links` with columns
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `source_chunk_id text NOT NULL REFERENCES prompt_embeddings(chunk_id) ON DELETE CASCADE`
   - `target_chunk_id text NOT NULL REFERENCES prompt_embeddings(chunk_id) ON DELETE CASCADE`
   - `link_type text NOT NULL CHECK (char_length(link_type) > 0)`
   - `strength double precision NOT NULL CHECK (strength >= 0 AND strength <= 1)`
   - `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`
   - `created_at timestamptz NOT NULL DEFAULT now()`
2. **Indices**
   - `CREATE INDEX idx_memory_links_source ON memory_links(source_chunk_id);`
   - `CREATE INDEX idx_memory_links_target ON memory_links(target_chunk_id);`
   - `CREATE INDEX idx_memory_links_type ON memory_links(link_type);`
3. **Uniqueness constraint**
   - `UNIQUE (source_chunk_id, target_chunk_id, link_type)` prevents duplicate edges.
4. **Optional** partial index for frequently accessed link types once usage is measured.

Rollback simply drops `memory_links` (and implicitly indices) after removing dependent foreign keys.

---

## Query Patterns

1. **Neighborhood expansion**

   ```sql
   SELECT target_chunk_id, strength, metadata
   FROM memory_links
   WHERE source_chunk_id = $1
   ORDER BY strength DESC
   LIMIT 20;
   ```

   Used by hybrid search to stitch adjacent chunks.

2. **Reverse lookup**
   Fetch edges pointing to a chunk to understand upstream dependencies:

   ```sql
   SELECT source_chunk_id, link_type, strength
   FROM memory_links
   WHERE target_chunk_id = $1;
   ```

3. **Bidirectional dedupe**
   Treat `(source, target)` pairs as undirected when link_type indicates symmetry.

---

## Generation Strategy

1. **Auto-similarity batch job**
   - Run nightly over recent chunks.
   - Use cosine similarity search (top-50 per chunk).
   - Create `similar` or `related` links based on thresholds.
   - Store algorithm metadata (`{"method":"batch-similarity","window":"7d"}`).

2. **On-ingest hook**
   - For new embeddings, perform a quick top-k search (k=10) and create provisional links.
   - Skip if strength below configured floor to avoid noisy graph.

3. **Manual links (future)**
   - Allow curators to create `prerequisite`/`followup` edges when knowledge architecture demands order.
   - Provide CLI / admin interface writing via `linkRepository`.

- All write paths should upsert (insert on conflict update strength/metadata) to support iterative improvements.

---

## Operations & Maintenance

- **Retention:** Edges cascade-delete when either node disappears; no additional cleanup required.
- **Monitoring:** Track link counts by type + average degree to ensure growth remains manageable.
- **Validation:** Scheduled job checks for orphaned edges, duplicate inverses with mismatched metadata, and ensures strength stays in `[0, 1]`.

---

## Implementation Checklist

- [ ] Implement `memory_links` migration (this step).
- [ ] Update Drizzle schema + repository primitives (Step 2.3.2).
- [ ] Build link detector service for automatic generation (Step 2.3.2).
- [ ] Expose graph traversal utilities (Step 2.3.3).
- [ ] Add monitoring for link density (Step 3.3.4).

---

## Open Questions

- Do we need soft-deletion semantics for curator-created links?
- Should directional link types enforce transitive closure (e.g., propagate `prerequisite` chains)?
- How aggressively do we cap out-degree to avoid noisy expansions (hard limit vs. percentile-based pruning)?

---

## References

- `docs/MEMORY_ARCHITECTURE.md` – overarching component taxonomy.
- `src/vector/hybridSearch.ts` – current fusion logic that will consume graph traversal output.
- `src/db/repository.ts` – vector similarity implementation leveraged for seed retrieval.
