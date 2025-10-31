import { describe, expect, it, vi } from 'vitest';
import type { PromptEmbeddingsRepository, SearchResult } from '../db/repository';
import type { MemoryType } from '../db/schema';
import type { RetrievalDecision } from './retrievalDecisionAgent';
import {
  adaptiveSearch,
  refineQuery,
  type AdaptiveSearchParams,
  type AdaptiveSearchOptions,
  type SearchMode,
} from './retrievalOrchestrator';

describe('adaptiveSearch', () => {
  it('returns single-iteration results when utility threshold is met', async () => {
    const decision = createDecision({ decision: 'yes', confidence: 0.9 });
    const decisionFn = vi.fn().mockResolvedValue(decision);

    const highResults = [createResult('chunk-1', 'prompt-a', 0.88)];
    const repository = createRepositoryStub({
      search: vi.fn().mockResolvedValue(highResults),
      keywordSearch: vi.fn().mockResolvedValue([]),
    });

    const embed = vi.fn(async (inputs: string[]) =>
      inputs.map(() => [0.42, 0.13, 0.66]),
    );

    const result = await adaptiveSearch(
      'latest ais updates',
      {},
      {
        repository,
        embed,
        shouldRetrieveFn: decisionFn,
        utilityThreshold: 0.6,
      },
    );

    expect(result.retrieved).toBe(true);
    expect(result.iterations).toHaveLength(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.foundAtIteration).toBe(1);
    expect(result.finalUtility).toBeGreaterThan(0.6);
    expect(result.decision).toEqual(decision);
    expect(repository.search).toHaveBeenCalledTimes(1);
  });

  it('refines query across iterations and improves utility', async () => {
    const decisionFn = vi.fn().mockResolvedValue(createDecision({ decision: 'yes' }));

    const firstIterationResults = [createResult('chunk-1', 'prompt-a', 0.32, { tags: ['phase'] })];
    const secondIterationResults = [
      createResult('chunk-1', 'prompt-a', 0.9),
      createResult('chunk-2', 'prompt-b', 0.82),
    ];

    const repository = createRepositoryStub({
      search: vi.fn(async ({ embedding }) => {
        const key = Number(embedding[0]);
        if (key === 0.1) {
          return firstIterationResults;
        }
        if (key === 0.9) {
          return secondIterationResults;
        }
        return [];
      }),
      keywordSearch: vi.fn().mockResolvedValue([]),
    });

    const embed = vi.fn(async (inputs: string[]) =>
      inputs.map((input) => (input.includes('phase') ? [0.9] : [0.1])),
    );

    const result = await adaptiveSearch(
      'initial question',
      {},
      {
        repository,
        embed,
        shouldRetrieveFn: decisionFn,
        searchModes: ['vector'],
        utilityThreshold: 0.75,
        maxIterations: 3,
        limit: 2,
      },
    );

    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[0]?.utility).toBeLessThan(0.75);
    expect(result.iterations[1]?.utility).toBeGreaterThanOrEqual(0.75);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.foundAtIteration).toBe(2);
    expect(result.results[0]?.searchMode).toBe('vector');
    expect(repository.search).toHaveBeenCalledTimes(2);
  });

  it('respects iteration limit and stops when no refinements available', async () => {
    const decisionFn = vi.fn().mockResolvedValue(createDecision({ decision: 'yes' }));

    const repository = createRepositoryStub({
      search: vi.fn().mockResolvedValue([createResult('chunk-1', 'prompt-a', 0.25)]),
      keywordSearch: vi.fn().mockResolvedValue([]),
    });

    const embed = vi.fn(async (inputs: string[]) => inputs.map(() => [0.5]));

    const result = await adaptiveSearch(
      'static query',
      {},
      {
        repository,
        embed,
        shouldRetrieveFn: decisionFn,
        maxIterations: 1,
        utilityThreshold: 0.8,
      },
    );

    expect(result.iterations).toHaveLength(1);
    expect(result.finalUtility).toBeLessThan(0.8);
    expect(repository.search).toHaveBeenCalledTimes(1);
  });

  it('executes multi-hop expansion when enabled', async () => {
    const decisionFn = vi.fn().mockResolvedValue(createDecision({ decision: 'yes' }));

    const baseResult = createResult('chunk-1', 'prompt-a', 0.4);
    const repository = createRepositoryStub({
      search: vi.fn().mockResolvedValue([baseResult]),
      keywordSearch: vi.fn().mockResolvedValue([]),
    });

    const embed = vi.fn(async (inputs: string[]) => inputs.map(() => [0.2]));

    const multiHopFn = vi.fn().mockResolvedValue({
      hops: [
        {
          hop: 0,
          query: 'initial query',
          results: [baseResult],
          references: [],
          durationMs: 5,
        },
        {
          hop: 1,
          query: 'project aismr overview',
          results: [createResult('project-aismr', 'project', 0.6)],
          references: [],
          durationMs: 7,
        },
      ],
      aggregated: [
        {
          ...createResult('project-aismr', 'project', 0.6),
          aggregatedScore: 0.3,
          hop: 1,
          route: ['initial query', 'project aismr overview'],
        },
      ],
      totalReferences: 0,
      maxHopReached: 1,
    });

    const result = await adaptiveSearch(
      'initial query',
      {},
      {
        repository,
        embed,
        shouldRetrieveFn: decisionFn,
        enableMultiHop: true,
        multiHopFn,
        multiHopMaxHops: 1,
        maxIterations: 3,
        limit: 3,
      },
    );

    expect(multiHopFn).toHaveBeenCalledTimes(1);
    expect(result.iterations.some((log) => log.searchMode === 'multi-hop')).toBe(true);
    const multiHopHit = result.results.find((hit) => hit.searchMode === 'multi-hop');
    expect(multiHopHit).toBeDefined();
    expect(multiHopHit?.route).toEqual(['initial query', 'project aismr overview']);
    expect(multiHopHit?.foundAtIteration).toBe(2);
    expect(multiHopHit?.aggregatedScore).toBeCloseTo(0.3, 5);
  });
});

