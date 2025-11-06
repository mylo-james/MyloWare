import type { Memory } from '../types/memory.js';

export function applyTemporalDecay(
  memories: Memory[],
  decayRate = 0.1
): Memory[] {
  const now = Date.now();

  return memories
    .map((memory) => {
      const ageInDays =
        (now - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const decayFactor = Math.exp(-decayRate * ageInDays);

      // Add temporal score to metadata
      return {
        ...memory,
        metadata: {
          ...memory.metadata,
          temporalScore: decayFactor,
        },
      };
    })
    .sort((a, b) => {
      const scoreA = (a.metadata.temporalScore as number) || 0;
      const scoreB = (b.metadata.temporalScore as number) || 0;
      return scoreB - scoreA;
    });
}

