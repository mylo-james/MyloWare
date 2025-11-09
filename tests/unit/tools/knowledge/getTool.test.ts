import { describe, it, expect, beforeEach, vi } from 'vitest';
import { knowledgeGet } from '@/tools/knowledge/getTool.js';
import { MemoryRepository } from '@/db/repositories/memory-repository.js';
import type { Memory } from '@/types/memory.js';

// Mock the repository
vi.mock('@/db/repositories/memory-repository.js', () => {
  return {
    MemoryRepository: vi.fn(() => ({
      search: vi.fn(),
    })),
  };
});

describe('knowledgeGet', () => {
  let mockSearch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const MockedRepo = MemoryRepository as unknown as ReturnType<typeof vi.fn>;
    mockSearch = MockedRepo.mock.results[0]?.value?.search || vi.fn();
  });

  describe('input validation', () => {
    it('should reject empty query', async () => {
      await expect(
        knowledgeGet({
          query: '',
          persona: 'veo',
        })
      ).rejects.toThrow('Query must be a non-empty string');
    });

    it('should reject whitespace-only query', async () => {
      await expect(
        knowledgeGet({
          query: '   ',
          persona: 'veo',
        })
      ).rejects.toThrow('Query must be a non-empty string');
    });

    it('should reject invalid limit', async () => {
      await expect(
        knowledgeGet({
          query: 'test',
          limit: 0,
        })
      ).rejects.toThrow('Limit must be between 1 and 100');

      await expect(
        knowledgeGet({
          query: 'test',
          limit: 101,
        })
      ).rejects.toThrow('Limit must be between 1 and 100');
    });
  });

  describe('search behavior', () => {
    it('should search with knowledge tag filter', async () => {
      const mockMemories: Memory[] = [
        {
          id: 'mem-1',
          content: 'Shotstack video generation API documentation',
          summary: null,
          memoryType: 'procedural',
          persona: ['veo'],
          project: ['aismr'],
          tags: ['knowledge', 'ingest'],
          relatedTo: [],
          createdAt: '2025-01-09T00:00:00.000Z',
          updatedAt: '2025-01-09T00:00:00.000Z',
          lastAccessedAt: null,
          accessCount: 0,
          embedding: [],
          metadata: {},
          relevanceScore: 0.95,
        },
      ];

      mockSearch.mockResolvedValue(mockMemories);

      const result = await knowledgeGet({
        query: 'shotstack video generation',
        persona: 'veo',
        project: 'aismr',
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'shotstack video generation',
          tags: ['knowledge'],
          persona: 'veo',
          project: 'aismr',
          limit: 10,
          minSimilarity: 0.75,
          temporalBoost: true,
        })
      );

      expect(result.knowledge).toEqual(mockMemories);
      expect(result.totalFound).toBe(1);
      expect(result.query).toBe('shotstack video generation');
    });

    it('should use default limit of 10', async () => {
      mockSearch.mockResolvedValue([]);

      await knowledgeGet({
        query: 'test',
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
        })
      );
    });

    it('should use custom limit', async () => {
      mockSearch.mockResolvedValue([]);

      await knowledgeGet({
        query: 'test',
        limit: 5,
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 5,
        })
      );
    });

    it('should use default minSimilarity of 0.75', async () => {
      mockSearch.mockResolvedValue([]);

      await knowledgeGet({
        query: 'test',
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          minSimilarity: 0.75,
        })
      );
    });

    it('should use custom minSimilarity', async () => {
      mockSearch.mockResolvedValue([]);

      await knowledgeGet({
        query: 'test',
        minSimilarity: 0.9,
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          minSimilarity: 0.9,
        })
      );
    });

    it('should enable temporal boost', async () => {
      mockSearch.mockResolvedValue([]);

      await knowledgeGet({
        query: 'test',
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          temporalBoost: true,
        })
      );
    });
  });

  describe('persona scoping', () => {
    it('should scope to specific persona', async () => {
      mockSearch.mockResolvedValue([]);

      await knowledgeGet({
        query: 'test',
        persona: 'veo',
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          persona: 'veo',
        })
      );
    });

    it('should work without persona scope', async () => {
      mockSearch.mockResolvedValue([]);

      await knowledgeGet({
        query: 'test',
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          persona: undefined,
        })
      );
    });
  });

  describe('project filtering', () => {
    it('should filter by project', async () => {
      mockSearch.mockResolvedValue([]);

      await knowledgeGet({
        query: 'test',
        project: 'aismr',
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'aismr',
        })
      );
    });

    it('should work without project filter', async () => {
      mockSearch.mockResolvedValue([]);

      await knowledgeGet({
        query: 'test',
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          project: undefined,
        })
      );
    });
  });

  describe('result formatting', () => {
    it('should return structured result', async () => {
      const mockMemories: Memory[] = [
        {
          id: 'mem-1',
          content: 'Test knowledge',
          summary: null,
          memoryType: 'semantic',
          persona: ['veo'],
          project: ['aismr'],
          tags: ['knowledge'],
          relatedTo: [],
          createdAt: '2025-01-09T00:00:00.000Z',
          updatedAt: '2025-01-09T00:00:00.000Z',
          lastAccessedAt: null,
          accessCount: 0,
          embedding: [],
          metadata: {},
          relevanceScore: 0.85,
        },
      ];

      mockSearch.mockResolvedValue(mockMemories);

      const result = await knowledgeGet({
        query: 'test query',
      });

      expect(result).toEqual({
        knowledge: mockMemories,
        totalFound: 1,
        query: 'test query',
      });
    });

    it('should handle empty results', async () => {
      mockSearch.mockResolvedValue([]);

      const result = await knowledgeGet({
        query: 'nonexistent',
      });

      expect(result).toEqual({
        knowledge: [],
        totalFound: 0,
        query: 'nonexistent',
      });
    });
  });
});

