import type {
  MemorySearchParams,
  Memory,
} from '../../types/memory.js';
import { MemoryRepository } from '../../db/repositories/memory-repository.js';
import { logger } from '../../utils/logger.js';

/**
 * Knowledge retrieval parameters
 */
export interface KnowledgeGetParams {
  /** Search query */
  query: string;
  /** Calling persona (auto-scoped to relevant knowledge) */
  persona?: string;
  /** Project context (optional filter) */
  project?: string;
  /** Maximum results to return */
  limit?: number;
  /** Minimum similarity threshold (0-1) */
  minSimilarity?: number;
}

/**
 * Knowledge retrieval result
 */
export interface KnowledgeGetResult {
  /** Retrieved knowledge memories */
  knowledge: Memory[];
  /** Total number found */
  totalFound: number;
  /** Search query used */
  query: string;
}

/**
 * Get knowledge from the knowledge base
 *
 * Searches for knowledge memories relevant to the calling persona.
 * This is optimized for agent knowledge retrieval with:
 * - Persona-scoped results (returns knowledge tagged for the calling agent)
 * - Knowledge-specific filtering (only returns memories tagged as 'knowledge')
 * - Hybrid search (vector + keyword for best results)
 * - Temporal relevance (recent knowledge ranked higher)
 *
 * @param params - Knowledge retrieval parameters
 * @returns Knowledge memories with relevance scores
 *
 * @example
 * ```typescript
 * // As Veo, search for video generation knowledge
 * const result = await knowledgeGet({
 *   query: 'shotstack video generation',
 *   persona: 'veo',
 *   project: 'aismr',
 *   limit: 5
 * });
 * ```
 */
export async function knowledgeGet(
  params: KnowledgeGetParams
): Promise<KnowledgeGetResult> {
  const {
    query,
    persona,
    project,
    limit = 10,
    minSimilarity = 0.75,
  } = params;

  // Validate inputs
  if (!query || query.trim().length === 0) {
    throw new Error('Query must be a non-empty string');
  }

  if (limit < 1 || limit > 100) {
    throw new Error('Limit must be between 1 and 100');
  }

  logger.debug(
    {
      query,
      persona,
      project,
      limit,
      minSimilarity,
    },
    'knowledge_get: searching for knowledge'
  );

  const repository = new MemoryRepository();

  // Build search params with knowledge-specific filters
  const searchParams: MemorySearchParams = {
    query,
    limit,
    minSimilarity,
    // Filter to knowledge-tagged memories only
    tags: ['knowledge'],
    // Scope to calling persona if provided
    persona,
    // Optional project filter
    project,
    // Boost recent knowledge
    temporalBoost: true,
  };

  // Search using hybrid retrieval
  const memories = await repository.search(searchParams);

  logger.info(
    {
      query,
      persona,
      project,
      resultsFound: memories.length,
    },
    'knowledge_get: search complete'
  );

  return {
    knowledge: memories,
    totalFound: memories.length,
    query,
  };
}

