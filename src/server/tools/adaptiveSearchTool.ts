import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import type { MemoryType } from '../../db/schema';
import { PromptEmbeddingsRepository } from '../../db/repository';
import {
  adaptiveSearch,
  type AdaptiveSearchParams,
  type AdaptiveSearchOptions,
  type SearchMode,
} from '../../vector/retrievalOrchestrator';
import { embedTexts } from '../../vector/embedTexts';
import type { QueryIntent } from '../../vector/queryClassifier';

const INPUT_SEARCH_MODE_VALUES = ['vector', 'keyword', 'hybrid'] as const;
const OUTPUT_SEARCH_MODE_VALUES = [...INPUT_SEARCH_MODE_VALUES, 'multi-hop'] as const;
const MEMORY_TYPE_VALUES = ['persona', 'project', 'semantic', 'episodic', 'procedural'] as const;
const DECISION_VALUES = ['yes', 'no', 'maybe'] as const;
const TEMPORAL_FOCUS_VALUES = ['recent', 'historical', 'any'] as const;
const QUERY_INTENT_VALUES = [
  'persona_lookup',
  'project_lookup',
  'combination_lookup',
  'general_knowledge',
  'workflow_step',
  'example_request',
] as const;

const isoDateSchema = z
  .string()
  .datetime({ offset: true, message: 'Expected ISO 8601 timestamp with offset' });

const adaptiveSearchArgsSchema = z
  .object({
    query: z.string().trim().min(1, 'query must not be empty'),
    summary: z.string().trim().optional(),
    context: z.string().trim().optional(),
    knownFacts: z.array(z.string().trim().min(1)).max(20).optional(),
    missingInformation: z.array(z.string().trim().min(1)).max(20).optional(),
    ambiguitySignals: z.array(z.string().trim().min(1)).max(20).optional(),
    safetyCritical: z.boolean().optional(),
    lastRetrievedAt: isoDateSchema.optional(),
    intent: z.enum(QUERY_INTENT_VALUES).optional(),
    persona: z.string().trim().optional(),
    project: z.string().trim().optional(),
    memoryTypes: z.array(z.enum(MEMORY_TYPE_VALUES)).optional(),
    keywords: z.array(z.string().trim().min(1)).max(20).optional(),
    temporalFocus: z.enum(TEMPORAL_FOCUS_VALUES).optional(),
    maxIterations: z.number().int().positive().max(5).optional(),
    utilityThreshold: z.number().min(0).max(1).optional(),
    limit: z.number().int().positive().max(50).optional(),
    minSimilarity: z.number().min(0).max(1).optional(),
    initialMode: z.enum(INPUT_SEARCH_MODE_VALUES).optional(),
    searchModes: z.array(z.enum(INPUT_SEARCH_MODE_VALUES)).min(1).max(3).optional(),
    enableMultiHop: z.boolean().optional(),
    maxHops: z.number().int().nonnegative().max(5).optional(),
    multiHopMaxResultsPerHop: z.number().int().positive().max(10).optional(),
  })
  .strict();

const iterationSchema = z.object({
  iteration: z.number().int().positive(),
  query: z.string(),
  searchMode: z.enum(OUTPUT_SEARCH_MODE_VALUES),
  utility: z.number(),
  durationMs: z.number(),
  notes: z.array(z.string()),
  resultCount: z.number().int().nonnegative(),
});

const resultSchema = z.object({
  chunkId: z.string(),
  promptKey: z.string(),
  preview: z.string(),
  similarity: z.number(),
  metadata: z.record(z.string(), z.unknown()),
  memoryType: z.enum(MEMORY_TYPE_VALUES),
  foundAtIteration: z.number().int().positive(),
  searchMode: z.enum(OUTPUT_SEARCH_MODE_VALUES),
  aggregatedScore: z.number().optional(),
  route: z.array(z.string()).optional(),
  hop: z.number().int().nonnegative().optional(),
});

const decisionSchema = z.object({
  decision: z.enum(DECISION_VALUES),
  confidence: z.number(),
  rationale: z.string(),
  safetyOverride: z.boolean(),
  metrics: z.object({
    knowledgeSufficiency: z.number(),
    freshnessRisk: z.number(),
    ambiguity: z.number(),
  }),
});

const adaptiveSearchOutputSchema = z.object({
  decision: decisionSchema,
  retrieved: z.boolean(),
  finalUtility: z.number(),
  totalDurationMs: z.number(),
  iterations: z.array(iterationSchema),
  results: z.array(resultSchema),
});

type AdaptiveSearchInput = z.infer<typeof adaptiveSearchArgsSchema>;
type AdaptiveSearchOutput = z.infer<typeof adaptiveSearchOutputSchema>;

export interface AdaptiveSearchToolDependencies {
  repository?: PromptEmbeddingsRepository;
  embed?: typeof embedTexts;
  orchestrator?: typeof adaptiveSearch;
  timeoutMs?: number;
}

const DEFAULT_PREVIEW_LENGTH = 260;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ITERATIONS = 3;

