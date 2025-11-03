import crypto from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { embedTexts } from '../../vector/embedTexts';
import { config } from '../../config';
import { reciprocalRankFusion } from '../../vector/hybridSearch';
import {
  enhanceQuery as baseEnhanceQuery,
  selectSearchMode,
  type EnhancedQuery,
} from '../../vector/queryEnhancer';
import {
  orchestrateMemorySearch,
  type MultiComponentResult,
  type RoutedSearchResult,
} from '../../vector/memoryRouter';
import {
  PromptEmbeddingsRepository,
  type SearchResult,
  type TemporalDecayOverrides,
} from '../../db/repository';
import { normaliseSlugOptional } from '../../utils/slug';
import { extractToolArgs } from './argUtils';
import type { QueryIntent, QueryClassification } from '../../vector/queryClassifier';

const MEMORY_TYPE_VALUES = ['persona', 'project', 'semantic', 'episodic', 'procedural'] as const;
const MEMORY_LINK_TYPE_VALUES = [
  'similar',
  'related',
  'prerequisite',
  'followup',
  'contrasts',
] as const;
const QUERY_INTENT_VALUES = [
  'persona_lookup',
  'project_lookup',
  'combination_lookup',
  'general_knowledge',
  'workflow_step',
  'example_request',
] as const;

const memoryTypeSchema = z.enum(MEMORY_TYPE_VALUES);
const queryIntentSchema = z.enum(QUERY_INTENT_VALUES);
const memoryLinkTypeSchema = z.enum(MEMORY_LINK_TYPE_VALUES);

const temporalConfigSchema = z
  .object({
    strategy: z.enum(['exponential', 'linear', 'none']).optional(),
    halfLifeDays: z.number().positive().optional(),
    maxAgeDays: z.number().positive().optional(),
  })
  .strict();

const routingDecisionSchema = z.object({
  enabled: z.boolean(),
  source: z.enum(['manual', 'auto', 'disabled']),
  intent: queryIntentSchema,
  confidence: z.number(),
  components: z.array(memoryTypeSchema),
  durationMs: z.number().min(0).optional(),
  notes: z.array(z.string()).optional(),
});

const PROMPT_SEARCH_ARG_KEYS = [
  'query',
  'persona',
  'project',
  'limit',
  'minSimilarity',
  'searchMode',
  'autoFilter',
  'useMemoryRouting',
  'expandGraph',
  'graphMaxHops',
  'graphMinLinkStrength',
  'temporalBoost',
  'temporalConfig',
] as const;

const promptSearchArgsSchema = z.object({
  query: z.string().trim().min(1, 'query must not be empty'),
  persona: z.string().trim().optional(),
  project: z.string().trim().optional(),
  limit: z.number().int().positive().max(50).optional(),
  minSimilarity: z.number().min(0).max(1).optional(),
  searchMode: z.enum(['vector', 'keyword', 'hybrid']).default('hybrid'),
  autoFilter: z.boolean().default(true),
  useMemoryRouting: z.boolean().optional(),
  expandGraph: z.boolean().optional(),
  graphMaxHops: z.number().int().positive().max(5).optional(),
  graphMinLinkStrength: z.number().min(0).max(1).optional(),
  temporalBoost: z.boolean().optional(),
  temporalConfig: temporalConfigSchema.optional(),
});

const inputSchema = promptSearchArgsSchema.superRefine((value, ctx) => {
  if (!value.query) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'query is required',
      fatal: true,
    });
  }
});

