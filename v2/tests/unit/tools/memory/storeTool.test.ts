import { describe, it, expect } from 'vitest';
import { storeMemory } from '@/tools/memory/storeTool.js';
import { ValidationError } from '@/utils/validation.js';

describe('storeMemory', () => {
  describe('input validation', () => {
    it('should reject content with newlines', async () => {
      await expect(
        storeMemory({
          content: 'line1\nline2',
          memoryType: 'episodic',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should accept single-line content', async () => {
      const result = await storeMemory({
        content: 'Valid single line content',
        memoryType: 'episodic',
        project: ['test'],
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.content).toBe('Valid single line content');
    });
  });
});