describe('refineQuery', () => {
  it('removes quotes and adds overview when no results provided', () => {
    const refined = refineQuery('"Latest updates"', []);
    expect(refined.includes('overview')).toBe(true);
    expect(refined.includes('"')).toBe(false);
  });

  it('appends metadata keywords from results', () => {
    const results = [
      createResult('chunk-1', 'prompt-a', 0.7, {
        tags: ['temporal weighting'],
        persona: ['screenwriter'],
      }),
    ];

    const refined = refineQuery('temporal decay', results);
    expect(refined.toLowerCase()).toContain('screenwriter');
    expect(refined.toLowerCase()).toContain('temporal weighting');
  });
});

function createDecision(
  overrides: Partial<Omit<RetrievalDecision, 'metrics'>> & {
    metrics?: Partial<RetrievalDecision['metrics']>;
  },
): RetrievalDecision {
  return {
    decision: overrides.decision ?? 'yes',
    confidence: overrides.confidence ?? 0.8,
    rationale: overrides.rationale ?? 'Default rationale.',
    safetyOverride: overrides.safetyOverride ?? false,
    metrics: {
      knowledgeSufficiency: overrides.metrics?.knowledgeSufficiency ?? 0.4,
      freshnessRisk: overrides.metrics?.freshnessRisk ?? 0.6,
      ambiguity: overrides.metrics?.ambiguity ?? 0.5,
    },
  };
}

function createResult(
  chunkId: string,
  promptKey: string,
  similarity: number,
  metadata: Record<string, unknown> = {},
): SearchResult {
  return {
    chunkId,
    promptKey,
    chunkText: 'Sample chunk',
    rawSource: 'Sample source',
    metadata,
    similarity,
    ageDays: null,
    temporalDecayApplied: false,
    memoryType: 'semantic' as MemoryType,
  };
}

function createRepositoryStub(methods: {
  search: PromptEmbeddingsRepository['search'];
  keywordSearch: PromptEmbeddingsRepository['keywordSearch'];
}): PromptEmbeddingsRepository {
  return {
    search: methods.search,
    keywordSearch: methods.keywordSearch,
  } as unknown as PromptEmbeddingsRepository;
}
