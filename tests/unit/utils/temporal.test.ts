import { describe, it, expect } from 'vitest';
import { applyTemporalDecay } from '@/utils/temporal.js';
import type { Memory } from '@/types/memory.js';

describe('temporal', () => {
  describe('applyTemporalDecay', () => {
    it('should apply temporal decay to memories', () => {
      const now = Date.now();
      const memories: Memory[] = [
        {
          id: '1',
          content: 'Recent memory',
          summary: null,
          embedding: [],
          memoryType: 'episodic',
          persona: [],
          project: [],
          tags: [],
          relatedTo: [],
          createdAt: new Date(now - 1 * 24 * 60 * 60 * 1000), // 1 day ago
          updatedAt: new Date(),
          lastAccessedAt: null,
          accessCount: 0,
          metadata: {}
        },
        {
          id: '2',
          content: 'Old memory',
          summary: null,
          embedding: [],
          memoryType: 'episodic',
          persona: [],
          project: [],
          tags: [],
          relatedTo: [],
          createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000), // 30 days ago
          updatedAt: new Date(),
          lastAccessedAt: null,
          accessCount: 0,
          metadata: {}
        }
      ];

      const result = applyTemporalDecay(memories);

      expect(result.length).toBe(2);
      expect(result[0].metadata.temporalScore).toBeDefined();
      expect(result[1].metadata.temporalScore).toBeDefined();
      
      // Recent memory should have higher score
      const recentScore = result.find(m => m.id === '1')?.metadata.temporalScore as number;
      const oldScore = result.find(m => m.id === '2')?.metadata.temporalScore as number;
      
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it('should sort memories by temporal score', () => {
      const now = Date.now();
      const memories: Memory[] = [
        {
          id: 'old',
          content: 'Old memory',
          summary: null,
          embedding: [],
          memoryType: 'episodic',
          persona: [],
          project: [],
          tags: [],
          relatedTo: [],
          createdAt: new Date(now - 100 * 24 * 60 * 60 * 1000), // 100 days ago
          updatedAt: new Date(),
          lastAccessedAt: null,
          accessCount: 0,
          metadata: {}
        },
        {
          id: 'recent',
          content: 'Recent memory',
          summary: null,
          embedding: [],
          memoryType: 'episodic',
          persona: [],
          project: [],
          tags: [],
          relatedTo: [],
          createdAt: new Date(now - 1 * 24 * 60 * 60 * 1000), // 1 day ago
          updatedAt: new Date(),
          lastAccessedAt: null,
          accessCount: 0,
          metadata: {}
        }
      ];

      const result = applyTemporalDecay(memories);

      // Recent memory should be first
      expect(result[0].id).toBe('recent');
      expect(result[1].id).toBe('old');
    });

    it('should use configurable decay rate', () => {
      const now = Date.now();
      const memories: Memory[] = [
        {
          id: '1',
          content: 'Memory',
          summary: null,
          embedding: [],
          memoryType: 'episodic',
          persona: [],
          project: [],
          tags: [],
          relatedTo: [],
          createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000), // 10 days ago
          updatedAt: new Date(),
          lastAccessedAt: null,
          accessCount: 0,
          metadata: {}
        }
      ];

      const resultSlow = applyTemporalDecay(memories, 0.05); // Slow decay
      const resultFast = applyTemporalDecay(memories, 0.2); // Fast decay

      const scoreSlow = resultSlow[0].metadata.temporalScore as number;
      const scoreFast = resultFast[0].metadata.temporalScore as number;

      // Slow decay should produce higher score
      expect(scoreSlow).toBeGreaterThan(scoreFast);
    });

    it('should handle very recent memories', () => {
      const now = Date.now();
      const memories: Memory[] = [
        {
          id: '1',
          content: 'Very recent memory',
          summary: null,
          embedding: [],
          memoryType: 'episodic',
          persona: [],
          project: [],
          tags: [],
          relatedTo: [],
          createdAt: new Date(now - 1000), // 1 second ago
          updatedAt: new Date(),
          lastAccessedAt: null,
          accessCount: 0,
          metadata: {}
        }
      ];

      const result = applyTemporalDecay(memories);

      expect(result[0].metadata.temporalScore).toBeCloseTo(1, 2); // Should be very close to 1
    });
  });
});

