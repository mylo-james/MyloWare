import { performance } from 'node:perf_hooks';
import { embedTexts } from './embedTexts';
import {
  evaluateResultUtility,
  formulateRetrievalQuery,
  shouldRetrieve,
  type AgentContext,
  type QueryFormulationContext,
  type QueryFormulationOptions,
  type RetrievalDecision,
  type ShouldRetrieveOptions,
  type UtilityOptions,
} from './retrievalDecisionAgent';
import { reciprocalRankFusion } from './hybridSearch';
import { PromptEmbeddingsRepository, type SearchResult } from '../db/repository';
import { multiHopSearch } from './multiHopSearch';
import type { MemoryType } from '../db/schema';
import type { QueryIntent } from './queryClassifier';

export type SearchMode = 'vector' | 'keyword' | 'hybrid' | 'multi-hop';

export interface AdaptiveSearchParams {
  summary?: string;
  knownFacts?: string[];
  missingInformation?: string[];
  ambiguitySignals?: string[];
  safetyCritical?: boolean;
  lastRetrievedAt?: Date | string | null;
  intent?: QueryIntent;
  persona?: string | null;
  project?: string | null;
  memoryTypes?: MemoryType[];
  keywords?: string[];
  temporalFocus?: QueryFormulationContext['temporalFocus'];
}

export interface AdaptiveSearchOptions {
  repository?: PromptEmbeddingsRepository;
  embed?: typeof embedTexts;
  shouldRetrieveFn?: typeof shouldRetrieve;
  decisionOptions?: ShouldRetrieveOptions;
  formulateFn?: typeof formulateRetrievalQuery;
  formulationOptions?: QueryFormulationOptions;
  evaluateFn?: typeof evaluateResultUtility;
  utilityOptions?: UtilityOptions;
  maxIterations?: number;
  utilityThreshold?: number;
  limit?: number;
  minSimilarity?: number;
  searchModes?: SearchMode[];
  initialMode?: SearchMode;
  applyTemporalDecay?: boolean;
  enableMultiHop?: boolean;
  multiHopMaxHops?: number;
  multiHopMaxResultsPerHop?: number;
  multiHopFn?: typeof multiHopSearch;
}

export interface IterationLog {
  iteration: number;
  query: string;
  searchMode: SearchMode;
  utility: number;
  results: SearchResult[];
  durationMs: number;
  notes: string[];
}

export interface AdaptiveSearchHit extends SearchResult {
  foundAtIteration: number;
  searchMode: SearchMode;
  aggregatedScore: number;
  route?: string[];
  hop?: number;
}

export interface AdaptiveSearchResult {
  decision: RetrievalDecision;
  retrieved: boolean;
  iterations: IterationLog[];
  results: AdaptiveSearchHit[];
  finalUtility: number;
  totalDurationMs: number;
}

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_UTILITY_THRESHOLD = 0.75;
const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_SIMILARITY = 0.2;
const DEFAULT_SEARCH_SEQUENCE: SearchMode[] = ['vector', 'hybrid', 'keyword'];

