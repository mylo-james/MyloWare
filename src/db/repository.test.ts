import { describe, expect, it, vi } from 'vitest';
import {
  PromptEmbeddingsRepository,
  type EmbeddingRecord,
  type PromptLookupFilters,
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
      },
    ];

    const count = await repository.upsertEmbeddings(records);

    expect(count).toBe(1);
    expect(spies.insert).toHaveBeenCalledTimes(1);
    expect(spies.values).toHaveBeenCalledWith([
      expect.objectContaining({
        chunkId: 'checksum-document-0',
        filePath: 'demo::persona',
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
});
