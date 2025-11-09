import { describe, it, expect, beforeEach } from 'vitest';
import { searchMemories } from '@/tools/memory/searchTool.js';
import { storeMemory } from '@/tools/memory/storeTool.js';
import { db } from '@/db/client.js';
import { memories } from '@/db/schema.js';

describe('Memory Graph Integration', () => {
  beforeEach(async () => {
    await db.delete(memories);
  });

  it('should return linked memories when expandGraph=true', async () => {
    // Create memory A with content about rain
    const memoryA = await storeMemory({
      content: 'Generated ideas about rain sounds',
      memoryType: 'episodic',
      project: ['aismr'],
      tags: ['ideas', 'rain'],
    });

    // Create memory B linked to A
    const memoryB = await storeMemory({
      content: 'Created video about gentle rain',
      memoryType: 'episodic',
      project: ['aismr'],
      tags: ['video', 'rain'],
      relatedTo: [memoryA.id],
    });

    // Create memory C linked to B
    const memoryC = await storeMemory({
      content: 'User prefers soft ambient sounds',
      memoryType: 'episodic',
      project: ['aismr'],
      tags: ['preferences'],
      relatedTo: [memoryB.id],
    });

    // Search without graph expansion
    const withoutExpansion = await searchMemories({
      query: 'rain sounds',
      project: 'aismr',
      expandGraph: false,
      limit: 10,
    });

    // Search with graph expansion
    const withExpansion = await searchMemories({
      query: 'rain sounds',
      project: 'aismr',
      expandGraph: true,
      maxHops: 2,
      limit: 10,
    });

    // With expansion should find more memories
    expect(withExpansion.memories.length).toBeGreaterThanOrEqual(
      withoutExpansion.memories.length
    );

    // Should include linked memories
    const expandedIds = withExpansion.memories.map((m) => m.id);
    expect(expandedIds).toContain(memoryA.id);
    expect(expandedIds).toContain(memoryB.id);
    expect(expandedIds).toContain(memoryC.id);
  });

  it('should respect maxHops parameter', async () => {
    // Create chain: A -> B -> C -> D
    const memoryA = await storeMemory({
      content: 'Memory A',
      memoryType: 'episodic',
      project: ['test'],
    });

    const memoryB = await storeMemory({
      content: 'Memory B',
      memoryType: 'episodic',
      project: ['test'],
      relatedTo: [memoryA.id],
    });

    const memoryC = await storeMemory({
      content: 'Memory C',
      memoryType: 'episodic',
      project: ['test'],
      relatedTo: [memoryB.id],
    });

    const memoryD = await storeMemory({
      content: 'Memory D',
      memoryType: 'episodic',
      project: ['test'],
      relatedTo: [memoryC.id],
    });

    // Search with maxHops=1 (should only get B)
    const hop1 = await searchMemories({
      query: 'Memory',
      project: 'test',
      expandGraph: true,
      maxHops: 1,
      limit: 10,
    });

    // Search with maxHops=2 (should get B and C)
    const hop2 = await searchMemories({
      query: 'Memory',
      project: 'test',
      expandGraph: true,
      maxHops: 2,
      limit: 10,
    });

    const hop1Ids = hop1.memories.map((m) => m.id);
    const hop2Ids = hop2.memories.map((m) => m.id);

    expect(hop1Ids).toContain(memoryB.id);
    expect(hop1Ids).not.toContain(memoryC.id);

    expect(hop2Ids).toContain(memoryC.id);
    expect(hop2Ids).not.toContain(memoryD.id);
  });
});

