import { describe, it, expect, beforeEach } from 'vitest';
import { expandMemoryGraph } from '@/utils/graphExpansion.js';
import { storeMemory } from '@/tools/memory/storeTool.js';
import { db } from '@/db/client.js';
import { memories } from '@/db/schema.js';

describe('expandMemoryGraph', () => {
  beforeEach(async () => {
    await db.delete(memories);
  });

  it('should return seed memories when no links', async () => {
    const memory = await storeMemory({
      content: 'Test memory with no links',
      memoryType: 'episodic',
      project: ['test'],
    });

    const expanded = await expandMemoryGraph([memory]);
    expect(expanded).toHaveLength(1);
    expect(expanded[0].id).toBe(memory.id);
  });

  it('should expand single hop', async () => {
    // Create memory A
    const memoryA = await storeMemory({
      content: 'Memory A',
      memoryType: 'episodic',
      project: ['test'],
    });

    // Create memory B linked to A
    const memoryB = await storeMemory({
      content: 'Memory B linked to A',
      memoryType: 'episodic',
      project: ['test'],
      relatedTo: [memoryA.id],
    });

    const expanded = await expandMemoryGraph([memoryB], 1, 10);
    expect(expanded.length).toBeGreaterThanOrEqual(1);
    const ids = expanded.map((m) => m.id);
    expect(ids).toContain(memoryB.id);
    expect(ids).toContain(memoryA.id);
  });

  it('should expand multiple hops', async () => {
    // Create chain: A -> B -> C
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

    const expanded = await expandMemoryGraph([memoryC], 2, 10);
    const ids = expanded.map((m) => m.id);
    expect(ids).toContain(memoryC.id);
    expect(ids).toContain(memoryB.id);
    expect(ids).toContain(memoryA.id);
  });

  it('should respect maxExpanded limit', async () => {
    // Create seed memory
    const seed = await storeMemory({
      content: 'Seed memory',
      memoryType: 'episodic',
      project: ['test'],
    });

    // Create many linked memories
    const linked: string[] = [];
    for (let i = 0; i < 15; i++) {
      const mem = await storeMemory({
        content: `Linked memory ${i}`,
        memoryType: 'episodic',
        project: ['test'],
        relatedTo: [seed.id],
      });
      linked.push(mem.id);
    }

    const expanded = await expandMemoryGraph([seed], 1, 10);
    expect(expanded.length).toBeLessThanOrEqual(10);
  });

  it('should prevent circular references', async () => {
    // Create circular link: A <-> B
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

    // Update A to link back to B
    const updatedA = await storeMemory({
      content: 'Memory A updated',
      memoryType: 'episodic',
      project: ['test'],
      relatedTo: [memoryB.id],
    });

    // Should not cause infinite loop
    const expanded = await expandMemoryGraph([memoryA], 3, 20);
    const ids = expanded.map((m) => m.id);
    // Should contain both but not duplicate
    expect(ids.filter((id) => id === memoryA.id).length).toBe(1);
    expect(ids.filter((id) => id === memoryB.id).length).toBe(1);
  });

  it('should handle empty seed memories', async () => {
    const expanded = await expandMemoryGraph([], 2, 10);
    expect(expanded).toHaveLength(0);
  });
});