const outputSchema = z.object({
  matches: z.array(
    z.object({
      chunkId: z.string(),
      promptKey: z.string(),
      similarity: z.number(),
      metadata: z.record(z.string(), z.unknown()),
      preview: z.string(),
      ageDays: z.number().min(0).nullable(),
      temporalDecayApplied: z.boolean(),
      memoryComponent: memoryTypeSchema,
      originalSimilarity: z.number().optional(),
      routeWeight: z.number().optional(),
      graphContext: z
        .object({
          seedChunkId: z.string(),
          hopCount: z.number().int().min(1),
          linkStrength: z.number().min(0).max(1),
          seedSimilarity: z.number().min(0).max(1),
          seedContribution: z.number().min(0),
          linkContribution: z.number().min(0),
          path: z.array(
            z.object({
              from: z.string(),
              to: z.string(),
              linkType: memoryLinkTypeSchema,
              strength: z.number().min(0).max(1),
            }),
          ),
        })
        .optional(),
    }),
  ),
  appliedFilters: z.object({
    persona: z.string().nullable(),
    project: z.string().nullable(),
    limit: z.number(),
    minSimilarity: z.number(),
    mode: z.enum(['vector', 'keyword', 'hybrid']),
    searchMode: z.enum(['auto', 'manual']),
    auto: z.boolean(),
    autoDetails: z.array(z.string()).optional(),
    temporalDecayApplied: z.boolean(),
    temporalConfig: z.object({
      strategy: z.enum(['none', 'exponential', 'linear']),
      halfLifeDays: z.number().positive(),
      maxAgeDays: z.number().positive(),
      source: z.enum(['auto', 'manual']),
    }),
    graphExpansion: z.object({
      enabled: z.boolean(),
      maxHops: z.number().int().nonnegative(),
      minLinkStrength: z.number().min(0).max(1),
    }),
    memoryRouting: z.boolean(),
    componentsSearched: z.array(memoryTypeSchema),
    routingDecision: routingDecisionSchema,
  }),
  graph: z
    .object({
      nodes: z.array(
        z.object({
          chunkId: z.string(),
          promptKey: z.string(),
          similarity: z.number(),
          hop: z.number().int().min(0),
          memoryComponent: memoryTypeSchema,
        }),
      ),
      edges: z.array(
        z.object({
          from: z.string(),
          to: z.string(),
          linkType: memoryLinkTypeSchema,
          strength: z.number().min(0).max(1),
        }),
      ),
    })
    .nullable(),
});

type PromptSearchInput = z.input<typeof inputSchema>;
type PromptSearchOutput = z.output<typeof outputSchema>;
type PromptSearchRuntimeInput = PromptSearchInput & { modeProvided?: boolean };
type TemporalConfigInput = z.infer<typeof temporalConfigSchema>;

type SearchMode = 'vector' | 'keyword' | 'hybrid';
type MemoryTypeValue = (typeof MEMORY_TYPE_VALUES)[number];
type MemoryLinkType = (typeof MEMORY_LINK_TYPE_VALUES)[number];

type SerializeOverrides = {
  overrideSimilarity?: number;
  originalSimilarity?: number;
  memoryComponent?: MemoryTypeValue;
  routeWeight?: number;
};

interface GraphVisualizationNode {
  chunkId: string;
  promptKey: string;
  similarity: number;
  hop: number;
  memoryComponent: MemoryTypeValue;
}

interface GraphVisualizationEdge {
  from: string;
  to: string;
  linkType: MemoryLinkType;
  strength: number;
}

interface GraphVisualization {
  nodes: GraphVisualizationNode[];
  edges: GraphVisualizationEdge[];
}

interface MemoryRoutingResolution {
  enabled: boolean;
  source: 'manual' | 'auto' | 'disabled';
  preference?: boolean;
}

type RoutingDecision = z.infer<typeof routingDecisionSchema>;

interface SearchContext {
  limit: number;
  minSimilarity: number;
  persona?: string;
  project?: string;
  searchMode: SearchMode;
  autoFilter: boolean;
  temporalBoost?: boolean;
  temporalOverrides: TemporalDecayOverrides | null;
  memoryRoutingPreference?: boolean;
  expandGraph: boolean;
  graphMaxHops: number;
  graphMinLinkStrength: number;
}

interface ResolvedTemporalContext {
  applied: boolean;
  strategy: 'none' | 'exponential' | 'linear';
  halfLifeDays: number;
  maxAgeDays: number;
  source: 'auto' | 'manual';
}

export interface PromptSearchToolDependencies {
  repository?: PromptEmbeddingsRepository;
  embed?: typeof embedTexts;
  enhancer?: typeof baseEnhanceQuery;
  memoryRouter?: typeof orchestrateMemorySearch;
}

