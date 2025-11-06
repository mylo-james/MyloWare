import type { Memory } from '../types/memory.js';

export function reciprocalRankFusion(
  results: Memory[][],
  k = 60
): Memory[] {
  const scoreMap = new Map<string, { memory: Memory; score: number }>();

  // Calculate RRF scores
  results.forEach((resultSet) => {
    resultSet.forEach((memory, index) => {
      const rank = index + 1;
      const rrfScore = 1 / (k + rank);

      const existing = scoreMap.get(memory.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scoreMap.set(memory.id, {
          memory,
          score: rrfScore,
        });
      }
    });
  });

  // Sort by score
  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .map((item) => item.memory);
}

