import { embedTexts } from './embedTexts';
import { orchestrateMemorySearch, type MemoryRouterRepository } from './memoryRouter';
import { PromptEmbeddingsRepository, type SearchResult } from '../db/repository';
import { extractReferences, resolveReference, type Reference } from './referenceExtractor';

type MultiHopRepository = MemoryRouterRepository;

export interface MultiHopSearchOptions {
  repository?: MultiHopRepository;
  embed?: typeof embedTexts;
  hopLimit?: number;
  minSimilarity?: number;
  maxResultsPerHop?: number;
  routeSearch?: typeof orchestrateMemorySearch;
}

export interface MultiHopResult {
  hops: HopResult[];
  aggregated: MultiHopHit[];
  totalReferences: number;
  maxHopReached: number;
}

export interface HopResult {
  hop: number;
  query: string;
  results: SearchResult[];
  references: Reference[];
  durationMs: number;
}

export interface MultiHopHit extends SearchResult {
  hop: number;
  route: string[];
  aggregatedScore: number;
}

const DEFAULT_HOP_LIMIT = 2;
const DEFAULT_MIN_SIMILARITY = 0.25;
const DEFAULT_MAX_RESULTS_PER_HOP = 5;

export async function multiHopSearch(
  query: string,
  maxHops = DEFAULT_HOP_LIMIT,
  options: MultiHopSearchOptions = {},
): Promise<MultiHopResult> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    throw new Error('multiHopSearch requires a non-empty query.');
  }

  const hopLimit = Math.max(0, Math.min(maxHops, options.hopLimit ?? DEFAULT_HOP_LIMIT));
  const repository: MultiHopRepository =
    options.repository ?? (new PromptEmbeddingsRepository() as MultiHopRepository);
  const embed = options.embed ?? embedTexts;
  const routeSearch = options.routeSearch ?? orchestrateMemorySearch;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const maxResultsPerHop = options.maxResultsPerHop ?? DEFAULT_MAX_RESULTS_PER_HOP;

  const hops: HopResult[] = [];
  const aggregated = new Map<string, { result: SearchResult; hop: number; route: string[]; score: number }>();
  let totalReferences = 0;

  const queue: Array<{ query: string; route: string[]; hop: number }> = [
    { query: normalizedQuery, route: [normalizedQuery], hop: 0 },
  ];

  const visitedQueries = new Set<string>([`0:${normalizedQuery}`]);
  const visitedReferences = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.hop > hopLimit) {
      continue;
    }

    const hopResult = await runSingleHop(
      current.query,
      repository,
      embed,
      minSimilarity,
      maxResultsPerHop,
      routeSearch,
    );

    hops.push({
      hop: current.hop,
      query: current.query,
      results: hopResult.results,
      references: hopResult.references,
      durationMs: hopResult.durationMs,
    });

    for (const result of hopResult.results) {
      const key = result.chunkId;
      const existing = aggregated.get(key);
      const aggregateScore = result.similarity / (current.hop + 1);
      if (!existing || aggregateScore > existing.score) {
        aggregated.set(key, {
          result,
          hop: current.hop,
          route: current.route,
          score: aggregateScore,
        });
      }
    }

    totalReferences += hopResult.references.length;

    if (current.hop >= hopLimit) {
      continue;
    }

    for (const reference of hopResult.references.slice(0, maxResultsPerHop)) {
      const referenceKey = `${reference.type}:${reference.normalized}:${current.hop + 1}`;
      if (visitedReferences.has(referenceKey)) {
        continue;
      }
      visitedReferences.add(referenceKey);

      const resolved = await resolveReference(reference, repository, embed);
      const nextRoute = [...current.route, reference.normalized];

      for (const result of resolved.results.slice(0, maxResultsPerHop)) {
        const key = result.chunkId;
        const existing = aggregated.get(key);
        const aggregateScore = result.similarity / (current.hop + 2);
        if (!existing || aggregateScore > existing.score) {
          aggregated.set(key, {
            result,
            hop: current.hop + 1,
            route: nextRoute,
            score: aggregateScore,
          });
        }
      }

      const nextQuery = buildReferenceQuery(reference);
      const queryKey = `${current.hop + 1}:${nextQuery}`;
      if (!visitedQueries.has(queryKey)) {
        visitedQueries.add(queryKey);
        queue.push({
          query: nextQuery,
          route: [...current.route, nextQuery],
          hop: current.hop + 1,
        });
      }
    }
  }

  const aggregatedResults = Array.from(aggregated.values())
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({
      ...entry.result,
      hop: entry.hop,
      route: entry.route,
      aggregatedScore: entry.score,
    }));

  const maxHopReached = hops.reduce((max, hop) => Math.max(max, hop.hop), 0);

  return {
    hops,
    aggregated: aggregatedResults,
    totalReferences,
    maxHopReached,
  };
}

async function runSingleHop(
  query: string,
  repository: MultiHopRepository,
  embed: typeof embedTexts,
  minSimilarity: number,
  maxResults: number,
  routeSearch: typeof orchestrateMemorySearch,
): Promise<{ results: SearchResult[]; references: Reference[]; durationMs: number }> {
  const start = performance.now();
  const routerResult = await routeSearch(query, {
    repository,
    embed,
    limitPerType: maxResults,
    minSimilarity,
  });

  const combined = routerResult.combined;
  const references: Reference[] = [];
  for (const result of combined) {
    references.push(...extractReferences(result));
  }

  const durationMs = performance.now() - start;

  return {
    results: combined,
    references,
    durationMs,
  };
}

function buildReferenceQuery(reference: Reference): string {
  switch (reference.type) {
    case 'persona':
      return `${reference.normalized} persona overview`;
    case 'project':
      return `${reference.normalized} project summary`;
    case 'workflow':
      return `workflow step ${reference.normalized}`;
    case 'link':
      return reference.normalized;
    default:
      return reference.normalized;
  }
}