export async function searchPrompts(
  repository: PromptEmbeddingsRepository,
  embed: typeof embedTexts,
  args: PromptSearchRuntimeInput,
  enhancer: typeof baseEnhanceQuery = baseEnhanceQuery,
  memoryRouter: typeof orchestrateMemorySearch = orchestrateMemorySearch,
): Promise<PromptSearchOutput> {
  const context = buildSearchParameters(args);
  const temporal = resolveTemporalContext(context);
  const repositoryTemporalConfig: TemporalDecayOverrides = {
    strategy: temporal.strategy,
    halfLifeDays: temporal.halfLifeDays,
    maxAgeDays: temporal.maxAgeDays,
  };
  const modeWasProvided = args.modeProvided === true;
  let autoFiltersApplied = false;
  let autoFilterNotes: string[] = [];
  let enhancedResult: EnhancedQuery | null = null;
  let modeSource: 'auto' | 'manual' = modeWasProvided ? 'manual' : 'manual';

  if (context.autoFilter && !args.persona && !args.project) {
    try {
      const enhanced = await enhancer(args.query, { repository });
      enhancedResult = enhanced;
      if (enhanced.appliedPersona && enhanced.persona) {
        context.persona = enhanced.persona;
        autoFiltersApplied = true;
      }
      if (enhanced.appliedProject && enhanced.project) {
        context.project = enhanced.project;
        autoFiltersApplied = true;
      }
      if (enhanced.notes.length > 0) {
        autoFilterNotes = enhanced.notes;
      }
    } catch (error) {
      console.warn('prompt_search query enhancement failed', error);
      autoFilterNotes.push('Query enhancement failed; proceeding without auto filters.');
    }
  } else if (!context.autoFilter) {
    autoFilterNotes.push('Auto-filter disabled by request.');
  } else if (args.persona || args.project) {
    autoFilterNotes.push('Explicit persona/project filters provided; skipped auto-filter.');
  }

  if (!modeWasProvided && context.autoFilter && config.search.autoMode.enabled) {
    const selectedMode = selectSearchMode(
      args.query,
      enhancedResult?.intent ?? 'general_knowledge',
    );
    context.searchMode = selectedMode;
    modeSource = 'auto';
    autoFilterNotes.push(`Auto-selected search mode "${selectedMode}".`);
  }

  const shouldApplyTemporalDecay = temporal.applied && context.searchMode !== 'keyword';

  const memoryRoutingDecision = resolveMemoryRoutingDecision(
    args.query,
    context.memoryRoutingPreference,
  );

  const classificationOverride =
    memoryRoutingDecision.enabled && enhancedResult
      ? buildClassificationOverride(enhancedResult)
      : undefined;

  let memoryRoutingResult: MultiComponentResult | null = null;
  let memoryRoutingNotes: string[] = [];
  let memoryRoutingAttempted = false;

  if (memoryRoutingDecision.enabled) {
    memoryRoutingAttempted = true;
    try {
      const baseNotes = collectMemoryRoutingNotes(autoFilterNotes, memoryRoutingDecision.source);
      memoryRoutingResult = await memoryRouter(args.query, {
        repository,
        embed,
        classify: classificationOverride,
        limitPerType: context.limit,
        minSimilarity: context.minSimilarity,
        notes: baseNotes,
      });
      memoryRoutingNotes = memoryRoutingResult.notes;

      if (!context.persona && memoryRoutingResult.filters.persona) {
        context.persona = memoryRoutingResult.filters.persona;
      }

      if (!context.project && memoryRoutingResult.filters.project) {
        context.project = memoryRoutingResult.filters.project;
      }
    } catch (error) {
      console.warn('prompt_search memory routing failed', error);
      memoryRoutingNotes = [
        ...autoFilterNotes,
        'Memory routing attempt failed; falling back to configured search mode.',
      ];
    }
  }

  const filters = {
    persona: context.persona,
    project: context.project,
  };

  let finalMatches: Array<ReturnType<typeof serializeMatch>> = [];
  let temporalApplied = shouldApplyTemporalDecay;
  let matches: SearchResult[] = [];
  let graphVisualization: GraphVisualization | null = null;

  if (memoryRoutingResult) {
    const combined = memoryRoutingResult.combined.slice(0, context.limit);
    finalMatches = combined.map((match) =>
      serializeMatch(match, {
        overrideSimilarity: match.routedScore,
        originalSimilarity: match.similarity,
        memoryComponent: match.memoryType,
        routeWeight: match.routeWeight,
      }),
    );
    temporalApplied = false;
  } else if (context.searchMode === 'keyword') {
    matches = await repository.keywordSearch(args.query, filters, {
      limit: context.limit,
    });
  } else if (context.searchMode === 'vector') {
    const [embedding] = await embed([args.query]);
    matches = await repository.searchWithGraphExpansion({
      embedding,
      limit: context.limit,
      minSimilarity: context.minSimilarity,
      persona: context.persona,
      project: context.project,
      applyTemporalDecay: temporalApplied,
      temporalDecayConfig: repositoryTemporalConfig,
      expandGraph: context.expandGraph,
      graphMaxHops: context.graphMaxHops,
      graphMinLinkStrength: context.graphMinLinkStrength,
    });
  } else {
    const [embedding] = await embed([args.query]);
    const [vectorResults, keywordResults] = await Promise.all([
      repository.searchWithGraphExpansion({
        embedding,
        limit: context.limit,
        minSimilarity: context.minSimilarity,
        persona: context.persona,
        project: context.project,
        applyTemporalDecay: temporalApplied,
        temporalDecayConfig: repositoryTemporalConfig,
        expandGraph: context.expandGraph,
        graphMaxHops: context.graphMaxHops,
        graphMinLinkStrength: context.graphMinLinkStrength,
      }),
      repository.keywordSearch(args.query, filters, { limit: context.limit }),
    ]);

    matches = reciprocalRankFusion([vectorResults, keywordResults], {
      k: config.search.hybrid.rrfK,
      weights: [config.search.hybrid.vectorWeight, config.search.hybrid.keywordWeight],
      maxResults: context.limit,
    });
  }

  if (!memoryRoutingResult) {
    const processed = applySimilarityThreshold(matches, context, temporalApplied);
    finalMatches = processed.map((match) => serializeMatch(match));
    if (context.expandGraph) {
      graphVisualization = buildGraphVisualization(finalMatches);
    }
  }

  const routingDecision = buildRoutingDecision({
    result: memoryRoutingResult,
    decision: memoryRoutingDecision,
    intentFallback: enhancedResult?.intent ?? 'general_knowledge',
    confidenceFallback: enhancedResult?.confidence ?? 0,
    notes: memoryRoutingNotes,
  });

  const routingNote = summariseRoutingNote(routingDecision);
  if (routingNote) {
    autoFilterNotes = ensureAutoDetails(autoFilterNotes, routingNote);
  }

  return {
    matches: finalMatches,
    appliedFilters: {
      persona: context.persona ?? null,
      project: context.project ?? null,
      limit: context.limit,
      minSimilarity: context.minSimilarity,
      mode: context.searchMode,
      searchMode: modeSource,
      auto: autoFiltersApplied,
      autoDetails: autoFilterNotes.length > 0 ? autoFilterNotes : undefined,
      temporalDecayApplied: temporalApplied,
      temporalConfig: {
        strategy: temporalApplied ? temporal.strategy : 'none',
        halfLifeDays: temporal.halfLifeDays,
        maxAgeDays: temporal.maxAgeDays,
        source: temporal.source,
      },
      graphExpansion: {
        enabled: context.expandGraph,
        maxHops: context.expandGraph ? context.graphMaxHops : 0,
        minLinkStrength: context.expandGraph ? context.graphMinLinkStrength : 0,
      },
      memoryRouting: routingDecision.enabled,
      componentsSearched: routingDecision.components,
      routingDecision,
    },
    graph: graphVisualization,
  };
}

