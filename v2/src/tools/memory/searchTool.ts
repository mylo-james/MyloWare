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
  const timer = memorySearchDuration.startTimer({ 
    search_mode: 'hybrid', 
    memory_type: params.memoryTypes?.[0] || 'all' 
  });

  // 1. Validate and clean query
  validateSingleLine(params.query, 'query');
  const cleanQuery = cleanForAI(params.query);

  // 2. Generate embedding
  const embedding = await embedText(cleanQuery);

  // 3. Perform searches
  const repository = new MemoryRepository();

  const vectorResults = await repository.vectorSearch(embedding, params);
  const keywordResults = await repository.keywordSearch(cleanQuery, params);

  // 4. Combine with RRF
  let memories = reciprocalRankFusion([vectorResults, keywordResults]);

  // 5. Apply temporal boosting if requested (integrate into RRF scores)
  if (params.temporalBoost) {
    memories = applyTemporalDecay(memories, 0.1);
  }

  // 6. Expand graph if requested
  if (params.expandGraph) {
    const limit = params.limit || 10;
    const graphExpanded = await expandMemoryGraph(
      memories,
      params.maxHops || 2,
      limit * 3 // Allow more for expansion
    );
    memories = graphExpanded.slice(0, limit);
  } else {
    // 7. Limit results
    const limit = params.limit || 10;
    memories = memories.slice(0, limit);
  }

  // 8. Update access counts
  await repository.updateAccessCount(memories.map((m) => m.id));

  // 9. Record metrics
  timer();
  memorySearchResults.observe(
    { memory_type: params.memoryTypes?.[0] || 'all' },
    memories.length
  );

  // 10. Return result
  return {
    memories,
    totalFound: memories.length,
    searchTime: Date.now() - startTime,
  };
}

