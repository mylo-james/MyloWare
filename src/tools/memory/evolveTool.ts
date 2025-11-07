import type { MemoryEvolveParams, MemoryEvolveResult } from '../../types/memory.js';
import { validateSingleLine } from '../../utils/validation.js';
import { MemoryRepository } from '../../db/repositories/memory-repository.js';

/**
 * Evolve a memory by adding tags, links, or updating summary
 *
 * @param params - Evolution parameters
 * @returns Updated memory with changes list
 */
export async function evolveMemory(
  params: MemoryEvolveParams
): Promise<MemoryEvolveResult> {
  const repository = new MemoryRepository();
  const changes: string[] = [];

  // 1. Fetch existing memory
  const memory = await repository.findById(params.memoryId);
  if (!memory) {
    throw new Error(`Memory not found: ${params.memoryId}`);
  }

  // 2. Prepare updates
  const updates: Partial<typeof memory> = {};

  // Add tags
  if (params.updates.addTags && params.updates.addTags.length > 0) {
    const newTags = [...new Set([...memory.tags, ...params.updates.addTags])];
    updates.tags = newTags;
    changes.push(`Added tags: ${params.updates.addTags.join(', ')}`);
  }

  // Remove tags
  if (params.updates.removeTags && params.updates.removeTags.length > 0) {
    updates.tags = memory.tags.filter(
      (tag) => !params.updates.removeTags!.includes(tag)
    );
    changes.push(`Removed tags: ${params.updates.removeTags.join(', ')}`);
  }

  // Add links
  if (params.updates.addLinks && params.updates.addLinks.length > 0) {
    const newLinks = [
      ...new Set([...memory.relatedTo, ...params.updates.addLinks]),
    ];
    updates.relatedTo = newLinks;
    changes.push(`Added links: ${params.updates.addLinks.length}`);
  }

  // Remove links
  if (params.updates.removeLinks && params.updates.removeLinks.length > 0) {
    updates.relatedTo = memory.relatedTo.filter(
      (link) => !params.updates.removeLinks!.includes(link)
    );
    changes.push(`Removed links: ${params.updates.removeLinks.length}`);
  }

  // Update summary
  if (params.updates.updateSummary) {
    validateSingleLine(params.updates.updateSummary, 'summary');
    updates.summary = params.updates.updateSummary;
    changes.push('Updated summary');
  }

  // 3. Track evolution in metadata
  const metadata = memory.metadata as Record<string, unknown>;
  const evolutionHistory = (Array.isArray(metadata.evolutionHistory) 
    ? metadata.evolutionHistory 
    : []) as Array<{ timestamp: string; changes: string[] }>;
  evolutionHistory.push({
    timestamp: new Date().toISOString(),
    changes,
  });
  updates.metadata = {
    ...memory.metadata,
    evolutionHistory,
  };

  // 4. Update memory
  const updatedMemory = await repository.update(params.memoryId, updates);

  return {
    success: true,
    memory: updatedMemory,
    changes,
  };
}

