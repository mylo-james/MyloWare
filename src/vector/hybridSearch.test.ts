import { describe, expect, it } from 'vitest';
import type { SearchResult } from '../db/repository';
import { reciprocalRankFusion } from './hybridSearch';

function createResult(
  id: string,
  similarity: number,
  overrides: Partial<SearchResult> = {},
): SearchResult {
  return {
    chunkId: id,
    promptKey: `${id}.md`,
    chunkText: `chunk-${id}`,
    rawSource: `source-${id}`,
    metadata: {},
    similarity,
    ageDays: overrides.ageDays ?? null,
    temporalDecayApplied: overrides.temporalDecayApplied ?? false,
    memoryType: overrides.memoryType ?? 'semantic',
    ...overrides,
  } satisfies SearchResult;
}

describe('reciprocalRankFusion', () => {
  it('returns same ordering for identical result sets', () => {
    const vector = [createResult('a', 0.9), createResult('b', 0.8)];
    const keyword = [createResult('a', 0.85), createResult('b', 0.75)];

    const fused = reciprocalRankFusion([vector, keyword], 0);

    expect(fused).toHaveLength(2);
    expect(fused[0].chunkId).toBe('a');
    expect(fused[0].similarity).toBeCloseTo(2, 5);
    expect(fused[1].chunkId).toBe('b');
    expect(fused[1].similarity).toBeCloseTo(1, 5);
  });

  it('merges disjoint result sets', () => {
    const vector = [createResult('a', 0.95)];
    const keyword = [createResult('b', 0.72)];

    const fused = reciprocalRankFusion([vector, keyword], 0);

    expect(new Set(fused.map((result) => result.chunkId))).toEqual(new Set(['a', 'b']));
    expect(fused).toHaveLength(2);
  });

  it('prioritizes overlapping results with higher combined score', () => {
    const vector = [createResult('a', 0.9), createResult('b', 0.7)];
    const keyword = [createResult('b', 0.95, { chunkText: 'keyword-b' }), createResult('c', 0.65)];

    const fused = reciprocalRankFusion([vector, keyword], 0);

    expect(fused[0].chunkId).toBe('b');
    expect(fused[0].chunkText).toBe('keyword-b');
    expect(fused[0].similarity).toBeCloseTo(1.5, 5);
    expect(fused[1].chunkId).toBe('a');
  });

  it('returns an empty array for empty input', () => {
    expect(reciprocalRankFusion([], 0)).toEqual([]);
  });

  it('handles single-source input gracefully', () => {
    const vector = [createResult('a', 0.9), createResult('b', 0.7)];

    const fused = reciprocalRankFusion([vector], 0);

    expect(fused).toHaveLength(2);
    expect(fused[0].chunkId).toBe('a');
    expect(fused[0].similarity).toBeCloseTo(1, 5);
    expect(fused[1].similarity).toBeCloseTo(0.5, 5);
  });
});
