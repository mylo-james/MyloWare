import type {
  MemorySearchParams,
  MemorySearchResult,
} from '../../types/memory.js';
import { validateSingleLine, cleanForAI } from '../../utils/validation.js';
import { embedText } from '../../utils/embedding.js';
import { MemoryRepository } from '../../db/repositories/memory-repository.js';
import { reciprocalRankFusion } from '../../utils/rrf.js';
import { applyTemporalDecay } from '../../utils/temporal.js';
import { expandMemoryGraph } from '../../utils/graphExpansion.js';
import { TEMPORAL_DECAY_FACTOR } from '../../utils/constants.js';
import { memorySearchDuration, memorySearchResults } from '../../utils/metrics.js';

/**
 * Search memories using hybrid vector + keyword retrieval
 *
 * @param params - Search parameters
 * @returns Ranked memories with relevance scores
 */
export async function searchMemories(
  params: MemorySearchParams
): Promise<MemorySearchResult> {
  const startTime = Date.now();
  const limit = params.limit ?? 10;
  const offset = params.offset ?? 0;
  const effectiveLimit = limit + offset;
  const searchMode = params.traceId ? 'trace' : 'hybrid';
  const timer = memorySearchDuration.startTimer({
    search_mode: searchMode,
    memory_type: params.memoryTypes?.[0] || 'all',
  });

  const repository = new MemoryRepository();

  // Fast path: direct metadata lookup when traceId is provided
  if (params.traceId) {
    const traceScopedMemories = await repository.findByTraceId(params.traceId, {
      persona: params.persona,
      project: params.project,
      limit,
      offset,
    });

    timer();
    memorySearchResults.observe(
      { memory_type: params.memoryTypes?.[0] || 'all' },
      traceScopedMemories.length
    );

    return {
      memories: traceScopedMemories,
      totalFound: traceScopedMemories.length,
      searchTime: Date.now() - startTime,
    };
  }

  // 1. Validate and clean query
  validateSingleLine(params.query, 'query');
  const cleanQuery = cleanForAI(params.query);

  // 2. Generate embedding
  const embedding = await embedText(cleanQuery);

  // 3. Perform searches
  const vectorResults = await repository.vectorSearch(embedding, {
    ...params,
    limit: effectiveLimit,
  });
  const keywordResults = await repository.keywordSearch(cleanQuery, {
    ...params,
    limit: effectiveLimit,
  });

  // 4. Combine with RRF
  let memories = reciprocalRankFusion([vectorResults, keywordResults]);

  // 5. Apply temporal boosting if requested (integrate into RRF scores)
  if (params.temporalBoost) {
    memories = applyTemporalDecay(memories, TEMPORAL_DECAY_FACTOR);
  }

  // 6. Expand graph if requested
  if (params.expandGraph) {
    const limitForGraph = effectiveLimit;
    const graphExpanded = await expandMemoryGraph(
      memories,
      params.maxHops || 2,
      limitForGraph * 3 // Allow more for expansion
    );
    memories = graphExpanded.slice(0, limitForGraph);
  } else {
    // 7. Limit results
    memories = memories.slice(0, effectiveLimit);
  }

  const paginated = memories.slice(offset, offset + limit);

  // 8. Update access counts
  await repository.updateAccessCount(paginated.map((m) => m.id));

  // 9. Record metrics
  timer();
  memorySearchResults.observe(
    { memory_type: params.memoryTypes?.[0] || 'all' },
    paginated.length
  );

  // 10. Return result
  return {
    memories: paginated,
    totalFound: paginated.length,
    searchTime: Date.now() - startTime,
  };
}
