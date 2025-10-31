import { performance } from 'node:perf_hooks';
import { embedTexts } from './embedTexts';
import { classifyQueryIntent, type QueryClassification, type QueryIntent } from './queryClassifier';
import { PromptEmbeddingsRepository, type SearchResult } from '../db/repository';
import type { MemoryType } from '../db/schema';
import { normaliseSlugOptional } from '../utils/slug';

type RouteHeuristic = (normalizedQuery: string) => MemoryType | null;

export type MemoryRouterRepository = Pick<PromptEmbeddingsRepository, 'search' | 'keywordSearch'>;

export interface MemoryRouterOptions {
  repository?: MemoryRouterRepository;
  embed?: typeof embedTexts;
  classify?: typeof classifyQueryIntent;
  limitPerType?: number;
  minSimilarity?: number;
  weights?: Partial<Record<MemoryType, number>>;
  notes?: string[];
}

export interface RoutedSearchResult extends SearchResult {
  routeWeight: number;
  routedScore: number;
}

export interface MemoryComponentResult {
  memoryType: MemoryType;
  weight: number;
  hits: RoutedSearchResult[];
}

export interface MultiComponentResult {
  intent: QueryIntent;
  confidence: number;
  routes: MemoryType[];
  components: MemoryComponentResult[];
  combined: RoutedSearchResult[];
  filters: {
    persona: string | null;
    project: string | null;
  };
  durationMs: number;
  notes: string[];
}

export interface MemoryRouterMetrics {
  totalRequests: number;
  averageLatencyMs: number;
  lastLatencyMs: number | null;
  routesPerType: Record<MemoryType, number>;
}

const INTENT_BASE_ROUTES: Record<QueryIntent, MemoryType[]> = {
  persona_lookup: ['persona', 'semantic', 'project'],
  project_lookup: ['project', 'semantic', 'persona'],
  combination_lookup: ['persona', 'project', 'semantic'],
  general_knowledge: ['semantic', 'project', 'persona'],
  workflow_step: ['procedural', 'semantic', 'project'],
  example_request: ['semantic', 'procedural', 'project'],
};

const DEFAULT_MEMORY_WEIGHTS: Record<MemoryType, number> = {
  persona: 1.1,
  project: 1,
  semantic: 0.9,
  episodic: 1.2,
  procedural: 1.05,
};

const DEFAULT_LIMIT_PER_TYPE = 5;
const DEFAULT_MIN_SIMILARITY = 0.2;

const routingMetrics: MemoryRouterMetrics = {
  totalRequests: 0,
  averageLatencyMs: 0,
  lastLatencyMs: null,
  routesPerType: {
    persona: 0,
    project: 0,
    semantic: 0,
    episodic: 0,
    procedural: 0,
  },
};

const heuristicMatchers: RouteHeuristic[] = [
  (query) =>
    /(who am i|what'?s my role|who is .*persona|persona overview|about (?:the )?persona)/.test(
      query,
    )
      ? 'persona'
      : null,
  (query) =>
    /(project|program|initiative|campaign) [a-z0-9_-]+/.test(query) ||
    /project overview/.test(query)
      ? 'project'
      : null,
  (query) =>
    /(what did we (?:discuss|cover)|remember when|last time we spoke|yesterday|earlier today|conversation history|previous chat)/.test(
      query,
    )
      ? 'episodic'
      : null,
  (query) =>
    /(how do i|step-by-step|workflow|process|checklist|procedure|playbook)/.test(query)
      ? 'procedural'
      : null,
  (query) =>
    /(best practice|guideline|strategy|principles|overview|explain|describe)/.test(query)
      ? 'semantic'
      : null,
];

export function routeQuery(query: string, intent: QueryIntent): MemoryType[] {
  const normalizedQuery = query.trim().toLowerCase();
  const baseRoutes = INTENT_BASE_ROUTES[intent] ?? ['semantic', 'project', 'persona'];
  const ordered = dedupe(baseRoutes);

  for (const heuristic of heuristicMatchers) {
    const match = heuristic(normalizedQuery);
    if (match) {
      promoteRoute(ordered, match);
    }
  }

  if (!ordered.includes('semantic')) {
    ordered.push('semantic');
  }

  return ordered;
}

