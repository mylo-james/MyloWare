import type { SearchResult } from '../db/repository';

export interface ReciprocalRankFusionOptions {
  k?: number;
  maxResults?: number;
  weights?: number[];
}

type AggregatedResult = {
  result: SearchResult;
  score: number;
  bestSimilarity: number;
  contributions: number[];
};

export function reciprocalRankFusion(
  resultSets: SearchResult[][],
  kOrOptions: number | ReciprocalRankFusionOptions = 60,
): SearchResult[] {
  if (resultSets.length === 0) {
    return [];
  }

  const options =
    typeof kOrOptions === 'number'
      ? ({ k: kOrOptions } satisfies ReciprocalRankFusionOptions)
      : { ...kOrOptions };

  const k = options.k ?? (typeof kOrOptions === 'number' ? kOrOptions : 60);
  const weights = normalizeWeights(options.weights, resultSets.length);

  const aggregated = new Map<string, AggregatedResult>();

  resultSets.forEach((results, sourceIndex) => {
    if (!Array.isArray(results) || results.length === 0) {
      return;
    }

    const weight = weights[sourceIndex];

    results.forEach((result, position) => {
      const rank = position + 1;
      const contribution = weight / (k + rank);
      const existing = aggregated.get(result.chunkId);

      if (existing) {
        existing.score += contribution;
        existing.contributions[sourceIndex] =
          (existing.contributions[sourceIndex] ?? 0) + contribution;

        if (result.similarity > existing.bestSimilarity) {
          existing.result = { ...result };
          existing.bestSimilarity = result.similarity;
        }
      } else {
        const contributions: number[] = [];
        contributions[sourceIndex] = contribution;

        aggregated.set(result.chunkId, {
          result: { ...result },
          score: contribution,
          bestSimilarity: result.similarity,
          contributions,
        });
      }
    });
  });

  const fusedResults = Array.from(aggregated.values())
    .map(({ result, score }) => ({
      ...result,
      similarity: score,
    }))
    .sort((a, b) => b.similarity - a.similarity);

  if (options.maxResults && options.maxResults > 0) {
    return fusedResults.slice(0, options.maxResults);
  }

  return fusedResults;
}

function normalizeWeights(weights: number[] | undefined, length: number): number[] {
  if (!weights || weights.length !== length) {
    return Array.from({ length }, () => 1);
  }

  const normalized = weights.map((weight) => {
    if (!Number.isFinite(weight) || weight <= 0) {
      return 1;
    }
    return weight;
  });

  return normalized;
}
