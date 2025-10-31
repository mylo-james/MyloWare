import { describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../db/repository';
import type { MemoryRouterRepository } from './memoryRouter';
import { multiHopSearch } from './multiHopSearch';
import type { MultiComponentResult, RoutedSearchResult } from './memoryRouter';

describe('multiHopSearch', () => {
  it('returns initial hop results and references', async () => {
    const routeSearch = createRouteSearchStub([
      [createResult({ chunkId: 'seed-1', similarity: 0.8 })],
    ]);
    const repository = createRepositoryStub({ searchResponses: [], keywordResponses: [] });

    const embed = vi.fn().mockResolvedValue([[0.1, 0.2]]);

    const result = await multiHopSearch('initial query', 0, { repository, embed, routeSearch });

    expect(result.hops).toHaveLength(1);
    expect(result.hops[0]?.hop).toBe(0);
    expect(result.aggregated[0]?.chunkId).toBe('seed-1');
  });

  it('follows references into next hops respecting limit', async () => {
    const firstHopResult = createResult({
      chunkId: 'seed-1',
      chunkText: 'Refer to project AISMR and workflow step 3.',
      similarity: 0.75,
    });

    const projectResult = createResult({ chunkId: 'project-aismr', similarity: 0.6 });
    const workflowResult = createResult({ chunkId: 'workflow-3', similarity: 0.55 });

    const routeSearch = createRouteSearchStub([
      [firstHopResult],
      [projectResult],
      [workflowResult],
    ]);
    const repository = createRepositoryStub({
      searchResponses: [[projectResult]],
      keywordResponses: [[workflowResult]],
    });

    const embed = vi.fn().mockResolvedValue([[0.1]]);

    const result = await multiHopSearch('initial query', 1, {
      repository,
      embed,
      routeSearch,
      maxResultsPerHop: 2,
    });

    expect(result.hops.some((hop) => hop.hop === 1 && hop.query.includes('project'))).toBe(true);
    expect(result.aggregated.some((hit) => hit.chunkId === 'project-aismr')).toBe(true);
    expect(result.totalReferences).toBeGreaterThan(0);
  });

  it('applies score decay per hop', async () => {
    const firstHopResult = createResult({ chunkId: 'seed-1', similarity: 0.9 });
    const secondHopResult = createResult({ chunkId: 'seed-1', similarity: 0.8 });

    const routeSearch = createRouteSearchStub([
      [firstHopResult],
      [secondHopResult],
    ]);
    const repository = createRepositoryStub({
      searchResponses: [[secondHopResult]],
      keywordResponses: [],
    });

    const embed = vi.fn().mockResolvedValue([[0.1]]);

    const result = await multiHopSearch('initial query', 1, {
      repository,
      embed,
      routeSearch,
    });

    const aggregatedHit = result.aggregated.find((hit) => hit.chunkId === 'seed-1');
    expect(aggregatedHit).toBeDefined();
    expect(aggregatedHit?.aggregatedScore).toBeCloseTo(0.9, 5);
  });
});

function createRepositoryStub({
  searchResponses,
  keywordResponses,
}: {
  searchResponses: SearchResult[][];
  keywordResponses: SearchResult[][];
}): MemoryRouterRepository {
  let searchIndex = 0;
  let keywordIndex = 0;

  return {
    search: vi.fn(async () => {
      const response = searchResponses[searchIndex] ?? [];
      searchIndex += 1;
      return response;
    }),
    keywordSearch: vi.fn(async () => {
      const response = keywordResponses[keywordIndex] ?? [];
      keywordIndex += 1;
      return response;
    }),
  } as MemoryRouterRepository;
}

function createRouteSearchStub(responses: SearchResult[][]) {
  let index = 0;
  return vi.fn(async () => {
    const results = responses[index] ?? [];
    index += 1;
    const combined: RoutedSearchResult[] = results.map((result) => ({
      ...result,
      routeWeight: 1,
      routedScore: result.similarity,
    }));
    return {
      intent: 'general_knowledge',
      confidence: 0.2,
      routes: ['semantic'],
      components: [],
      combined,
      filters: { persona: null, project: null },
      durationMs: 0,
      notes: [],
    } as MultiComponentResult;
  });
}

function createResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: overrides.chunkId ?? 'chunk-1',
    promptKey: overrides.promptKey ?? 'demo.md',
    chunkText: overrides.chunkText ?? 'Sample chunk text with project AISMR.',
    rawSource: overrides.rawSource ?? 'Sample raw source.',
    metadata: overrides.metadata ?? {},
    similarity: overrides.similarity ?? 0.7,
    ageDays: overrides.ageDays ?? null,
    temporalDecayApplied: overrides.temporalDecayApplied ?? false,
    memoryType: overrides.memoryType ?? 'semantic',
  } as SearchResult;
}
