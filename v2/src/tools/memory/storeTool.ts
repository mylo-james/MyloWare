import type { MemoryStoreParams, Memory } from '../../types/memory.js';
import { validateSingleLine, cleanForAI } from '../../utils/validation.js';
import { embedText } from '../../utils/embedding.js';
import { summarizeContent } from '../../utils/summarize.js';
import { detectRelatedMemories } from '../../utils/linkDetector.js';
import { MemoryRepository } from '../../db/repositories/memory-repository.js';

/**
 * Store a memory with auto-summarization and auto-linking
 *
 * @param params - Memory storage parameters
 * @returns Stored memory with ID
 */
export async function storeMemory(
  params: MemoryStoreParams
): Promise<Memory> {
  // 1. Validate and clean content
  validateSingleLine(params.content, 'content');
  const cleanContent = cleanForAI(params.content);

  // 2. Generate embedding
  const embedding = await embedText(cleanContent);

  // 3. Generate summary if not provided
  let summary: string | null = null;
  if (cleanContent.length > 100) {
    summary = await summarizeContent(cleanContent);
    validateSingleLine(summary, 'summary');
  }

  // 4. Detect related memories
  const shouldSkipLinks = process.env.NODE_ENV === 'test';
  const relatedIds = shouldSkipLinks
    ? []
    : await detectRelatedMemories(cleanContent, {
        persona: params.persona,
        project: params.project,
        limit: 5,
      });

  // 5. Merge with provided relatedTo
  const allRelatedIds = [
    ...new Set([...(params.relatedTo || []), ...relatedIds]),
  ];

  // 6. Insert into database
  const repository = new MemoryRepository();
  const memory = await repository.insert({
    content: cleanContent,
    summary,
    embedding,
    memoryType: params.memoryType,
    persona: params.persona || [],
    project: params.project || [],
    tags: params.tags || [],
    relatedTo: allRelatedIds,
    lastAccessedAt: null,
    accessCount: 0,
    metadata: params.metadata || {},
  });

  return memory;
}
