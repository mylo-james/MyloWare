import { describe, expect, it, vi } from 'vitest';
import type { PromptEmbeddingsRepository, SearchResult } from '../../db/repository';
import type { MemoryLinkType } from '../../db/linkRepository';
import { searchPrompts } from './promptSearchTool';
import type { EnhancedQuery } from '../../vector/queryEnhancer';
import type { RoutedSearchResult } from '../../vector/memoryRouter';

type PromptSearchRuntimeInput = Parameters<typeof searchPrompts>[2];

function buildArgs(
  overrides: Partial<PromptSearchRuntimeInput> & { query: string },
): PromptSearchRuntimeInput {
  return {
    autoFilter: true,
    ...overrides,
  } as PromptSearchRuntimeInput;
}

describe('searchPrompts', () => {
  it('prioritises semantic matches in vector mode', async () => {
    const repository = {
      searchWithGraphExpansion: vi
        .fn()
        .mockResolvedValue([
          createMatch({ chunkId: 'chunk-a', promptKey: 'demo::a', similarity: 0.82 }),
          createMatch({ chunkId: 'chunk-b', promptKey: 'demo::b', similarity: 0.15 }),
        ]),
      keywordSearch: vi.fn(),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
    const enhancer = vi.fn().mockResolvedValue(createEnhancerResult());

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'semantic intent',
        persona: 'Persona',
        minSimilarity: 0.3,
        searchMode: 'vector',
        modeProvided: true,
      }),
      enhancer as any,
    );

    expect(embed).toHaveBeenCalledWith(['semantic intent']);
    expect(repository.searchWithGraphExpansion).toHaveBeenCalledTimes(1);
    expect(repository.keywordSearch).not.toHaveBeenCalled();
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].chunkId).toBe('chunk-a');
    expect(result.matches[0].memoryComponent).toBe('semantic');
    expect(result.matches[0].originalSimilarity).toBeCloseTo(0.82);
    expect(result.matches[0].routeWeight).toBeUndefined();
    expect(result.appliedFilters.mode).toBe('vector');
    expect(result.appliedFilters.searchMode).toBe('manual');
    expect(result.appliedFilters.persona).toBe('persona');
    expect(result.appliedFilters.auto).toBe(false);
    expect(result.appliedFilters.temporalDecayApplied).toBe(false);
    expect(result.appliedFilters.temporalConfig.strategy).toBe('none');
    expect(result.appliedFilters.memoryRouting).toBe(false);
    expect(result.appliedFilters.componentsSearched).toEqual([]);
    expect(result.appliedFilters.routingDecision.source).toBe('disabled');
    expect(result.appliedFilters.routingDecision.enabled).toBe(false);
    expect(result.graph).toBeNull();
  });

  it('includes graph context details when expansion matches are returned', async () => {
    const graphContext = {
      seedChunkId: 'seed-1',
      hopCount: 1,
      linkStrength: 0.8,
      seedSimilarity: 0.9,
      seedContribution: 0.63,
      linkContribution: 0.24,
      path: [
        {
          from: 'seed-1',
          to: 'graph-1',
          linkType: 'similar' as MemoryLinkType,
          strength: 0.8,
        },
      ],
    };

    const repository = {
      searchWithGraphExpansion: vi
        .fn()
        .mockResolvedValue([
          createMatch({ chunkId: 'seed-1', similarity: 0.9 }),
          createMatch({ chunkId: 'graph-1', similarity: 0.87, graphContext }),
        ]),
      keywordSearch: vi.fn(),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.1, 0.2]]);
    const enhancer = vi.fn().mockResolvedValue(createEnhancerResult());

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'Enable graph expansion please',
        searchMode: 'vector',
        expandGraph: true,
        modeProvided: true,
      }),
      enhancer as any,
    );

    const match = result.matches.find((item) => item.chunkId === 'graph-1');
    expect(match?.graphContext).toEqual(graphContext);
    expect(result.appliedFilters.graphExpansion).toEqual({
      enabled: true,
      maxHops: 2,
      minLinkStrength: 0.45,
    });
    expect(result.graph).toEqual({
      nodes: expect.arrayContaining([
        expect.objectContaining({ chunkId: 'seed-1', hop: 0 }),
        expect.objectContaining({ chunkId: 'graph-1', hop: 1 }),
      ]),
      edges: expect.arrayContaining([
        expect.objectContaining({ from: 'seed-1', to: 'graph-1', linkType: 'similar' }),
      ]),
    });
  });

  it('applies temporal decay when requested explicitly', async () => {
    const repository = {
      searchWithGraphExpansion: vi
        .fn()
        .mockResolvedValue([
          createMatch({
            chunkId: 'recent',
            similarity: 0.9,
            ageDays: 5,
            temporalDecayApplied: true,
          }),
        ]),
      keywordSearch: vi.fn(),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.2, 0.3, 0.4]]);
    const enhancer = vi.fn().mockResolvedValue(createEnhancerResult());

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'temporal boost scenario',
        searchMode: 'vector',
        temporalBoost: true,
        temporalConfig: {
          strategy: 'exponential',
          halfLifeDays: 30,
          maxAgeDays: 180,
        },
        modeProvided: true,
      }),
      enhancer as any,
    );

    expect(repository.searchWithGraphExpansion).toHaveBeenCalledWith(
      expect.objectContaining({
        applyTemporalDecay: true,
        temporalDecayConfig: expect.objectContaining({
          strategy: 'exponential',
          halfLifeDays: 30,
          maxAgeDays: 180,
        }),
      }),
    );
    expect(result.appliedFilters.temporalDecayApplied).toBe(true);
    expect(result.appliedFilters.temporalConfig.strategy).toBe('exponential');
    expect(result.matches[0].temporalDecayApplied).toBe(true);
    expect(result.appliedFilters.memoryRouting).toBe(false);
    expect(result.graph).toBeNull();
  });

  it('prefers keyword matches for technical terms without embeddings', async () => {
    const repository = {
      searchWithGraphExpansion: vi.fn(),
      keywordSearch: vi
        .fn()
        .mockResolvedValue([
          createMatch({ chunkId: 'chunk-spec', promptKey: 'spec::keyword', similarity: 0.72 }),
          createMatch({ chunkId: 'chunk-other', promptKey: 'spec::other', similarity: 0.25 }),
        ]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn();
    const enhancer = vi.fn().mockResolvedValue(createEnhancerResult());

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'pg_trgm index configuration',
        searchMode: 'keyword',
        limit: 5,
        minSimilarity: 0.5,
        modeProvided: true,
      }),
      enhancer as any,
    );

    expect(embed).not.toHaveBeenCalled();
    expect(repository.keywordSearch).toHaveBeenCalledWith(
      'pg_trgm index configuration',
      expect.objectContaining({ persona: undefined, project: undefined }),
      expect.objectContaining({ limit: 5 }),
    );
    expect(repository.searchWithGraphExpansion).not.toHaveBeenCalled();
    expect(result.matches.map((match) => match.chunkId)).toEqual(['chunk-spec']);
    expect(result.appliedFilters.mode).toBe('keyword');
    expect(result.appliedFilters.searchMode).toBe('manual');
    expect(result.appliedFilters.auto).toBe(false);
    expect(result.appliedFilters.temporalDecayApplied).toBe(false);
    expect(result.graph).toBeNull();
  });

  it('combines vector and keyword rankings in hybrid mode', async () => {
    const vectorMatches = [
      createMatch({ chunkId: 'chunk-a', promptKey: 'demo::a', similarity: 0.9 }),
      createMatch({ chunkId: 'chunk-b', promptKey: 'demo::b', similarity: 0.4 }),
    ];

    const keywordMatches = [
      createMatch({ chunkId: 'chunk-b', promptKey: 'demo::b', similarity: 0.85 }),
      createMatch({ chunkId: 'chunk-c', promptKey: 'demo::c', similarity: 0.6 }),
    ];

    const repository = {
      searchWithGraphExpansion: vi.fn().mockResolvedValue(vectorMatches),
      keywordSearch: vi.fn().mockResolvedValue(keywordMatches),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.42, 0.11, 0.01]]);
    const enhancer = vi.fn().mockResolvedValue(createEnhancerResult());

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'hybrid retrieval',
        searchMode: 'hybrid',
        limit: 3,
        modeProvided: true,
      }),
      enhancer as any,
    );

    expect(embed).toHaveBeenCalledTimes(1);
    expect(repository.searchWithGraphExpansion).toHaveBeenCalledTimes(1);
    expect(repository.keywordSearch).toHaveBeenCalledTimes(1);
    expect(result.matches[0].chunkId).toBe('chunk-b');
    expect(result.matches.map((match) => match.chunkId)).toContain('chunk-c');
    expect(result.appliedFilters.mode).toBe('hybrid');
    expect(result.appliedFilters.searchMode).toBe('manual');
    expect(result.appliedFilters.auto).toBe(false);
    expect(result.graph).toBeNull();
  });

  it('defaults to hybrid mode when searchMode is omitted', async () => {
    const repository = {
      searchWithGraphExpansion: vi
        .fn()
        .mockResolvedValue([createMatch({ chunkId: 'chunk-a', similarity: 0.5 })]),
      keywordSearch: vi
        .fn()
        .mockResolvedValue([createMatch({ chunkId: 'chunk-b', similarity: 0.45 })]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.1]]);
    const enhancer = vi.fn().mockResolvedValue(createEnhancerResult());

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'default behaviour',
        searchMode: undefined,
      }),
      enhancer as any,
    );

    expect(result.appliedFilters.mode).toBe('hybrid');
    expect(repository.searchWithGraphExpansion).toHaveBeenCalledTimes(1);
    expect(repository.keywordSearch).toHaveBeenCalledTimes(1);
    expect(result.appliedFilters.auto).toBe(false);
  });

  it('auto-applies persona filters when enabled and none provided', async () => {
    const repository = {
      searchWithGraphExpansion: vi.fn().mockResolvedValue([createMatch({ similarity: 0.7 })]),
      keywordSearch: vi.fn().mockResolvedValue([]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.1]]);
    const enhancer = vi.fn().mockResolvedValue(
      createEnhancerResult({
        intent: 'persona_lookup',
        confidence: 0.9,
        persona: 'screenwriter',
        appliedPersona: true,
        notes: ['Applied persona filter "screenwriter" from query classifier.'],
      }),
    );

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'What does the screenwriter persona do?',
      }),
      enhancer as any,
    );

    expect(repository.searchWithGraphExpansion).toHaveBeenCalledWith(
      expect.objectContaining({ persona: 'screenwriter' }),
    );
    expect(result.appliedFilters.persona).toBe('screenwriter');
    expect(result.appliedFilters.mode).toBe('hybrid');
    expect(result.appliedFilters.searchMode).toBe('auto');
    expect(result.appliedFilters.auto).toBe(true);
    expect(result.appliedFilters.autoDetails).toEqual([
      'Applied persona filter "screenwriter" from query classifier.',
      'Auto-selected search mode "hybrid".',
    ]);
    expect(result.graph).toBeNull();
  });

  it('auto-applies project filters when enabled and none provided', async () => {
    const repository = {
      searchWithGraphExpansion: vi.fn().mockResolvedValue([createMatch({ similarity: 0.65 })]),
      keywordSearch: vi.fn().mockResolvedValue([]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.1]]);
    const enhancer = vi.fn().mockResolvedValue(
      createEnhancerResult({
        intent: 'project_lookup',
        confidence: 0.85,
        project: 'aismr',
        appliedProject: true,
        notes: ['Applied project filter "aismr" from query classifier.'],
      }),
    );

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'Tell me about AISMR',
      }),
      enhancer as any,
    );

    expect(repository.searchWithGraphExpansion).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'aismr' }),
    );
    expect(result.appliedFilters.project).toBe('aismr');
    expect(result.appliedFilters.mode).toBe('hybrid');
    expect(result.appliedFilters.searchMode).toBe('auto');
    expect(result.appliedFilters.auto).toBe(true);
    expect(result.appliedFilters.autoDetails).toEqual([
      'Applied project filter "aismr" from query classifier.',
      'Auto-selected search mode "hybrid".',
    ]);
    expect(result.graph).toBeNull();
  });

  it('skips auto-filter when explicit filters are provided', async () => {
    const repository = {
      searchWithGraphExpansion: vi.fn().mockResolvedValue([createMatch({ similarity: 0.7 })]),
      keywordSearch: vi.fn().mockResolvedValue([]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.1]]);
    const enhancer = vi.fn();

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'Prompt with explicit filters',
        persona: 'reviewer',
        project: 'demo',
      }),
      enhancer as any,
    );

    expect(enhancer).not.toHaveBeenCalled();
    expect(repository.searchWithGraphExpansion).toHaveBeenCalledWith(
      expect.objectContaining({ persona: 'reviewer', project: 'demo' }),
    );
    expect(result.appliedFilters.auto).toBe(false);
    expect(result.graph).toBeNull();
  });

  it('continues without auto filters when enhancer throws', async () => {
    const repository = {
      searchWithGraphExpansion: vi.fn().mockResolvedValue([createMatch({ similarity: 0.5 })]),
      keywordSearch: vi.fn().mockResolvedValue([]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.1]]);
    const enhancer = vi.fn().mockRejectedValue(new Error('classifier timeout'));

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'classifier failure scenario',
      }),
      enhancer as any,
    );

    expect(repository.keywordSearch).toHaveBeenCalledTimes(1);
    expect(repository.searchWithGraphExpansion).toHaveBeenCalledTimes(1);
    expect(result.appliedFilters.mode).toBe('hybrid');
    expect(result.appliedFilters.searchMode).toBe('auto');
    expect(result.appliedFilters.auto).toBe(false);
    expect(result.appliedFilters.autoDetails).toContain(
      'Query enhancement failed; proceeding without auto filters.',
    );
    expect(result.appliedFilters.autoDetails).toContain('Auto-selected search mode "hybrid".');
    expect(result.graph).toBeNull();
  });

  it('auto-selects keyword mode for technical queries', async () => {
    const repository = {
      searchWithGraphExpansion: vi.fn(),
      keywordSearch: vi.fn().mockResolvedValue([createMatch({ similarity: 0.6 })]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.1]]);
    const enhancer = vi.fn().mockResolvedValue(createEnhancerResult());

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'Fetch prompt PRD_1234::latest copy',
      }),
      enhancer as any,
    );

    expect(repository.keywordSearch).toHaveBeenCalledTimes(1);
    expect(repository.searchWithGraphExpansion).not.toHaveBeenCalled();
    expect(result.appliedFilters.mode).toBe('keyword');
    expect(result.appliedFilters.searchMode).toBe('auto');
    expect(result.appliedFilters.autoDetails).toContain('Auto-selected search mode "keyword".');
    expect(result.graph).toBeNull();
  });

  it('auto-selects vector mode for conceptual queries', async () => {
    const repository = {
      searchWithGraphExpansion: vi.fn().mockResolvedValue([createMatch({ similarity: 0.55 })]),
      keywordSearch: vi.fn().mockResolvedValue([]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.1]]);
    const enhancer = vi.fn().mockResolvedValue(createEnhancerResult());

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'How can we improve brainstorming sessions for the design team?',
      }),
      enhancer as any,
    );

    expect(repository.searchWithGraphExpansion).toHaveBeenCalledTimes(1);
    expect(result.appliedFilters.mode).toBe('vector');
    expect(result.appliedFilters.searchMode).toBe('auto');
    expect(result.appliedFilters.autoDetails).toContain('Auto-selected search mode "vector".');
    expect(result.appliedFilters.memoryRouting).toBe(false);
    expect(result.graph).toBeNull();
  });

  it('routes queries through memoryRouter when enabled manually', async () => {
    const repository = {
      searchWithGraphExpansion: vi.fn(),
      keywordSearch: vi.fn(),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn();
    const enhancer = vi.fn().mockResolvedValue(
      createEnhancerResult({
        intent: 'persona_lookup',
        confidence: 0.88,
        persona: 'screenwriter',
        appliedPersona: true,
        notes: ['Applied persona filter "screenwriter" from query classifier.'],
      }),
    );

    const routedPersona = createRoutedMatch({
      chunkId: 'persona-1',
      promptKey: 'screenwriter.md',
      memoryType: 'persona',
      similarity: 0.92,
      routedScore: 1.02,
      routeWeight: 1.1,
    });

    const routedSemantic = createRoutedMatch({
      chunkId: 'semantic-1',
      promptKey: 'guides.md',
      memoryType: 'semantic',
      similarity: 0.78,
      routedScore: 0.82,
      routeWeight: 0.9,
    });

    const memoryRouter = vi.fn().mockResolvedValue({
      intent: 'persona_lookup',
      confidence: 0.88,
      routes: ['persona', 'semantic'],
      components: [
        { memoryType: 'persona', weight: 1.1, hits: [routedPersona] },
        { memoryType: 'semantic', weight: 0.9, hits: [routedSemantic] },
      ],
      combined: [routedPersona, routedSemantic],
      filters: { persona: 'screenwriter', project: null },
      durationMs: 14.5,
      notes: ['Memory routing enabled manually.', 'Semantic memory provides fallback coverage.'],
    });

    const result = await searchPrompts(
      repository as unknown as PromptEmbeddingsRepository,
      embed,
      buildArgs({
        query: 'Who am I as the screenwriter persona?',
        useMemoryRouting: true,
      }),
      enhancer as any,
      memoryRouter as any,
    );

    expect(memoryRouter).toHaveBeenCalledTimes(1);
    expect(repository.searchWithGraphExpansion).not.toHaveBeenCalled();
    expect(repository.keywordSearch).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(result.matches.map((match) => match.chunkId)).toEqual(['persona-1', 'semantic-1']);
    expect(result.matches[0].memoryComponent).toBe('persona');
    expect(result.matches[0].routeWeight).toBeCloseTo(1.1);
    expect(result.matches[0].similarity).toBeCloseTo(1.02);
    expect(result.matches[0].originalSimilarity).toBeCloseTo(0.92);
    expect(result.appliedFilters.persona).toBe('screenwriter');
    expect(result.appliedFilters.memoryRouting).toBe(true);
    expect(result.appliedFilters.routingDecision.source).toBe('manual');
    expect(result.appliedFilters.routingDecision.intent).toBe('persona_lookup');
    expect(result.appliedFilters.componentsSearched).toEqual(['persona', 'semantic']);
    expect(result.appliedFilters.autoDetails).toContain('Memory routing enabled manually.');
    expect(result.graph).toBeNull();
  });
});

