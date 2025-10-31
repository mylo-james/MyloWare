import { describe, expect, it, vi } from 'vitest';
import {
  PromptEmbeddingsRepository,
  type EmbeddingRecord,
  type PromptLookupFilters,
  type MemoryType,
} from './repository';

function createMockDb() {
  const insertReturning = vi.fn().mockResolvedValue([{ id: '1' }]);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: insertReturning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  const deleteReturning = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
  const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
  const del = vi.fn().mockReturnValue({ where: deleteWhere });

  const selectOrderBy = vi.fn().mockResolvedValue([
    {
      chunkId: 'checksum-document-0',
      promptKey: 'demo::persona',
      chunkText: 'Document text',
      rawSource: 'Document text',
      granularity: 'document',
      metadata: { project: ['demo'], persona: ['persona'] },
      checksum: 'checksum',
      memoryType: 'persona',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
  ]);
  const selectWhere = vi.fn().mockReturnValue({ orderBy: selectOrderBy });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const execute = vi.fn().mockResolvedValue({ rows: [] });

  const transaction = vi.fn(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
    const tx = {};
    return fn(tx);
  });

  const mockDb = {
    insert,
    delete: del,
    select,
    execute,
    transaction,
  } as Record<string, unknown>;

  return {
    mockDb,
    spies: {
      insert,
      values,
      onConflictDoUpdate,
      insertReturning,
      del,
      deleteWhere,
      deleteReturning,
      select,
      selectFrom,
      selectWhere,
      selectOrderBy,
      execute,
      transaction,
    },
  };
}

function stringifySql(query: unknown): string {
  if (query == null) {
    return '';
  }

  if (typeof query === 'string' || typeof query === 'number') {
    return String(query);
  }

  if (typeof query === 'object') {
    const chunk = query as { value?: unknown[]; queryChunks?: unknown[] };

    if (Array.isArray(chunk.value)) {
      return chunk.value.map(stringifySql).join('');
    }

    if (Array.isArray(chunk.queryChunks)) {
      return chunk.queryChunks.map(stringifySql).join('');
    }
  }

  return '';
}

