import { describe, it, expect } from 'vitest';
import { searchMemories } from '@/tools/memory/searchTool.js';
import { ValidationError } from '@/utils/validation.js';

describe('searchMemories', () => {
  describe('input validation', () => {
    it('should reject query with newlines', async () => {
      await expect(
        searchMemories({ query: 'line1\nline2' })
      ).rejects.toThrow(ValidationError);
    });

    it('should accept single-line query', async () => {
      const result = await searchMemories({
        query: 'test query',
      });
      expect(result).toBeDefined();
      expect(result.memories).toBeInstanceOf(Array);
    });
  });

  // More tests will be added as we implement full functionality
});