function createMatch(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: overrides.chunkId ?? 'chunk-1',
    promptKey: overrides.promptKey ?? 'demo::persona',
    chunkText: overrides.chunkText ?? 'Prompt guidance text for testing.',
    rawSource: overrides.rawSource ?? 'Prompt guidance text for testing.',
    metadata: overrides.metadata ?? ({} as SearchResult['metadata']),
    similarity: overrides.similarity ?? 0.6,
    ageDays: overrides.ageDays ?? null,
    temporalDecayApplied: overrides.temporalDecayApplied ?? false,
    memoryType: overrides.memoryType ?? 'semantic',
    graphContext: overrides.graphContext,
  };
}

function createRoutedMatch(overrides: Partial<RoutedSearchResult> = {}): RoutedSearchResult {
  const base = createMatch(overrides);
  return {
    ...base,
    routeWeight: overrides.routeWeight ?? 1,
    routedScore: overrides.routedScore ?? base.similarity,
  } satisfies RoutedSearchResult;
}

function createEnhancerResult(overrides: Partial<EnhancedQuery> = {}): EnhancedQuery {
  return {
    intent: 'general_knowledge',
    confidence: 0,
    persona: undefined,
    project: undefined,
    appliedPersona: false,
    appliedProject: false,
    notes: [],
    ...overrides,
  };
}
