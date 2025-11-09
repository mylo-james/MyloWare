import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { detectRelatedMemories } from '@/utils/linkDetector.js';
import { storeMemory } from '@/tools/memory/storeTool.js';
import { db } from '@/db/client.js';
import { memories } from '@/db/schema.js';

describe('linkDetector', () => {
  beforeAll(async () => {
    // Ensure database is ready
  });

  beforeEach(async () => {
    await db.delete(memories);
  });

  describe('detectRelatedMemories', () => {
    it('should detect related memories', async () => {
      // Create some memories
      const memory1 = await storeMemory({
        content: 'How to generate AISMR video ideas',
        memoryType: 'procedural',
        project: ['aismr']
      });

      const memory2 = await storeMemory({
        content: 'Steps for creating AISMR videos',
        memoryType: 'procedural',
        project: ['aismr']
      });

      // Detect related memories for similar content
      const related = await detectRelatedMemories(
        'Guide for generating AISMR video ideas',
        {
          project: ['aismr'],
          limit: 5
        }
      );

      expect(related.length).toBeGreaterThan(0);
      expect(related).toContain(memory1.id);
      expect(related).toContain(memory2.id);
    });

    it('should filter by project', async () => {
      await storeMemory({
        content: 'AISMR idea generation',
        memoryType: 'procedural',
        project: ['aismr']
      });

      await storeMemory({
        content: 'Other project workflow',
        memoryType: 'procedural',
        project: ['other-project']
      });

      const related = await detectRelatedMemories(
        'AISMR workflow',
        {
          project: ['aismr'],
          limit: 5
        }
      );

      // Should only find aismr memories
      expect(related.length).toBeGreaterThan(0);
    });

    it('should filter by persona', async () => {
      await storeMemory({
        content: 'Casey workflow for ideas',
        memoryType: 'procedural',
        persona: ['chat'],
        project: ['aismr']
      });

      await storeMemory({
        content: 'Other persona workflow',
        memoryType: 'procedural',
        persona: ['other'],
        project: ['aismr']
      });

      const related = await detectRelatedMemories(
        'Casey workflow',
        {
          persona: ['chat'],
          project: ['aismr'],
          limit: 5
        }
      );

      expect(related.length).toBeGreaterThan(0);
    });

    it('should respect limit parameter', async () => {
      // Create multiple memories
      for (let i = 0; i < 10; i++) {
        await storeMemory({
          content: `AISMR workflow ${i}`,
          memoryType: 'procedural',
          project: ['aismr']
        });
      }

      const related = await detectRelatedMemories(
        'AISMR workflow',
        {
          project: ['aismr'],
          limit: 3
        }
      );

      expect(related.length).toBeLessThanOrEqual(3);
    });
  });
});
