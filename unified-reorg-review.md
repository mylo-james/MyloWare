# Unified Repository Reorg Review

## Summary of Chosen Patterns

- **Directory Layout (1C):** Adopt Composer’s `src/domain/*` migration path so existing build tooling targeting `src/server.ts` keeps working while we peel behaviors into domain modules incrementally.
- **Infrastructure Placement (2C):** Keep shared adapters inside `src/infrastructure/*`, allowing gradual extraction without introducing a packages workspace yet.
- **Documentation Plan (3C):** Establish `docs/index.md` plus `docs/domains/*` as the immediate navigation layer, then iterate toward richer handbooks once the new structure settles.
- **Naming Strategy (4C):** Preserve exported tool-aligned names (`storeMemory`, `searchMemories`, etc.) while adding semantic aliases inside the domain modules for future renaming campaigns.

## Alignment With Source Proposals

| Decision | Anchoring Proposal | Notes |
| --- | --- | --- |
| Directory layout | Composer’s behavior-centric tree | Mirrors the `src/domain/` structure in `reorg-composer.md` while staying compatible with current `tsconfig` and scripts.
| Infrastructure | Composer’s `src/infrastructure/` tier | Retains the impure boundary alongside domains without the overhead of new package builds.
| Documentation | Composer’s lightweight docs index | Prioritizes navigability and minimizes rewrite blast radius before merging content into handbooks.
| Naming | Hybrid of tool parity + semantic aliases | Avoids breaking MCP tool contracts while still encouraging intent-driven naming inside domain code.

Key excerpts that shaped these choices:

```68:206:/Users/mjames/Code/mcp-prompts/reorg-composer.md
├── src/
│   ├── domain/                        # Domain behaviors (pure functions)
│   ├── infrastructure/                # Technical infrastructure (impure)
│   ├── protocol/                      # MCP protocol layer
│   ├── api/                            # HTTP API endpoints
│   └── server.ts
```

```70:85:/Users/mjames/Code/mcp-prompts/reorg-composer.md
├── docs/
│   ├── index.md                       # Documentation index (behavioral map)
│   ├── domains/                       # Domain-specific guides
│   ├── architecture/                  # System design docs
│   └── guides/                        # How-to guides
```

```21:31:/Users/mjames/Code/mcp-prompts/reorg-composer.md
- `remember()` not `storeMemory()`
- `coordinate()` not `handoffToAgent()`
- `discover()` not `searchMemories()`
```

```29:83:/Users/mjames/Code/mcp-prompts/src/tools/memory/storeTool.ts
export async function storeMemory(
  params: MemoryStoreParams
): Promise<Memory> {
  // 1. Validate and clean content
  ...
  return memory;
}
```

These snippets underscore the compatibility benefits of Composer’s layout and the need to safeguard existing tool entry points while we introduce more semantic aliases internally.

## Implementation Roadmap

1. **Bootstrap Domain Skeleton (Week 0-1)**
   - Create `src/domain/{trace,memory,workflow,persona}/index.ts` exporting the current tool functions.
   - Add placeholder README files documenting purpose and planned pure operations.
   - Wire `src/tools/*` to import from `src/domain/*` once modules land.

2. **Migrate Core Behaviors (Week 1-3)**
   - Move pure logic from `src/utils/*` (`embedding`, `linkDetector`, `trace-prep`, etc.) into corresponding domain operations.
   - Keep side effects (DB, OpenAI, n8n) under `src/infrastructure/*`, injecting them into domain functions via lightweight adapters.
   - Maintain legacy exports (`storeMemory`, `searchMemories`) while introducing semantic aliases (`remember`, `discover`) inside each domain index.

3. **Documentation Refresh (Week 2-4)**
   - Author `docs/index.md` as the navigation hub and stand up `docs/domains/memory.md`, `docs/domains/trace.md`, etc., summarizing current behavior and planned deltas.
   - Stage legacy review files under `docs/archive/` but cross-link key insights into the new domain guides.
   - Defer TOC automation and handbook conversion until after the new folder structure stabilizes.

4. **Progressive Renaming & Cleanup (Week 4+)**
   - Swap internal callers to use semantic aliases (`remember`, `coordinate`) once domain modules are stable.
   - Update tests to mirror the domain structure (`tests/domain/*`, `tests/integration/*`).
   - Revisit tool names and external contracts after telemetry confirms the migration is safe.

## Risk Assessment & Mitigations

- **Build/CI Disruption:** Limiting early changes to subdirectories beneath `src/` ensures existing `npm run dev` and `npm run build` flows remain intact. Validate by running `npm run lint` and containerized unit tests after each domain move.
- **Documentation Drift:** Introduce a standing checklist tying every domain refactor PR to a `docs/domains/*` update so humans and agents stay aligned. Maintain the review archives until domain docs reach parity.
- **Naming Inconsistency:** Track alias adoption via ESLint rules (e.g., flag direct `storeMemory` imports outside protocol layers once `remember` becomes canonical) to prevent half-migrated call sites.
- **Scope Creep:** Sequence work behavior-by-behavior, measuring completion by migrating both code and tests before touching the next domain.

## Next Steps

- Draft the initial `src/domain` scaffolding with re-exported current tools.
- Carve out a pilot migration (e.g., memory domain) to validate dependency injection patterns and doc workflow.
- Schedule a documentation working session to seed `docs/index.md` and the first domain guide using insights from existing review files.