export async function adaptiveSearch(
  query: string,
  params: AdaptiveSearchParams = {},
  options: AdaptiveSearchOptions = {},
): Promise<AdaptiveSearchResult> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    throw new Error('adaptiveSearch requires a non-empty query.');
  }

  const repository = options.repository ?? new PromptEmbeddingsRepository();
  const embed = options.embed ?? embedTexts;
  const decisionFn = options.shouldRetrieveFn ?? shouldRetrieve;
  const formulateFn = options.formulateFn ?? formulateRetrievalQuery;
  const evaluateFn = options.evaluateFn ?? evaluateResultUtility;
  const utilityThreshold = options.utilityThreshold ?? DEFAULT_UTILITY_THRESHOLD;
  const maxIterations = Math.max(1, options.maxIterations ?? DEFAULT_MAX_ITERATIONS);
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const searchSequence =
    options.searchModes && options.searchModes.length > 0
      ? options.searchModes
      : DEFAULT_SEARCH_SEQUENCE;

  const decision = await decisionFn(
    buildAgentContext(normalizedQuery, params),
    options.decisionOptions,
  );

  const shouldProceed = decision.decision !== 'no' || decision.safetyOverride;
  const startedAt = performance.now();

  if (!shouldProceed) {
    const totalDurationMs = performance.now() - startedAt;
    return {
      decision,
      retrieved: false,
      iterations: [],
      results: [],
      finalUtility: 0,
      totalDurationMs,
    };
  }

  const iterationLogs: IterationLog[] = [];
  const aggregated = new Map<
    string,
    { result: SearchResult; score: number; iteration: number; mode: SearchMode; route: string[]; hop?: number }
  >();

  let currentQuery = await formulateFn(
    normalizedQuery,
    buildFormulationContext(normalizedQuery, params),
    options.formulationOptions,
  );
  if (!currentQuery || currentQuery.trim().length === 0) {
    currentQuery = normalizedQuery;
  }
  currentQuery = currentQuery.trim();

  let currentMode = deriveInitialMode(searchSequence, options.initialMode);
  let finalUtility = 0;
  let retrieved = false;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const iterationStart = performance.now();
    const searchResults = await executeSearch({
      repository,
      embed,
      query: currentQuery,
      mode: currentMode,
      limit,
      minSimilarity,
      persona: params.persona ?? null,
      project: params.project ?? null,
      memoryTypes: params.memoryTypes,
      applyTemporalDecay: options.applyTemporalDecay ?? true,
    });

    retrieved = true;
    mergeResults(aggregated, searchResults, iteration, currentMode);

    const utility = evaluateFn(searchResults, currentQuery, {
      ...options.utilityOptions,
      expectedResults: options.utilityOptions?.expectedResults ?? limit,
    });

    finalUtility = utility;
    const durationMs = performance.now() - iterationStart;
    const notes: string[] = [];

    notes.push(
      utility >= utilityThreshold
        ? `Utility ${utility.toFixed(2)} met threshold ${utilityThreshold.toFixed(2)}.`
        : `Utility ${utility.toFixed(2)} below threshold ${utilityThreshold.toFixed(2)}.`,
    );

    if (searchResults.length === 0) {
      notes.push('No results returned for this iteration.');
    }

    let continueLoop = false;
    let nextQuery = currentQuery;
    let nextMode = currentMode;

    if (iteration < maxIterations && utility < utilityThreshold) {
      nextQuery = refineQuery(currentQuery, searchResults);
      nextMode = determineNextMode(currentMode, searchResults, searchSequence);

      if (nextQuery !== currentQuery) {
        notes.push(`Refined query to "${truncateForNote(nextQuery)}".`);
      }

      if (nextMode !== currentMode) {
        notes.push(`Switching search mode from ${currentMode} to ${nextMode}.`);
      }

      continueLoop = nextQuery !== currentQuery || nextMode !== currentMode;

      if (!continueLoop) {
        notes.push('No further refinements available; stopping iterations.');
      }
    }

    iterationLogs.push({
      iteration,
      query: currentQuery,
      searchMode: currentMode,
      utility,
      results: searchResults,
      durationMs,
      notes,
    });

    if (!continueLoop || utility >= utilityThreshold) {
      break;
    }

    currentQuery = nextQuery;
    currentMode = nextMode;
  }

  const remainingIterations = maxIterations - iterationLogs.length;
  if (options.enableMultiHop && retrieved && remainingIterations > 0) {
    const multiHopFn = options.multiHopFn ?? multiHopSearch;
    const maxHops = Math.min(options.multiHopMaxHops ?? remainingIterations, remainingIterations);
    if (maxHops > 0) {
      const multiHopResult = await multiHopFn(normalizedQuery, maxHops, {
        repository,
        embed,
        hopLimit: maxHops,
        minSimilarity,
        maxResultsPerHop: options.multiHopMaxResultsPerHop ?? limit,
      });

      const hopsToRecord = multiHopResult.hops.filter((hop) => hop.hop > 0);
      const hopIterationIndex = new Map<number, number>();

      for (const hop of hopsToRecord) {
        if (iterationLogs.length >= maxIterations) {
          break;
        }

        const iterationIndex = iterationLogs.length + 1;
        hopIterationIndex.set(hop.hop, iterationIndex);

        const hopUtility = evaluateFn(hop.results, hop.query, {
          ...options.utilityOptions,
          expectedResults: options.utilityOptions?.expectedResults ?? limit,
        });

        finalUtility = Math.max(finalUtility, hopUtility);
        iterationLogs.push({
          iteration: iterationIndex,
          query: hop.query,
          searchMode: 'multi-hop',
          utility: hopUtility,
          results: hop.results,
          durationMs: hop.durationMs,
          notes: [`Multi-hop hop ${hop.hop} derived from reference expansion.`],
        });

      }

      for (const aggregatedHit of multiHopResult.aggregated) {
        const key = aggregatedHit.chunkId;
        const existing = aggregated.get(key);
        const score = aggregatedHit.aggregatedScore ?? aggregatedHit.similarity;
        const hopNumber = aggregatedHit.hop ?? 0;
        const iterationValue =
          hopIterationIndex.get(hopNumber) ??
          (hopNumber > 0
            ? iterationLogs[iterationLogs.length - 1]?.iteration ?? iterationLogs.length
            : iterationLogs[0]?.iteration ?? 1);
        const normalizedIteration = iterationValue < 1 ? 1 : iterationValue;
        if (!existing || score > existing.score) {
          aggregated.set(key, {
            result: { ...aggregatedHit },
            score,
            iteration: normalizedIteration,
            mode: 'multi-hop',
            route: aggregatedHit.route ?? [],
            hop: aggregatedHit.hop,
          });
        }
      }
    }
  }

  const totalDurationMs = performance.now() - startedAt;
  const results = buildAggregatedResults(aggregated, limit);

  return {
    decision,
    retrieved,
    iterations: iterationLogs,
    results,
    finalUtility,
    totalDurationMs,
  };
}

