import { MemoryRepository } from '../db/repositories/memory-repository.js';
import type { Memory } from '../types/memory.js';

/**
 * Expand memory graph by traversing linked memories
 *
 * @param seedMemories - Initial memories to expand from
 * @param maxHops - Maximum number of hops to traverse (default: 2)
 * @param maxExpanded - Maximum total memories to return (default: 20)
 * @returns Expanded list of memories including linked ones
 */
export async function expandMemoryGraph(
  seedMemories: Memory[],
  maxHops: number = 2,
  maxExpanded: number = 20
): Promise<Memory[]> {
  const repository = new MemoryRepository();
  const visited = new Set<string>(seedMemories.map((m) => m.id));
  const expanded = [...seedMemories];

  for (let hop = 0; hop < maxHops; hop++) {
    // Get memories to expand from (seed for first hop, recently added for subsequent)
    const toExpand = hop === 0 ? seedMemories : expanded.slice(-10);
    const linkedIds = new Set<string>();

    // Collect all linked memory IDs from current expansion set
    for (const memory of toExpand) {
      for (const relatedId of memory.relatedTo) {
        if (!visited.has(relatedId)) {
          linkedIds.add(relatedId);
        }
      }
    }

    // No more links to explore
    if (linkedIds.size === 0) break;

    // Fetch linked memories (limit to prevent explosion)
    const remainingSlots = maxExpanded - expanded.length;
    if (remainingSlots <= 0) break;

    const linked = await repository.findByIds(
      Array.from(linkedIds).slice(0, remainingSlots)
    );

    // Add to expanded set
    for (const memory of linked) {
      visited.add(memory.id);
      expanded.push(memory);
    }

    // Stop if we've reached max expanded
    if (expanded.length >= maxExpanded) break;
  }

  return expanded;
}