describe('PromptEmbeddingsRepository', () => {
  it('upserts embeddings and returns affected row count', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    const records: EmbeddingRecord[] = [
      {
        chunkId: 'checksum-document-0',
        promptKey: 'demo::persona',
        chunkText: 'Document text',
        rawSource: 'Document text',
        granularity: 'document',
        embedding: [0.1, 0.2],
        metadata: { project: ['demo'], persona: ['persona'] },
        checksum: 'checksum',
        memoryType: 'persona',
      },
    ];

    const count = await repository.upsertEmbeddings(records);

    expect(count).toBe(1);
    expect(spies.insert).toHaveBeenCalledTimes(1);
    expect(spies.values).toHaveBeenCalledWith([
      expect.objectContaining({
        chunkId: 'checksum-document-0',
        filePath: 'demo::persona',
        memoryType: 'persona',
      }),
    ]);
    expect(spies.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('deletes embeddings by prompt key', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    const removed = await repository.deleteByPromptKey('demo::persona');

    expect(removed).toBe(2);
    expect(spies.del).toHaveBeenCalledTimes(1);
    expect(spies.deleteWhere).toHaveBeenCalledTimes(1);
    expect(spies.deleteReturning).toHaveBeenCalledTimes(1);
  });

  it('deletes embeddings by chunk ids', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.del.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: spies.deleteReturning,
      }),
    });

    const removed = await repository.deleteByChunkIds(['chunk-1', 'chunk-2']);

    expect(removed).toBe(2);
    expect(spies.del).toHaveBeenCalledTimes(1);
    expect(spies.deleteReturning).toHaveBeenCalledTimes(1);
  });

  it('returns mapped prompt chunks by prompt key', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    const chunks = await repository.getChunksByPromptKey('demo::persona');

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      chunkId: 'checksum-document-0',
      promptKey: 'demo::persona',
      granularity: 'document',
    });
    expect(spies.select).toHaveBeenCalledTimes(1);
    expect(spies.selectFrom).toHaveBeenCalledTimes(1);
    expect(spies.selectWhere).toHaveBeenCalledTimes(1);
    expect(spies.selectOrderBy).toHaveBeenCalledTimes(1);
  });

  it('lists prompts using metadata filters', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    const filters: PromptLookupFilters = { project: 'demo', persona: 'persona' };
    spies.execute.mockResolvedValueOnce({
      rows: [
        {
          promptKey: 'demo::persona',
          metadata: { project: ['demo'], persona: ['persona'] },
          chunkCount: '4',
          updatedAt: '2025-01-01T00:00:00.000Z',
          memoryType: 'persona',
        },
      ],
    });

    const results = await repository.listPrompts(filters);

    expect(results).toEqual([
      {
        promptKey: 'demo::persona',
        metadata: { project: ['demo'], persona: ['persona'] },
        chunkCount: 4,
        updatedAt: '2025-01-01T00:00:00.000Z',
        memoryType: 'persona',
      },
    ]);
    expect(spies.execute).toHaveBeenCalledTimes(1);
  });

  it('supports transactions', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    const result = await repository.transaction(async () => 'ok');

    expect(result).toBe('ok');
    expect(spies.transaction).toHaveBeenCalledTimes(1);
  });

  it('performs keyword search for exact phrases', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({
      rows: [
        {
          chunkId: 'chunk-1',
          promptKey: 'demo::vector',
          chunkText: 'Vector search phrase document',
          rawSource: 'Vector search phrase document',
          metadata: { project: ['search'] },
          memoryType: 'semantic',
          score: 0.72,
        },
      ],
    });

    const results = await repository.keywordSearch('"vector search"', {});

    expect(results).toEqual([
      {
        chunkId: 'chunk-1',
        promptKey: 'demo::vector',
        chunkText: 'Vector search phrase document',
        rawSource: 'Vector search phrase document',
        metadata: { project: ['search'] },
        similarity: 0.72,
        ageDays: null,
        temporalDecayApplied: false,
        memoryType: 'semantic',
      },
    ]);
    expect(spies.execute).toHaveBeenCalledTimes(1);

    const sqlString = stringifySql(spies.execute.mock.calls[0][0]);
    expect(sqlString).toContain('websearch_to_tsquery');
    expect(sqlString).toContain('"vector search"');
  });

  it('supports multi-word keyword queries with limit overrides', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({ rows: [] });

    const results = await repository.keywordSearch('hybrid search index tuning', {}, { limit: 5 });

    expect(results).toEqual([]);
    expect(spies.execute).toHaveBeenCalledTimes(1);
    const sqlString = stringifySql(spies.execute.mock.calls[0][0]);
    expect(sqlString).toContain('LIMIT 5');
  });

  it('returns no results when query reduces to stop words', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    const results = await repository.keywordSearch('and the or', {});

    expect(results).toEqual([]);
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it('applies metadata filters during keyword search', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({ rows: [] });

    await repository.keywordSearch('vector retrieval', { persona: 'Architect', project: 'Neuron' });

    expect(spies.execute).toHaveBeenCalledTimes(1);
    const sqlString = stringifySql(spies.execute.mock.calls[0][0]).toLowerCase();
    expect(sqlString).toContain('jsonb_array_elements_text');
    expect(sqlString).toContain('persona_elem');
    expect(sqlString).toContain('project_elem');
    expect(sqlString).toContain('architect');
    expect(sqlString).toContain('neuron');
  });

  it('returns empty array when no keyword matches are found', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({ rows: [] });

    const results = await repository.keywordSearch('nonexistent topic coverage', {});

    expect(results).toEqual([]);
    expect(spies.execute).toHaveBeenCalledTimes(1);
  });

  it('excludes inactive memories from keyword search', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({ rows: [] });

    await repository.keywordSearch('vector memory governance', {});

    const sqlString = stringifySql(spies.execute.mock.calls[0][0]).toLowerCase();
    expect(sqlString).toContain('coalesce(');
    expect(sqlString).toContain('metadata');
    expect(sqlString).toContain('inactive');
  });

  it('returns vector search results with age metadata by default', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({
      rows: [
        {
          chunkId: 'chunk-1',
          promptKey: 'demo::vector',
          chunkText: 'Vector text',
          rawSource: 'Vector text',
          metadata: { project: ['demo'] },
          memoryType: 'semantic',
          ageDays: '12.5',
          similarity: '0.82',
        },
      ],
    });

    const results = await repository.search({
      embedding: [0.1, 0.2, 0.3],
      limit: 10,
      minSimilarity: 0.2,
    });

    expect(results).toEqual([
      {
        chunkId: 'chunk-1',
        promptKey: 'demo::vector',
        chunkText: 'Vector text',
        rawSource: 'Vector text',
        metadata: { project: ['demo'] },
        similarity: 0.82,
        ageDays: 12.5,
        temporalDecayApplied: false,
        memoryType: 'semantic',
      },
    ]);

    const sqlString = stringifySql(spies.execute.mock.calls[0][0]);
    expect(sqlString).toContain('ORDER BY "similarity" DESC');
    expect(sqlString).not.toContain('EXP(');
  });

  it('applies exponential temporal decay when enabled', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({
      rows: [
        {
          chunkId: 'chunk-2',
          promptKey: 'demo::decay',
          chunkText: 'Recent update',
          rawSource: 'Recent update',
          metadata: {},
          memoryType: 'semantic',
          ageDays: 3,
          similarity: 0.91,
        },
      ],
    });

    const results = await repository.search({
      embedding: [0.5, 0.4, 0.3],
      limit: 5,
      minSimilarity: 0.1,
      applyTemporalDecay: true,
      temporalDecayConfig: {
        strategy: 'exponential',
        halfLifeDays: 45,
        maxAgeDays: 365,
      },
    });

    expect(results[0]).toMatchObject({
      chunkId: 'chunk-2',
      temporalDecayApplied: true,
      memoryType: 'semantic',
    });

    const sqlString = stringifySql(spies.execute.mock.calls[0][0]);
    expect(sqlString).toContain('EXP(-');
    expect(sqlString).toContain('86400.0');
  });

  it('excludes inactive memories from vector search results', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({ rows: [] });

    await repository.search({
      embedding: [0.2, 0.3, 0.4],
      limit: 5,
      minSimilarity: 0.1,
    });

    const sqlString = stringifySql(spies.execute.mock.calls[0][0]).toLowerCase();
    expect(sqlString).toContain('coalesce(');
    expect(sqlString).toContain('metadata');
    expect(sqlString).toContain('inactive');
  });

  it('filters vector search by memory type when provided', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({ rows: [] });

    await repository.search({
      embedding: [0.1, 0.2, 0.3],
      limit: 5,
      minSimilarity: 0.2,
      memoryTypes: ['persona'],
    });

    const sqlString = stringifySql(spies.execute.mock.calls[0][0]).toLowerCase();
    expect(sqlString).toContain('memory_type');
    expect(sqlString).toContain("'persona'::memory_type");
  });

  it('filters keyword search by memory type when provided', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({ rows: [] });

    await repository.keywordSearch('persona spotlight', {}, { memoryTypes: ['persona'] });

    const sqlString = stringifySql(spies.execute.mock.calls[0][0]).toLowerCase();
    expect(sqlString).toContain('memory_type');
    expect(sqlString).toContain("'persona'::memory_type");
  });

  it('delegates component search helpers to vector search with appropriate memory type', async () => {
    const { mockDb } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);
    const searchSpy = vi.spyOn(repository, 'search').mockResolvedValue([]);

    const baseParams = {
      embedding: [0.2, 0.3],
      limit: 5,
      minSimilarity: 0.2,
    };

    await repository.searchPersonaMemory(baseParams);
    expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ memoryTypes: ['persona'] }));

    await repository.searchProjectMemory(baseParams);
    expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ memoryTypes: ['project'] }));

    await repository.searchSemanticMemory(baseParams);
    expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ memoryTypes: ['semantic'] }));

    await repository.searchEpisodicMemory(baseParams);
    expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ memoryTypes: ['episodic'] }));

    searchSpy.mockRestore();
  });

  it('performs multi-component search with weighting', async () => {
    const { mockDb } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    const searchSpy = vi.spyOn(repository, 'search').mockImplementation(async (params) => [
      {
        chunkId: `chunk-${params.memoryTypes?.[0] ?? 'semantic'}`,
        promptKey: 'demo::memory',
        chunkText: 'memory content',
        rawSource: 'memory content',
        metadata: {},
        similarity: 0.8,
        ageDays: null,
        temporalDecayApplied: false,
        memoryType: (params.memoryTypes?.[0] ?? 'semantic') as MemoryType,
      },
    ]);

    const groups = await repository.searchAllMemory({
      embedding: [0.9, 0.1],
      limit: 5,
      minSimilarity: 0.2,
      memoryTypes: ['persona', 'project'],
      weights: { persona: 1.2, project: 0.5 },
    });

    expect(groups).toHaveLength(2);
    const personaGroup = groups.find((group) => group.memoryType === 'persona');
    const projectGroup = groups.find((group) => group.memoryType === 'project');

    expect(personaGroup?.weight).toBeCloseTo(1.2);
    expect(personaGroup?.results[0].similarity).toBeCloseTo(0.96);
    expect(projectGroup?.weight).toBeCloseTo(0.5);
    expect(projectGroup?.results[0].similarity).toBeCloseTo(0.4);

    expect(searchSpy).toHaveBeenCalledTimes(2);
    expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ memoryTypes: ['persona'] }));
    expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ memoryTypes: ['project'] }));

    searchSpy.mockRestore();
  });

  it('retrieves chunk embedding by chunk id', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new PromptEmbeddingsRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({
      rows: [
        {
          chunkId: 'chunk-123',
          promptKey: 'demo::persona',
          embedding: [0.1, 0.25, 0.5],
          memoryType: 'semantic',
          metadata: { persona: ['demo'] },
        },
      ],
    });

    const result = await repository.getChunkEmbedding('chunk-123');

    expect(result).toEqual({
      chunkId: 'chunk-123',
      promptKey: 'demo::persona',
      embedding: [0.1, 0.25, 0.5],
      memoryType: 'semantic',
      metadata: { persona: ['demo'] },
    });
    expect(spies.execute).toHaveBeenCalledTimes(1);
  });

  it('expands graph results when graph expansion enabled', async () => {
    const { mockDb } = createMockDb();
    const linkRepository = {
      getLinkedChunks: vi.fn().mockImplementation(async (chunkId: string) => {
        if (chunkId === 'seed-1') {
          return [
            {
              sourceChunkId: 'seed-1',
              targetChunkId: 'neighbor-1',
              linkType: 'similar',
              strength: 0.8,
              metadata: {},
              targetPromptKey: 'demo::neighbor-1',
              targetMemoryType: 'semantic',
              targetUpdatedAt: null,
            },
          ];
        }
        return [];
      }),
    };

    const repository = new PromptEmbeddingsRepository(
      mockDb as never,
      () => linkRepository as never,
    );

    const searchSpy = vi.spyOn(repository, 'search').mockResolvedValue([
      {
        chunkId: 'seed-1',
        promptKey: 'demo::seed',
        chunkText: 'Seed chunk',
        rawSource: 'Seed chunk',
        metadata: {},
        similarity: 0.9,
        ageDays: 0,
        temporalDecayApplied: false,
        memoryType: 'semantic',
      },
    ]);

    const chunkDetails = [
      {
        chunkId: 'neighbor-1',
        promptKey: 'demo::neighbor-1',
        chunkText: 'Neighbor chunk',
        rawSource: 'Neighbor chunk',
        metadata: {},
        granularity: 'document',
        checksum: 'abc',
        memoryType: 'semantic' as const,
        updatedAt: new Date().toISOString(),
      },
    ];

    const chunkSpy = vi.spyOn(repository, 'getChunksByIds').mockResolvedValue(chunkDetails);

    const results = await repository.searchWithGraphExpansion({
      embedding: [0.1, 0.2],
      limit: 5,
      minSimilarity: 0.1,
      expandGraph: true,
      graphMaxHops: 1,
      graphMinLinkStrength: 0.5,
    });

    expect(searchSpy).toHaveBeenCalled();
    expect(chunkSpy).toHaveBeenCalledWith(['neighbor-1']);
    expect(linkRepository.getLinkedChunks).toHaveBeenCalledWith('seed-1', {
      limit: expect.any(Number),
      minStrength: 0.5,
    });
    expect(results).toHaveLength(2);
    const expansion = results.find((result) => result.chunkId === 'neighbor-1');
    expect(expansion?.graphContext).toMatchObject({
      seedChunkId: 'seed-1',
      hopCount: 1,
    });
  });
});
