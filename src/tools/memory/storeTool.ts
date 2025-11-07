import type { MemoryStoreParams, Memory } from '../../types/memory.js';
import { validateSingleLine, cleanForAI } from '../../utils/validation.js';
import { embedText } from '../../utils/embedding.js';
import { summarizeContent } from '../../utils/summarize.js';
import { detectRelatedMemories } from '../../utils/linkDetector.js';
import { MemoryRepository } from '../../db/repositories/memory-repository.js';

/**
 * Validates that a string is a valid UUID
 */
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Filters an array to only include valid UUIDs
 */
function filterValidUUIDs(ids: string[]): string[] {
  return ids.filter((id) => isValidUUID(id));
}

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

  // 5. Merge with provided relatedTo and filter to only valid UUIDs
  // The database schema expects relatedTo to be an array of UUIDs (memory IDs)
  const allRelatedIds = filterValidUUIDs([
    ...new Set([...(params.relatedTo || []), ...relatedIds]),
  ]);

  // 6. Insert into database
  const repository = new MemoryRepository();
  const metadata = {
    ...(params.metadata || {}),
    ...(params.traceId ? { traceId: params.traceId } : {}),
    ...(params.runId ? { runId: params.runId } : {}),
    ...(params.handoffId ? { handoffId: params.handoffId } : {}),
  };
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
    metadata,
  });

  return memory;
}
