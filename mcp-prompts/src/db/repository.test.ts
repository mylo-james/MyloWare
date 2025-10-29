import { describe, expect, it, vi } from 'vitest';
import { PromptEmbeddingsRepository, type EmbeddingRecord } from './repository';

function createMockDb() {
  const insertReturning = vi.fn().mockResolvedValue([
    { id: '1' },
  ]);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: insertReturning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  const deleteReturning = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
  const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
  const del = vi.fn().mockReturnValue({ where: deleteWhere });

  const selectWhere = vi.fn().mockResolvedValue([
    { id: '123', filePath: 'prompt.md' },
  ]);
  const selectFrom = vi.fn().mockImplementation(() => ({
    where: selectWhere,
    then: (resolve: (value: Array<{ filePath: string }>) => unknown) =>
      resolve([
        { filePath: 'prompt.md' },
        { filePath: 'prompt.md' },
      ]),
  }));
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const mockDb: Record<string, unknown> = {};

  const transaction = vi.fn(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
    // Call the callback with the same mock DB for simplicity.
    return fn(mockDb);
  });

  Object.assign(mockDb, {
    insert,
    delete: del,
    select,
    transaction,
  });

  return {
    mockDb,
    spies: { insert, values, onConflictDoUpdate, insertReturning, del, deleteWhere, deleteReturning, select, selectFrom, selectWhere, transaction },
  };
}

describe('PromptEmbeddingsRepository', () => {
  const { mockDb, spies } = createMockDb();
  const repository = new PromptEmbeddingsRepository(mockDb as never);

  it('upserts embeddings and returns affected row count', async () => {
    const records: EmbeddingRecord[] = [
      {
        chunkId: 'checksum-chunk-0',
        filePath: 'prompts/sample.md',
        chunkText: 'text',
        rawMarkdown: 'raw',
        granularity: 'chunk',
        embedding: [0.1, 0.2],
        metadata: { type: 'persona' },
        checksum: 'checksum',
      },
    ];

    const count = await repository.upsertEmbeddings(records);

    expect(count).toBe(1);
    expect(spies.insert).toHaveBeenCalledTimes(1);
    expect(spies.values).toHaveBeenCalledWith([
      expect.objectContaining({
        chunkId: 'checksum-chunk-0',
        embedding: [0.1, 0.2],
      }),
    ]);
    expect(spies.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('removes embeddings by file path', async () => {
    const removed = await repository.removeEmbeddingsByFilePath('prompts/sample.md');
    expect(removed).toBe(2);
    expect(spies.del).toHaveBeenCalledTimes(1);
    expect(spies.deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('lists all unique file paths', async () => {
    const filePaths = await repository.listAllFilePaths();
    expect(filePaths).toEqual(['prompt.md']);
    expect(spies.select).toHaveBeenCalledTimes(1);
  });

  it('supports transactions', async () => {
    const result = await repository.transaction(async () => 'ok');
    expect(result).toBe('ok');
    expect(spies.transaction).toHaveBeenCalledTimes(1);
  });
});