export async function orchestrateMemorySearch(
  query: string,
  options: MemoryRouterOptions = {},
): Promise<MultiComponentResult> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    throw new Error('Query must not be empty.');
  }

  const classify = options.classify ?? classifyQueryIntent;
  const repository: MemoryRouterRepository =
    options.repository ?? (new PromptEmbeddingsRepository() as MemoryRouterRepository);
  const embed = options.embed ?? embedTexts;
  const limitPerType = options.limitPerType ?? DEFAULT_LIMIT_PER_TYPE;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const weights = { ...DEFAULT_MEMORY_WEIGHTS, ...(options.weights ?? {}) };
  const extraNotes = options.notes ?? [];

  const classification = await classify(normalizedQuery);
  const routes = routeQuery(normalizedQuery, classification.intent);

  logRoutingDecision(normalizedQuery, classification, routes);

  const persona = normaliseSlugOptional(classification.extractedPersona) ?? null;
  const project = normaliseSlugOptional(classification.extractedProject) ?? null;
  const filters = { persona, project };

  const [embedding] = await embed([normalizedQuery]);
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Embedding model returned no data.');
  }

  const startedAt = performance.now();
  const searches = routes.map((memoryType) =>
    repository.search({
      embedding,
      limit: limitPerType,
      minSimilarity,
      persona: persona ?? undefined,
      project: project ?? undefined,
      memoryTypes: [memoryType],
    }),
  );

  const results = await Promise.all(searches);
  const durationMs = performance.now() - startedAt;
  updateMetrics(routes, durationMs);

  const components = results.map<MemoryComponentResult>((hits, index) => {
    const memoryType = routes[index];
    const weight = weights[memoryType] ?? 1;
    return {
      memoryType,
      weight,
      hits: hits.map((hit) => ({
        ...hit,
        routeWeight: weight,
        routedScore: hit.similarity * weight,
      })),
    };
  });

  const combined = mergeComponentResults(components);

  return {
    intent: classification.intent,
    confidence: classification.confidence,
    routes,
    components,
    combined,
    filters,
    durationMs,
    notes: buildNotes(filters, routes, extraNotes),
  };
}

export function getMemoryRouterMetrics(): MemoryRouterMetrics {
  return {
    totalRequests: routingMetrics.totalRequests,
    averageLatencyMs: routingMetrics.averageLatencyMs,
    lastLatencyMs: routingMetrics.lastLatencyMs,
    routesPerType: { ...routingMetrics.routesPerType },
  };
}

export function resetMemoryRouterMetrics(): void {
  routingMetrics.totalRequests = 0;
  routingMetrics.averageLatencyMs = 0;
  routingMetrics.lastLatencyMs = null;
  routingMetrics.routesPerType = {
    persona: 0,
    project: 0,
    semantic: 0,
    episodic: 0,
    procedural: 0,
  };
}

function dedupe(types: MemoryType[]): MemoryType[] {
  const seen = new Set<MemoryType>();
  const result: MemoryType[] = [];
  for (const type of types) {
    if (!seen.has(type)) {
      seen.add(type);
      result.push(type);
    }
  }
  return result;
}

function promoteRoute(routes: MemoryType[], target: MemoryType) {
  const index = routes.indexOf(target);
  if (index === 0) {
    return;
  }

  if (index > 0) {
    routes.splice(index, 1);
  }

  routes.unshift(target);
}

function mergeComponentResults(components: MemoryComponentResult[]): RoutedSearchResult[] {
  const merged = new Map<string, RoutedSearchResult>();

  for (const component of components) {
    for (const hit of component.hits) {
      const existing = merged.get(hit.chunkId);
      if (!existing || hit.routedScore > existing.routedScore) {
        merged.set(hit.chunkId, hit);
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.routedScore - a.routedScore);
}

function updateMetrics(routes: MemoryType[], durationMs: number) {
  routingMetrics.totalRequests += 1;
  routingMetrics.lastLatencyMs = durationMs;
  const previousAverage = routingMetrics.averageLatencyMs;
  const count = routingMetrics.totalRequests;
  routingMetrics.averageLatencyMs = previousAverage + (durationMs - previousAverage) / count;

  for (const route of routes) {
    routingMetrics.routesPerType[route] += 1;
  }
}

function logRoutingDecision(
  query: string,
  classification: QueryClassification,
  routes: MemoryType[],
) {
  console.debug('memory_router.route', {
    query,
    intent: classification.intent,
    confidence: classification.confidence,
    routes,
  });
}

function buildNotes(
  filters: { persona: string | null; project: string | null },
  routes: MemoryType[],
  extra: string[],
): string[] {
  const notes: string[] = [...extra];

  if (filters.persona) {
    notes.push(`Applied persona filter "${filters.persona}".`);
  }

  if (filters.project) {
    notes.push(`Applied project filter "${filters.project}".`);
  }

  if (routes.includes('episodic')) {
    notes.push('Included episodic memory for conversation context.');
  }

  if (routes.includes('procedural')) {
    notes.push('Included procedural memory for workflow guidance.');
  }

  if (!notes.includes('Semantic memory provides fallback coverage.')) {
    notes.push('Semantic memory provides fallback coverage.');
  }

  return notes;
}