export async function runAdaptiveSearch(
  args: AdaptiveSearchInput,
  dependencies: AdaptiveSearchToolDependencies = {},
): Promise<AdaptiveSearchOutput> {
  const repository = dependencies.repository ?? new PromptEmbeddingsRepository();
  const embed = dependencies.embed ?? embedTexts;
  const orchestrator = dependencies.orchestrator ?? adaptiveSearch;

  const params: AdaptiveSearchParams = {
    summary: args.summary ?? args.context,
    knownFacts: args.knownFacts,
    missingInformation: args.missingInformation,
    ambiguitySignals: args.ambiguitySignals,
    safetyCritical: args.safetyCritical,
    lastRetrievedAt: args.lastRetrievedAt,
    intent: args.intent as QueryIntent | undefined,
    persona: args.persona ?? null,
    project: args.project ?? null,
    memoryTypes: args.memoryTypes as MemoryType[] | undefined,
    keywords: args.keywords,
    temporalFocus: args.temporalFocus,
  };

  const options: AdaptiveSearchOptions = {
    repository,
    embed,
    maxIterations: args.maxIterations,
    utilityThreshold: args.utilityThreshold,
    limit: args.limit,
    minSimilarity: args.minSimilarity,
    initialMode: args.initialMode as SearchMode | undefined,
    searchModes: args.searchModes as SearchMode[] | undefined,
    enableMultiHop: args.enableMultiHop,
    multiHopMaxHops: args.maxHops,
    multiHopMaxResultsPerHop: args.multiHopMaxResultsPerHop,
  };

  const result = await orchestrator(args.query, params, options);

  const iterations = result.iterations.map((iteration) => ({
    iteration: iteration.iteration,
    query: iteration.query,
    searchMode: iteration.searchMode,
    utility: iteration.utility,
    durationMs: iteration.durationMs,
    notes: iteration.notes,
    resultCount: iteration.results.length,
  }));

  const matches = result.results.map((match) => ({
    chunkId: match.chunkId,
    promptKey: match.promptKey,
    preview: buildPreview(match.chunkText ?? '', match.rawSource ?? ''),
    similarity: match.similarity,
    metadata: (match.metadata ?? {}) as Record<string, unknown>,
    memoryType: match.memoryType,
    foundAtIteration: match.foundAtIteration,
    searchMode: match.searchMode,
    aggregatedScore: match.aggregatedScore,
    route: match.route,
    hop: match.hop,
  }));

  return {
    decision: result.decision,
    retrieved: result.retrieved,
    finalUtility: result.finalUtility,
    totalDurationMs: result.totalDurationMs,
    iterations,
    results: matches,
  };
}

export const ADAPTIVE_SEARCH_TOOL_NAME = 'prompts_search_adaptive';

export function registerAdaptiveSearchTool(
  server: McpServer,
  dependencies: AdaptiveSearchToolDependencies = {},
): void {
  server.registerTool(
    ADAPTIVE_SEARCH_TOOL_NAME,
    {
      title: 'Adaptive prompt search with iterative retrieval',
      description: [
        'Runs the adaptive retrieval controller to decide if and how to search for prompts.',
        'Supports iterative refinement, hybrid search modes, multi-hop expansion, and telemetry for each iteration.',
        'Use when a query may require multiple retrieval passes or confidence scoring.',
      ].join('\n'),
      annotations: {
        category: 'search',
      },
    },
    async (rawArgs: unknown) => {
      let args: AdaptiveSearchInput;
      try {
        args = adaptiveSearchArgsSchema.parse(rawArgs ?? {});
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to parse prompts_search_adaptive args.';
        return buildErrorResponse(message, [
          'Ensure query is a non-empty string.',
          'maxIterations must be between 1 and 5.',
          'utilityThreshold must be between 0 and 1.',
          'limit must be between 1 and 50.',
          'Use ISO 8601 timestamps (with timezone) for lastRetrievedAt.',
        ]);
      }

      const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const startedAt = Date.now();

      try {
        const operation = runAdaptiveSearch(args, dependencies);
        const output = await withTimeout(operation, timeoutMs);

        const totalDuration = Date.now() - startedAt;
        const iterationCount = output.iterations.length;

        console.info('adaptive_search.success', {
          querySnippet: args.query.slice(0, 120),
          iterations: iterationCount,
          finalUtility: Number(output.finalUtility.toFixed(3)),
          totalDurationMs: totalDuration,
        });

        const maxIterations = args.maxIterations ?? DEFAULT_MAX_ITERATIONS;
        if (iterationCount >= maxIterations) {
          console.warn('adaptive_search.max_iterations_reached', {
            querySnippet: args.query.slice(0, 120),
            iterations: iterationCount,
            maxIterations,
          });
        }

        const parsedOutput = adaptiveSearchOutputSchema.parse(output);
        const summary = [
          '✅ Adaptive search completed.',
          `Iterations: ${iterationCount}`,
          `Final utility: ${parsedOutput.finalUtility.toFixed(3)}`,
        ].join(' ');

        return {
          content: [
            {
              type: 'text' as const,
              text: summary,
            },
          ],
          structuredContent: parsedOutput,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected adaptive search failure.';

        console.error('adaptive_search.error', {
          querySnippet: args.query.slice(0, 120),
          message,
        });

        return buildErrorResponse(message, [
          'Verify the query is suitable for retrieval.',
          'If the issue persists, consider lowering maxIterations or adjusting utilityThreshold.',
        ]);
      }
    },
  );
}

function buildPreview(chunkText: string, rawSource: string, maxLength: number = DEFAULT_PREVIEW_LENGTH): string {
  const source = chunkText?.trim().length ? chunkText : rawSource;
  if (!source) {
    return '';
  }
  if (source.length <= maxLength) {
    return source;
  }
  return `${source.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildErrorResponse(message: string, suggestions: string[]) {
  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `❌ prompts_search_adaptive failed: ${message}`,
          '',
          '💡 Common fixes:',
          ...suggestions.map((suggestion) => `  • ${suggestion}`),
        ].join('\n'),
      },
    ],
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Adaptive search timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
