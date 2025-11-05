import { describe, it, expect, beforeEach } from 'vitest';
import { evolveMemory } from '@/tools/memory/evolveTool.js';
import { storeMemory } from '@/tools/memory/storeTool.js';
import { db } from '@/db/client.js';
import { memories } from '@/db/schema.js';

describe('evolveMemory', () => {
  let testMemoryId: string;

  beforeEach(async () => {
    // Clear memories
    await db.delete(memories);

    // Create test memory
    const memory = await storeMemory({
      content: 'Test memory for evolution',
      memoryType: 'episodic',
      project: ['test'],
      tags: ['original'],
    });
    testMemoryId = memory.id;
  });

  it('should add tags to memory', async () => {
    const result = await evolveMemory({
      memoryId: testMemoryId,
      updates: {
        addTags: ['new-tag', 'another-tag'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.memory.tags).toContain('original');
    expect(result.memory.tags).toContain('new-tag');
    expect(result.memory.tags).toContain('another-tag');
    expect(result.changes).toContain('Added tags: new-tag, another-tag');
  });

  it('should track evolution history', async () => {
    await evolveMemory({
      memoryId: testMemoryId,
      updates: { addTags: ['test'] },
    });

    const result = await evolveMemory({
      memoryId: testMemoryId,
      updates: { updateSummary: 'New summary' },
    });

    const history = result.memory.metadata.evolutionHistory as any[];
    expect(history).toHaveLength(2);
    expect(history[0].changes).toContain('Added tags: test');
    expect(history[1].changes).toContain('Updated summary');
  });
});

