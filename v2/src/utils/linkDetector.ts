import { embedText } from './embedding.js';
import { MemoryRepository } from '../db/repositories/memory-repository.js';

export async function detectRelatedMemories(
  content: string,
  options: {
    persona?: string[];
    project?: string[];
    limit?: number;
    minSimilarity?: number;
  }
): Promise<string[]> {
  const repository = new MemoryRepository();

  // Generate embedding for new content
  const embedding = await embedText(content);

  // Search for similar memories
  const similar = await repository.vectorSearch(embedding, {
    query: content,
    persona: options.persona?.[0],
    project: options.project?.[0],
    limit: options.limit || 5,
  });

  // Return IDs of related memories
  return similar.map((m) => m.id);
}