export function refineQuery(originalQuery: string, results: SearchResult[]): string {
  const sanitized = originalQuery.trim().replace(/\s+/g, ' ');
  if (sanitized.length === 0) {
    return sanitized;
  }

  if (results.length === 0) {
    let candidate = sanitized.replace(/["'“”‘’]/g, '').trim();
    if (candidate.length === 0) {
      candidate = sanitized;
    }
    if (!candidate.toLowerCase().includes('overview')) {
      candidate = `${candidate} overview`.trim();
    }
    return truncateQuery(candidate);
  }

  const keywordSet = new Set<string>();
  const lowerQuery = sanitized.toLowerCase();

  for (const result of results.slice(0, 5)) {
    const metadata = (result.metadata ?? {}) as Record<string, unknown>;
    const potentialKeywords = extractMetadataKeywords(metadata);
    for (const keyword of potentialKeywords) {
      const normalized = keyword.toLowerCase();
      if (normalized.length < 3) {
        continue;
      }
      if (!lowerQuery.includes(normalized)) {
        keywordSet.add(keyword);
      }
      if (keywordSet.size >= 6) {
        break;
      }
    }
    if (keywordSet.size >= 6) {
      break;
    }
  }

  if (keywordSet.size === 0) {
    return sanitized;
  }

  const appended = `${sanitized} ${Array.from(keywordSet).join(' ')}`;
  return truncateQuery(appended);
}

function buildAgentContext(query: string, params: AdaptiveSearchParams): AgentContext {
  return {
    query,
    summary: params.summary,
    knownFacts: params.knownFacts,
    missingInformation: params.missingInformation,
    safetyCritical: params.safetyCritical,
    lastRetrievedAt: params.lastRetrievedAt ?? null,
    ambiguitySignals: params.ambiguitySignals,
    intent: params.intent,
  };
}

function buildFormulationContext(query: string, params: AdaptiveSearchParams): QueryFormulationContext {
  return {
    summary: params.summary,
    intent: params.intent,
    missingInformation: params.missingInformation,
    keywords: params.keywords,
    temporalFocus: params.temporalFocus ?? detectTemporalFocus(query),
  };
}

function detectTemporalFocus(query: string): QueryFormulationContext['temporalFocus'] {
  const lowered = query.toLowerCase();
  if (/(latest|today|recent|new)/.test(lowered)) {
    return 'recent';
  }
  if (/(history|archive|earlier|previous)/.test(lowered)) {
    return 'historical';
  }
  return 'any';
}

function deriveInitialMode(sequence: SearchMode[], preferred?: SearchMode): SearchMode {
  if (preferred && sequence.includes(preferred)) {
    return preferred;
  }
  return sequence[0] ?? 'vector';
}

async function executeSearch(params: {
  repository: PromptEmbeddingsRepository;
  embed: typeof embedTexts;
  query: string;
  mode: SearchMode;
  limit: number;
  minSimilarity: number;
  persona: string | null;
  project: string | null;
  memoryTypes?: MemoryType[];
  applyTemporalDecay: boolean;
}): Promise<SearchResult[]> {
  const {
    repository,
    embed,
    query,
    mode,
    limit,
    minSimilarity,
    persona,
    project,
    memoryTypes,
    applyTemporalDecay,
  } = params;

  if (mode === 'keyword') {
    return repository.keywordSearch(
      query,
      {
        persona: persona ?? undefined,
        project: project ?? undefined,
      },
      { limit },
    );
  }

  const [embedding] = await embed([query]);
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return [];
  }

  if (mode === 'vector') {
    return repository.search({
      embedding,
      limit,
      minSimilarity,
      persona: persona ?? undefined,
      project: project ?? undefined,
      memoryTypes,
      applyTemporalDecay,
    });
  }

  const [vectorResults, keywordResults] = await Promise.all([
    repository.search({
      embedding,
      limit,
      minSimilarity,
      persona: persona ?? undefined,
      project: project ?? undefined,
      memoryTypes,
      applyTemporalDecay,
    }),
    repository.keywordSearch(
      query,
      {
        persona: persona ?? undefined,
        project: project ?? undefined,
      },
      { limit },
    ),
  ]);

  return reciprocalRankFusion([vectorResults, keywordResults], {
    maxResults: limit,
  });
}

function mergeResults(
  aggregated: Map<string, { result: SearchResult; score: number; iteration: number; mode: SearchMode; route: string[]; hop?: number }>,
  results: SearchResult[],
  iteration: number,
  mode: SearchMode,
  route: string[] = [],
  hop = 0,
): void {
  for (const result of results) {
    const existing = aggregated.get(result.chunkId);
    const score = result.similarity;
    const routePath = route.length > 0 ? [...route] : [mode];
    if (!existing || score > existing.score) {
      aggregated.set(result.chunkId, {
        result: { ...result },
        score,
        iteration,
        mode,
        route: routePath,
        hop,
      });
    }
  }
}

function buildAggregatedResults(
  aggregated: Map<string, { result: SearchResult; score: number; iteration: number; mode: SearchMode; route: string[]; hop?: number }>,
  limit: number,
): AdaptiveSearchHit[] {
  return Array.from(aggregated.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      ...entry.result,
      foundAtIteration: entry.iteration,
      searchMode: entry.mode,
      aggregatedScore: entry.score,
      route: entry.route,
      hop: entry.hop,
    }));
}

function determineNextMode(
  currentMode: SearchMode,
  results: SearchResult[],
  sequence: SearchMode[],
): SearchMode {
  if (results.length > 0) {
    return currentMode;
  }

  const currentIndex = sequence.indexOf(currentMode);
  if (currentIndex === -1 || currentIndex === sequence.length - 1) {
    return currentMode;
  }

  return sequence[currentIndex + 1];
}

function extractMetadataKeywords(metadata: Record<string, unknown>): string[] {
  const collected: string[] = [];
  const candidateKeys = ['persona', 'project', 'tags', 'keywords', 'title', 'slug', 'topic'];

  for (const key of candidateKeys) {
    const value = metadata[key];
    if (typeof value === 'string') {
      collected.push(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') {
          collected.push(entry);
        }
      }
    }
  }

  return collected
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}

function truncateQuery(value: string): string {
  return value.length > 260 ? `${value.slice(0, 257)}...` : value;
}

function truncateForNote(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}
