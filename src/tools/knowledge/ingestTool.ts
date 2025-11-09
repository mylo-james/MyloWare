import type {
  KnowledgeIngestParams,
  KnowledgeIngestResult,
  ClassificationCandidates,
  ProcessedChunk,
  DeduplicationResult,
  ChunkProcessingResult,
  FetchedContent,
  ChunkProcessingOptions,
} from '../../types/knowledge.js';
import { chunkText } from '../../utils/chunk.js';
import { summarizeContent } from '../../utils/summarize.js';
import { embedText } from '../../utils/embedding.js';
import { detectRelatedMemories } from '../../utils/linkDetector.js';
import { MemoryRepository } from '../../db/repositories/memory-repository.js';
import { PersonaRepository } from '../../db/repositories/persona-repository.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { storeMemory } from '../memory/storeTool.js';
import { classifyTargets } from '../../utils/classify.js';
import { fetchWebPage } from '../../utils/web-fetch.js';
import { logger } from '../../utils/logger.js';

/**
 * Knowledge ingestion error
 */
export class KnowledgeIngestError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'KnowledgeIngestError';
  }
}

/**
 * Fetch content from URLs
 *
 * @param urls - URLs to fetch
 * @returns Array of fetched content
 */
async function fetchContentFromUrls(
  urls: string[]
): Promise<FetchedContent[]> {
  const results: FetchedContent[] = [];

  for (const url of urls) {
    try {
      const fetched = await fetchWebPage(url);
      results.push({
        text: fetched.text,
        url,
        metadata: fetched.metadata,
      });

      logger.info({ url, textLength: fetched.text.length }, 'Fetched URL content');
    } catch (error) {
      logger.warn(
        {
          url,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to fetch URL, skipping'
      );
      // Continue with other URLs
    }
  }

  return results;
}

/**
 * Collect all text content to process
 *
 * @param params - Ingestion parameters
 * @returns Combined text and source URLs
 */
async function collectContent(params: KnowledgeIngestParams): Promise<{
  text: string;
  sourceUrls: string[];
}> {
  const texts: string[] = [];
  const sourceUrls: string[] = [];

  // Fetch URLs if provided
  if (params.urls && params.urls.length > 0) {
    const fetchedContent = await fetchContentFromUrls(params.urls);

    for (const content of fetchedContent) {
      texts.push(content.text);
      sourceUrls.push(content.url);
    }
  }

  // Add direct text if provided
  if (params.text) {
    texts.push(params.text);
  }

  return {
    text: texts.join('\n\n'),
    sourceUrls,
  };
}

/**
 * Load classification candidates from database
 *
 * @returns Available personas and projects
 */
async function loadCandidates(): Promise<ClassificationCandidates> {
  const personaRepo = new PersonaRepository();
  const projectRepo = new ProjectRepository();

  const [personaNames, projectNames] = await Promise.all([
    personaRepo.listAllNames(),
    projectRepo.listAllNames(),
  ]);

  return {
    personas: personaNames,
    projects: projectNames,
  };
  }

/**
 * Process a single chunk: summarize, classify, and embed
 *
 * @param chunk - Text chunk to process
 * @param candidates - Classification candidates
 * @param bias - Optional classification bias
 * @returns Processed chunk ready for storage
 */
async function processChunk(
  chunk: string,
  candidates: ClassificationCandidates,
  bias?: { persona?: string[]; project?: string[] }
): Promise<ProcessedChunk> {
      // Summarize to single line
      const summary = await summarizeContent(chunk);

      // Classify
      const classification = await classifyTargets(chunk, candidates);

      // Merge bias with classification
  const personas = [
    ...new Set([...(bias?.persona || []), ...(classification.personas || [])]),
      ];
  const projects = [
    ...new Set([...(bias?.project || []), ...(classification.projects || [])]),
      ];

  // Generate embedding
      const embedding = await embedText(summary);

  return {
    summary,
    classification,
    personas,
    projects,
    embedding,
  };
}

/**
 * Check for duplicate memories
 *
 * @param embedding - Embedding vector to search
 * @param summary - Summary text for search
 * @param minSimilarity - Minimum similarity threshold
 * @returns Deduplication result
 */
async function checkDuplicate(
  embedding: number[],
  summary: string,
  minSimilarity: number
): Promise<DeduplicationResult> {
  const repository = new MemoryRepository();

      const duplicates = await repository.vectorSearch(embedding, {
    query: summary,
        limit: 3,
        minSimilarity,
      });

  if (duplicates.length > 0) {
    return {
      isDuplicate: true,
      existingMemoryId: duplicates[0].id,
      similarityScore: duplicates[0].relevanceScore,
    };
  }

  return {
    isDuplicate: false,
  };
}

/**
 * Update an existing memory with new information
 *
 * @param memoryId - ID of memory to update
 * @param processed - Processed chunk data
 * @param traceId - Optional trace ID
 * @param sourceUrls - Optional source URLs
 * @returns Update result
 */
async function updateExistingMemory(
  memoryId: string,
  processed: ProcessedChunk,
  traceId?: string,
  sourceUrls?: string[]
): Promise<ChunkProcessingResult> {
  const repository = new MemoryRepository();

  // Verify memory still exists
  const existing = await repository.findById(memoryId);
  if (!existing) {
    logger.warn(
      { memoryId },
      'Duplicate memory no longer exists, will insert instead'
    );
    return {
      inserted: false,
      updated: false,
      skipped: false,
    };
  }

        // Merge persona and project arrays
  const mergedPersonas = Array.from(
    new Set([...(existing.persona || []), ...processed.personas])
        );
  const mergedProjects = Array.from(
    new Set([...(existing.project || []), ...processed.projects])
        );

        // Update metadata
        const updatedMetadata = {
          ...(existing.metadata || {}),
          updatedBy: 'knowledge_ingest',
    updatedAt: new Date().toISOString(),
    ...(traceId ? { traceId } : {}),
          sourceType: 'ingest',
          classifiedBy: 'gpt-4o-mini',
    ...(sourceUrls && sourceUrls.length > 0 ? { sourceUrl: sourceUrls[0] } : {}),
        };

          try {
    await repository.update(memoryId, {
      persona: mergedPersonas,
      project: mergedProjects,
              metadata: updatedMetadata,
            });

    logger.debug({ memoryId }, 'Updated existing memory');

    return {
      inserted: false,
      updated: true,
      skipped: false,
      memoryId,
    };
          } catch (error) {
            logger.warn(
              {
        memoryId,
                error: error instanceof Error ? error.message : String(error),
              },
      'Failed to update memory'
    );

    return {
      inserted: false,
      updated: false,
      skipped: false,
    };
  }
}

/**
 * Insert a new memory
 *
 * @param processed - Processed chunk data
 * @param traceId - Optional trace ID
 * @param sourceUrls - Optional source URLs
 * @returns Insert result
 */
async function insertNewMemory(
  processed: ProcessedChunk,
  traceId?: string,
  sourceUrls?: string[]
): Promise<ChunkProcessingResult> {
  try {
    // Detect related memories
    const relatedTo = await detectRelatedMemories(processed.summary, {
      persona:
        processed.personas.length > 0 ? processed.personas : undefined,
      project:
        processed.projects.length > 0 ? processed.projects : undefined,
          limit: 5,
        });

    // Build metadata
    const metadata = {
          sourceType: 'ingest',
          classifiedBy: 'gpt-4o-mini',
      createdAt: new Date().toISOString(),
      ...(traceId ? { traceId } : {}),
      ...(sourceUrls && sourceUrls.length > 0 ? { sourceUrl: sourceUrls[0] } : {}),
        };

    // Store memory
    const stored = await storeMemory({
      content: processed.summary,
      memoryType: processed.classification.memoryType,
      persona: processed.personas,
      project: processed.projects,
            tags: ['knowledge', 'ingest'],
            relatedTo,
      metadata,
    });

    logger.debug(
      { memoryId: stored.id },
      'Inserted new memory'
    );

    return {
      inserted: true,
      updated: false,
      skipped: false,
      memoryId: stored.id,
    };
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to insert memory'
    );

    return {
      inserted: false,
      updated: false,
      skipped: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Process a single chunk: deduplicate and store
 *
 * @param processed - Processed chunk data
 * @param options - Processing options
 * @returns Processing result
 */
async function storeOrUpdateChunk(
  processed: ProcessedChunk,
  options: ChunkProcessingOptions
): Promise<ChunkProcessingResult> {
  const { traceId, minSimilarity, sourceUrls } = options;

  // Check for duplicates
  const duplication = await checkDuplicate(
    processed.embedding,
    processed.summary,
    minSimilarity
  );

  logger.debug(
    {
      traceId,
      isDuplicate: duplication.isDuplicate,
      existingMemoryId: duplication.existingMemoryId,
      similarityScore: duplication.similarityScore,
    },
    'Deduplication check complete'
  );

  // If duplicate found, update existing memory
  if (duplication.isDuplicate && duplication.existingMemoryId) {
    const updateResult = await updateExistingMemory(
      duplication.existingMemoryId,
      processed,
      traceId,
      sourceUrls
    );

    // If update failed or memory doesn't exist, insert new
    if (!updateResult.updated) {
      return insertNewMemory(processed, traceId, sourceUrls);
    }

    return updateResult;
  }

  // No duplicate found, insert new memory
  return insertNewMemory(processed, traceId, sourceUrls);
}

/**
 * Process chunks in batches
 *
 * @param chunks - Text chunks to process
 * @param options - Processing options
 * @returns Ingestion result with statistics
 */
async function processChunks(
  chunks: string[],
  options: ChunkProcessingOptions
): Promise<KnowledgeIngestResult> {
  const { traceId, candidates, bias } = options;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const totalChunks = chunks.length;

  logger.info(
    {
      traceId,
      totalChunks,
    },
    'Starting chunk processing'
  );

  for (const [index, chunk] of chunks.entries()) {
    try {
      // Process chunk (summarize, classify, embed)
      const processed = await processChunk(chunk, candidates, bias);

      // Store or update
      const result = await storeOrUpdateChunk(processed, options);

      if (result.inserted) {
          inserted++;
      } else if (result.updated) {
        updated++;
      } else if (result.skipped) {
          skipped++;
        }

      // Log progress
      const processedCount = index + 1;
      if (processedCount % 5 === 0 || processedCount === totalChunks) {
        logger.info(
          {
            traceId,
            processed: processedCount,
            totalChunks,
            inserted,
            updated,
            skipped,
          },
          'Processing progress'
        );
      }
    } catch (error) {
      logger.warn(
        {
          traceId,
          chunkIndex: index,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to process chunk'
      );
      skipped++;
    }
  }

  return {
    inserted,
    updated,
    skipped,
    totalChunks,
  };
}

/**
 * Chunk, classify, dedupe and upsert knowledge into memory
 *
 * This is the main entry point for knowledge ingestion. It:
 * 1. Fetches content from URLs (if provided)
 * 2. Chunks the text into manageable pieces
 * 3. Classifies each chunk (persona, project, memory type)
 * 4. Deduplicates against existing memories
 * 5. Stores new memories or updates existing ones
 *
 * @param params - Ingestion parameters
 * @returns Statistics about inserted, updated, and skipped memories
 * @throws {KnowledgeIngestError} If ingestion fails
 */
export async function knowledgeIngest(
  params: KnowledgeIngestParams
): Promise<KnowledgeIngestResult> {
  try {
    // Validate params
    if (!params.text && (!params.urls || params.urls.length === 0)) {
      return {
        inserted: 0,
        updated: 0,
        skipped: 0,
        totalChunks: 0,
      };
    }

    logger.info(
      {
        traceId: params.traceId,
        hasUrls: Boolean(params.urls?.length),
        hasText: Boolean(params.text),
      },
      'Starting knowledge ingestion'
    );

    // Load candidates
    const candidates = await loadCandidates();

    // Collect content
    const { text, sourceUrls } = await collectContent(params);

    if (!text || text.trim().length === 0) {
      logger.info(
        { traceId: params.traceId },
        'No content to process after collection'
      );
      return {
        inserted: 0,
        updated: 0,
        skipped: 0,
        totalChunks: 0,
      };
    }

    // Chunk text
    const allChunks = chunkText(text, {
      targetSize: params.chunkSize,
    });

    // Limit chunks if requested
    const chunks =
      typeof params.maxChunks === 'number' && params.maxChunks > 0
        ? allChunks.slice(0, params.maxChunks)
        : allChunks;

    if (chunks.length === 0) {
      logger.info(
        {
          traceId: params.traceId,
          textLength: text.length,
        },
        'No chunks generated from input text'
      );
      return {
        inserted: 0,
        updated: 0,
        skipped: 0,
        totalChunks: 0,
      };
    }

    // Process chunks
    const result = await processChunks(chunks, {
      traceId: params.traceId,
      candidates,
      bias: params.bias,
      minSimilarity: params.minSimilarity ?? 0.92,
      sourceUrls,
    });

  logger.info(
    {
      traceId: params.traceId,
        ...result,
    },
      'Knowledge ingestion complete'
  );

    return result;
  } catch (error) {
    logger.error(
      {
        traceId: params.traceId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Knowledge ingestion failed'
    );

    throw new KnowledgeIngestError(
      'Failed to ingest knowledge',
      error instanceof Error ? error : undefined
    );
}
}