export function registerPromptSearchTool(
  server: McpServer,
  dependencies: PromptSearchToolDependencies = {},
): void {
  let repository = dependencies.repository;
  const embed = dependencies.embed ?? embedTexts;
  const enhancer = dependencies.enhancer ?? baseEnhanceQuery;
  const memoryRouterFn = dependencies.memoryRouter ?? orchestrateMemorySearch;
  const toolName = 'prompt_search';

  server.registerTool(
    toolName,
    {
      title: 'Search prompt corpus semantically',
      description: [
        'Swiss-army retrieval across the entire prompt corpus: vector, keyword, or hybrid modes in one tool.',
        'Layer on persona/project filters, temporal decay, graph expansion, and memory routing to surface the most relevant snippets.',
        'Returns ranked chunks with previews, similarity scores, and diagnostics so you know why each result appeared.',
        '',
        '## Self-Discovery Pattern',
        'Use this tool to discover YOUR OWN instructions and configuration:',
        '- Query for your workflow: "[your-persona] [your-project] workflow" (e.g., "ideagenerator aismr workflow")',
        '- Look for results where metadata.persona and metadata.project match your identity',
        '- After finding relevant chunks, use prompt_get with the identified persona+project to load full content',
        '',
        '## Discovery Queries',
        '- "[persona] [project] workflow" → your task-specific instructions',
        '- "[project] timing specifications" → project constraints and rules',
        '- "successful [project] ideas" → examples and patterns to follow',
        '- "[project] validation rules" → constraints and requirements',
        '- "rejected [project] concepts" → anti-patterns to avoid',
      ].join('\n'),
      inputSchema: promptSearchArgsSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: {
        category: 'prompts',
      },
    },
    async (rawArgs: unknown) => {
      let args: PromptSearchInput;

      try {
        const extracted = extractToolArgs(rawArgs, {
          allowedKeys: PROMPT_SEARCH_ARG_KEYS,
        });
        args = inputSchema.parse(extracted);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to parse prompt_search arguments.';
        return {
          content: [
            {
              type: 'text' as const,
              text: `prompt_search validation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        if (!repository) {
          repository = new PromptEmbeddingsRepository();
        }

        const raw = (rawArgs ?? {}) as Record<string, unknown>;
        const modeProvided = Object.prototype.hasOwnProperty.call(raw, 'searchMode');
        const runtimeArgs: PromptSearchRuntimeInput = { ...args, modeProvided };

        const result = await searchPrompts(
          repository,
          embed,
          runtimeArgs,
          enhancer,
          memoryRouterFn,
        );

        const autoFilterSummary =
          result.appliedFilters.auto &&
          (result.appliedFilters.persona || result.appliedFilters.project)
            ? summarizeFilters(result.appliedFilters.persona, result.appliedFilters.project)
            : null;

        const responseText =
          result.matches.length === 0
            ? [
                `No matches found for "${args.query}".`,
                `Search mode: ${result.appliedFilters.mode} (${result.appliedFilters.searchMode})`,
                autoFilterSummary ? `Auto filters: ${autoFilterSummary}` : null,
              ]
                .filter((line): line is string => Boolean(line))
                .join('\n')
            : (() => {
                const lines = [
                  `Found ${result.matches.length} match${result.matches.length === 1 ? '' : 'es'} for "${args.query}"`,
                  `Search mode: ${result.appliedFilters.mode} (${result.appliedFilters.searchMode})`,
                ];

                if (autoFilterSummary) {
                  lines.push(`Auto filters: ${autoFilterSummary}`);
                }

                lines.push(
                  `Top hit: ${result.matches[0].promptKey} (similarity: ${result.matches[0].similarity.toFixed(3)})`,
                  '',
                  'To get full prompt content, use:',
                  `prompt_get({"persona_name": "${result.matches[0].metadata.persona || ''}", "project_name": "${result.matches[0].metadata.project || ''}"})`,
                  '',
                  'All matches available in structured response under matches[]',
                );

                return lines.join('\n');
              })();

        return {
          content: [
            {
              type: 'text' as const,
              text: responseText,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error during semantic search.';
        console.error('prompt_search failed', error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `prompt_search failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  console.info('[MCP] Tool registered:', toolName);
}

function buildSearchParameters(args: PromptSearchRuntimeInput): SearchContext {
  const searchMode = args.searchMode ?? 'hybrid';
  const limit = clamp(args.limit ?? 10, 1, 50);
  const defaultMinSimilarity = searchMode === 'vector' ? 0.3 : 0;
  const minSimilarity = clamp(args.minSimilarity ?? defaultMinSimilarity, 0, 1);
  const expandGraph = args.expandGraph ?? false;
  const graphMaxHops = clamp(Math.floor(args.graphMaxHops ?? 2) || 1, 1, 5);
  const graphMinLinkStrength = clamp(
    typeof args.graphMinLinkStrength === 'number'
      ? args.graphMinLinkStrength
      : config.memoryGraph.minStrength,
    0,
    1,
  );

  return {
    limit,
    minSimilarity,
    persona: normaliseSlugOptional(args.persona),
    project: normaliseSlugOptional(args.project),
    searchMode,
    autoFilter: args.autoFilter ?? true,
    temporalBoost: args.temporalBoost,
    temporalOverrides: normalizeTemporalOverrides(args.temporalConfig),
    memoryRoutingPreference: args.useMemoryRouting,
    expandGraph,
    graphMaxHops,
    graphMinLinkStrength,
  };
}

function normalizeTemporalOverrides(
  config: TemporalConfigInput | undefined,
): TemporalDecayOverrides | null {
  if (!config) {
    return null;
  }

  const overrides: TemporalDecayOverrides = {};

  if (config.strategy) {
    overrides.strategy = config.strategy;
  }

  if (config.halfLifeDays !== undefined) {
    overrides.halfLifeDays = config.halfLifeDays;
  }

  if (config.maxAgeDays !== undefined) {
    overrides.maxAgeDays = config.maxAgeDays;
  }

  return overrides;
}

function resolveTemporalContext(context: SearchContext): ResolvedTemporalContext {
  const defaults = config.search.temporal;
  const overrides = context.temporalOverrides;
  const rawStrategy = overrides?.strategy ?? defaults.strategy;
  const normalizedStrategy =
    rawStrategy === 'exponential' || rawStrategy === 'linear' ? rawStrategy : 'none';

  const apply = (context.temporalBoost ?? defaults.enabled) && normalizedStrategy !== 'none';

  const halfLifeDays = sanitizePositive(overrides?.halfLifeDays, defaults.halfLifeDays);
  const maxAgeDays = sanitizePositive(overrides?.maxAgeDays, defaults.maxAgeDays);

  return {
    applied: apply,
    strategy: apply ? normalizedStrategy : 'none',
    halfLifeDays,
    maxAgeDays,
    source: context.temporalBoost !== undefined || overrides !== null ? 'manual' : 'auto',
  };
}

function sanitizePositive(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

function serializeMatch(match: SearchResult, overrides: SerializeOverrides = {}) {
  const ageDays =
    match.ageDays == null || Number.isNaN(Number(match.ageDays))
      ? null
      : Math.max(0, Number(match.ageDays));

  const similarity = overrides.overrideSimilarity ?? Number(match.similarity);
  const originalSimilarity = overrides.originalSimilarity ?? Number(match.similarity);
  const memoryComponent = overrides.memoryComponent ?? (match.memoryType as MemoryTypeValue);
  const graph = match.graphContext
    ? {
        seedChunkId: match.graphContext.seedChunkId,
        hopCount: match.graphContext.hopCount,
        linkStrength: match.graphContext.linkStrength,
        seedSimilarity: match.graphContext.seedSimilarity,
        seedContribution: match.graphContext.seedContribution,
        linkContribution: match.graphContext.linkContribution,
        path: match.graphContext.path,
      }
    : undefined;

  return {
    chunkId: match.chunkId,
    promptKey: match.promptKey,
    similarity,
    metadata: (match.metadata ?? {}) as Record<string, unknown>,
    preview: buildPreview(match.chunkText),
    ageDays,
    temporalDecayApplied: Boolean(match.temporalDecayApplied),
    memoryComponent,
    originalSimilarity,
    routeWeight: overrides.routeWeight,
    graphContext: graph,
  };
}

function applySimilarityThreshold(
  matches: SearchResult[],
  context: SearchContext,
  temporalApplied: boolean,
): SearchResult[] {
  if (matches.length === 0) {
    return matches;
  }

  if (context.searchMode === 'hybrid') {
    return matches;
  }

  if (context.searchMode === 'vector' && temporalApplied) {
    return matches;
  }

  const min = context.minSimilarity;
  return matches.filter((match) => Number(match.similarity) >= min);
}

function collectMemoryRoutingNotes(
  baseNotes: string[],
  source: MemoryRoutingResolution['source'],
): string[] {
  const notes = [...baseNotes];

  if (source === 'manual') {
    notes.push('Memory routing enabled manually.');
  } else if (source === 'auto') {
    notes.push('Memory routing enabled automatically via rollout.');
  }

  return dedupeNotes(notes);
}

function buildGraphVisualization(
  matches: Array<ReturnType<typeof serializeMatch>>,
): GraphVisualization | null {
  if (matches.length === 0) {
    return null;
  }

  const nodes = new Map<string, GraphVisualizationNode>();
  const edges = new Map<string, GraphVisualizationEdge>();

  for (const match of matches) {
    const hop = match.graphContext?.hopCount ?? 0;
    if (!nodes.has(match.chunkId)) {
      nodes.set(match.chunkId, {
        chunkId: match.chunkId,
        promptKey: match.promptKey,
        similarity: match.similarity,
        hop,
        memoryComponent: match.memoryComponent,
      });
    }

    const context = match.graphContext;
    if (!context) {
      continue;
    }

    for (const step of context.path) {
      const key = `${step.from}->${step.to}:${step.linkType}`;
      if (!edges.has(key)) {
        edges.set(key, {
          from: step.from,
          to: step.to,
          linkType: step.linkType,
          strength: step.strength,
        });
      }
    }
  }

  if (nodes.size === 0) {
    return null;
  }

  return {
    nodes: Array.from(nodes.values()).sort((a, b) => {
      if (a.hop !== b.hop) {
        return a.hop - b.hop;
      }
      return b.similarity - a.similarity;
    }),
    edges: Array.from(edges.values()),
  };
}

function resolveMemoryRoutingDecision(
  query: string,
  preference: boolean | undefined,
): MemoryRoutingResolution {
  if (preference === true) {
    return { enabled: true, source: 'manual', preference: true };
  }

  if (preference === false) {
    return { enabled: false, source: 'manual', preference: false };
  }

  const settings = config.search.memoryRouting;
  if (!settings.enabled) {
    return { enabled: false, source: 'disabled' };
  }

  const rolloutValue = hashToRolloutPercentage(query);
  const enabled = rolloutValue < settings.rolloutPct;

  return {
    enabled,
    source: enabled ? 'auto' : 'disabled',
  };
}

function buildClassificationOverride(enhanced: EnhancedQuery) {
  return async (): Promise<QueryClassification> => ({
    intent: enhanced.intent,
    extractedPersona: enhanced.persona,
    extractedProject: enhanced.project,
    confidence: enhanced.confidence,
  });
}

function buildRoutingDecision(params: {
  result: MultiComponentResult | null;
  decision: MemoryRoutingResolution;
  intentFallback: QueryIntent;
  confidenceFallback: number;
  notes: string[];
}): RoutingDecision {
  const { result, decision, intentFallback, confidenceFallback, notes } = params;

  if (result) {
    const duration = result.durationMs ?? 0;
    const normalizedNotes = dedupeNotes(result.notes);
    return {
      enabled: true,
      source: decision.source,
      intent: result.intent,
      confidence: result.confidence,
      components: result.routes.map((route) => route as MemoryTypeValue),
      durationMs: duration >= 0 ? duration : 0,
      notes: normalizedNotes.length > 0 ? normalizedNotes : undefined,
    };
  }

  const normalizedNotes = dedupeNotes(notes);
  return {
    enabled: false,
    source: decision.source,
    intent: intentFallback,
    confidence: confidenceFallback,
    components: [],
    notes: normalizedNotes.length > 0 ? normalizedNotes : undefined,
  };
}

function summariseRoutingNote(decision: RoutingDecision): string | null {
  if (decision.enabled) {
    if (decision.source === 'manual') {
      return 'Memory routing enabled manually.';
    }
    if (decision.source === 'auto') {
      return 'Memory routing enabled automatically via rollout.';
    }
    return null;
  }

  if (decision.source === 'manual') {
    return 'Memory routing disabled manually.';
  }

  return null;
}

function ensureAutoDetails(existing: string[], message: string): string[] {
  if (existing.includes(message)) {
    return existing;
  }
  return [...existing, message];
}

function dedupeNotes(notes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const note of notes) {
    if (!note || seen.has(note)) {
      continue;
    }
    seen.add(note);
    result.push(note);
  }
  return result;
}

function hashToRolloutPercentage(input: string): number {
  const digest = crypto.createHash('sha256').update(input).digest();
  const value = digest.readUInt16BE(0);
  return (value / 0xffff) * 100;
}

function summarizeFilters(persona: string | null, project: string | null): string {
  const parts: string[] = [];
  if (persona) {
    parts.push(`persona=${persona}`);
  }
  if (project) {
    parts.push(`project=${project}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'none';
}

function buildPreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177)}...`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
