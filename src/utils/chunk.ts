/**
 * Configuration for text chunking
 */
export interface ChunkConfig {
  /** Target chunk size in characters */
  targetSize: number;
  /** Maximum chunk size (hard limit) */
  maxSize: number;
  /** Minimum chunk size (avoid tiny chunks) */
  minSize: number;
}

/**
 * Default chunking configuration
 */
export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  targetSize: 1500,
  maxSize: 3000,
  minSize: 100,
};

/**
 * Validation error for chunking operations
 */
export class ChunkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChunkValidationError';
  }
}

/**
 * Split text into chunks at sentence boundaries
 *
 * @param text - Text to chunk
 * @param config - Chunking configuration
 * @returns Array of text chunks
 * @throws {ChunkValidationError} If text is invalid
 */
export function chunkText(
  text: string,
  config: Partial<ChunkConfig> = {}
): string[] {
  // Validate input
  if (typeof text !== 'string') {
    throw new ChunkValidationError('Text must be a string');
  }

  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return [];
  }

  // Merge with defaults
  const { targetSize, maxSize, minSize } = {
    ...DEFAULT_CHUNK_CONFIG,
    ...config,
  };

  // Validate config
  if (targetSize <= 0) {
    throw new ChunkValidationError('Target size must be positive');
  }
  if (maxSize < targetSize) {
    throw new ChunkValidationError('Max size must be >= target size');
  }
  if (minSize < 0) {
    throw new ChunkValidationError('Min size must be non-negative');
  }

  // If text is shorter than target, return as single chunk
  if (trimmedText.length <= targetSize) {
    return [trimmedText];
  }

  // Split by sentence boundaries (., !, ? followed by whitespace or end of string)
  const sentences = text.split(/(?<=[.!?])\s+|(?<=[.!?])$/);

  if (sentences.length === 0) {
    return [trimmedText];
  }

  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) {
      continue;
    }

    // If a single sentence exceeds maxSize, split it forcefully
    if (trimmedSentence.length > maxSize) {
      // Flush current chunk if it has content
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // Split long sentence at word boundaries
      const words = trimmedSentence.split(/\s+/);
      let longChunk = '';

      for (const word of words) {
        const potentialChunk = longChunk ? `${longChunk} ${word}` : word;

        if (potentialChunk.length > maxSize && longChunk) {
          chunks.push(longChunk.trim());
          longChunk = word;
        } else {
          longChunk = potentialChunk;
        }
      }

      if (longChunk.trim()) {
        chunks.push(longChunk.trim());
      }

      continue;
    }

    const potentialChunk = currentChunk
      ? `${currentChunk} ${trimmedSentence}`
      : trimmedSentence;

    // If adding this sentence would exceed target size and we have content, start a new chunk
    if (potentialChunk.length > targetSize && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = trimmedSentence;
    } else {
      currentChunk = potentialChunk;
    }
  }

  // Add the last chunk if it has content
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // Filter out chunks that are too small (unless it's the only chunk)
  const filteredChunks =
    chunks.length > 1
      ? chunks.filter((chunk) => chunk.length >= minSize)
      : chunks;

  return filteredChunks;
}

