/**
 * Knowledge ingestion types
 *
 * Defines interfaces for the knowledge base upserter system
 */

import type { MemoryType } from './memory.js';

/**
 * Parameters for knowledge ingestion
 */
export interface KnowledgeIngestParams {
  /** Optional trace ID for tracking */
  traceId?: string;
  /** URLs to fetch and ingest */
  urls?: string[];
  /** Direct text to ingest */
  text?: string;
  /** Bias classification toward specific personas/projects */
  bias?: {
    persona?: string[];
    project?: string[];
  };
  /** Minimum similarity threshold for deduplication (0-1) */
  minSimilarity?: number;
  /** Maximum number of chunks to process (for testing/limits) */
  maxChunks?: number;
  /** Target size for text chunks in characters */
  chunkSize?: number;
}

/**
 * Result of knowledge ingestion operation
 */
export interface KnowledgeIngestResult {
  /** Number of new memories inserted */
  inserted: number;
  /** Number of existing memories updated */
  updated: number;
  /** Number of chunks skipped (errors or other reasons) */
  skipped: number;
  /** Total chunks processed */
  totalChunks: number;
}

/**
 * Classification result from LLM
 */
export interface ClassificationResult {
  /** Personas this knowledge applies to */
  personas: string[];
  /** Projects this knowledge relates to */
  projects: string[];
  /** Type of memory (semantic, procedural, episodic) */
  memoryType: MemoryType;
}

/**
 * Available candidates for classification
 */
export interface ClassificationCandidates {
  /** Available persona names */
  personas: string[];
  /** Available project names */
  projects: string[];
}

/**
 * Processed chunk ready for storage
 */
export interface ProcessedChunk {
  /** Summarized content (single-line) */
  summary: string;
  /** Classification results */
  classification: ClassificationResult;
  /** Merged personas (classification + bias) */
  personas: string[];
  /** Merged projects (classification + bias) */
  projects: string[];
  /** Generated embedding vector */
  embedding: number[];
}

/**
 * Deduplication result
 */
export interface DeduplicationResult {
  /** Whether a duplicate was found */
  isDuplicate: boolean;
  /** Existing memory ID if duplicate found */
  existingMemoryId?: string;
  /** Similarity score if duplicate found */
  similarityScore?: number;
}

/**
 * Chunk processing result
 */
export interface ChunkProcessingResult {
  /** Whether the chunk was inserted */
  inserted: boolean;
  /** Whether an existing memory was updated */
  updated: boolean;
  /** Whether the chunk was skipped */
  skipped: boolean;
  /** Memory ID if created or updated */
  memoryId?: string;
  /** Error message if processing failed */
  error?: string;
}

/**
 * Text fetching result
 */
export interface FetchedContent {
  /** Fetched text content */
  text: string;
  /** Source URL */
  url: string;
  /** Optional metadata from fetch */
  metadata?: Record<string, unknown>;
}

/**
 * Options for chunk processing
 */
export interface ChunkProcessingOptions {
  /** Trace ID for tracking */
  traceId?: string;
  /** Classification candidates */
  candidates: ClassificationCandidates;
  /** Bias for classification */
  bias?: {
    persona?: string[];
    project?: string[];
  };
  /** Minimum similarity for deduplication */
  minSimilarity: number;
  /** Source URLs for metadata */
  sourceUrls?: string[];
}

export type {
  KnowledgeIngestParams,
  KnowledgeIngestResult,
  ClassificationResult,
  ClassificationCandidates,
  ProcessedChunk,
  DeduplicationResult,
  ChunkProcessingResult,
  FetchedContent,
  ChunkProcessingOptions,
};

