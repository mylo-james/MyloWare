import { describe, expect, it, vi } from 'vitest';
import { MemoryLinkRepository } from './linkRepository';

function createMockDb() {
  const returning = vi.fn().mockResolvedValue([{ id: 'link-1' }]);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const deleteReturning = vi.fn().mockResolvedValue([{ id: 'link-1' }]);
  const deleteWhere = vi.fn().mockReturnValue({
    returning: deleteReturning,
  });
  const del = vi.fn().mockReturnValue({
    where: deleteWhere,
  });

  const mockDb = {
    insert,
    execute,
    delete: del,
  } as Record<string, unknown>;

  return {
    mockDb,
    spies: {
      insert,
      values,
      onConflictDoUpdate,
      returning,
      execute,
      delete: del,
      deleteWhere,
      deleteReturning,
    },
  };
}

describe('MemoryLinkRepository', () => {
  it('upserts memory links and returns affected rows', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new MemoryLinkRepository(mockDb as never);

    const count = await repository.upsertLinks([
      {
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        linkType: 'similar',
        strength: 0.9,
        metadata: { method: 'test' },
      },
    ]);

    expect(count).toBe(1);
    expect(spies.insert).toHaveBeenCalledTimes(1);
    expect(spies.values).toHaveBeenCalledWith([
      expect.objectContaining({
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        linkType: 'similar',
        strength: 0.9,
        metadata: { method: 'test' },
      }),
    ]);
    expect(spies.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('maps linked chunks from database rows', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new MemoryLinkRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({
      rows: [
        {
          sourceChunkId: 'chunk-1',
          targetChunkId: 'chunk-2',
          linkType: 'related',
          strength: 0.65,
          metadata: { method: 'batch' },
          targetPromptKey: 'demo::persona',
          targetMemoryType: 'persona',
          targetUpdatedAt: '2025-10-29T00:00:00.000Z',
        },
      ],
    });

    const results = await repository.getLinkedChunks('chunk-1');

    expect(results).toEqual([
      {
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        linkType: 'related',
        strength: 0.65,
        metadata: { method: 'batch' },
        targetPromptKey: 'demo::persona',
        targetMemoryType: 'persona',
        targetUpdatedAt: '2025-10-29T00:00:00.000Z',
      },
    ]);
    expect(spies.execute).toHaveBeenCalledTimes(1);
  });

  it('builds a cluster using breadth-first traversal', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new MemoryLinkRepository(mockDb as never);

    spies.execute.mockResolvedValueOnce({
      rows: [
        {
          promptKey: 'demo::root',
          memoryType: 'semantic',
        },
      ],
    });

    const neighborMap = new Map<string, unknown>([
      [
        'root',
        [
          {
            sourceChunkId: 'root',
            targetChunkId: 'child-1',
            linkType: 'similar',
            strength: 0.88,
            metadata: {},
            targetPromptKey: 'demo::child-1',
            targetMemoryType: 'semantic',
            targetUpdatedAt: null,
          },
          {
            sourceChunkId: 'root',
            targetChunkId: 'child-2',
            linkType: 'related',
            strength: 0.6,
            metadata: {},
            targetPromptKey: 'demo::child-2',
            targetMemoryType: 'semantic',
            targetUpdatedAt: null,
          },
        ],
      ],
      [
        'child-1',
        [
          {
            sourceChunkId: 'child-1',
            targetChunkId: 'grandchild',
            linkType: 'related',
            strength: 0.58,
            metadata: {},
            targetPromptKey: 'demo::grandchild',
            targetMemoryType: 'semantic',
            targetUpdatedAt: null,
          },
        ],
      ],
      ['child-2', []],
      ['grandchild', []],
    ]);

    vi.spyOn(repository, 'getLinkedChunks').mockImplementation(async (chunkId: string) => {
      const neighbors = neighborMap.get(chunkId) as unknown[];
      return neighbors ? (neighbors as never) : [];
    });

    const cluster = await repository.findCluster('root', {
      depth: 2,
      limitPerNode: 5,
    });

    expect(cluster).not.toBeNull();
    expect(cluster?.root).toEqual({
      chunkId: 'root',
      depth: 0,
      promptKey: 'demo::root',
      memoryType: 'semantic',
    });
    expect(cluster?.nodes).toHaveLength(4);
    expect(cluster?.edges).toHaveLength(3);
  });

  it('deletes links for a source chunk', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new MemoryLinkRepository(mockDb as never);

    const removed = await repository.deleteLinksForSource('chunk-1');

    expect(removed).toBe(1);
    expect(spies.delete).toHaveBeenCalledTimes(1);
    expect(spies.deleteWhere).toHaveBeenCalledTimes(1);
    expect(spies.deleteReturning).toHaveBeenCalledTimes(1);
  });

  it('deletes links for a target chunk', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new MemoryLinkRepository(mockDb as never);

    const removed = await repository.deleteLinksForTarget('chunk-2');

    expect(removed).toBe(1);
    expect(spies.delete).toHaveBeenCalledTimes(1);
    expect(spies.deleteWhere).toHaveBeenCalledTimes(1);
    expect(spies.deleteReturning).toHaveBeenCalledTimes(1);
  });

  it('deletes links where chunk participates as source or target', async () => {
    const { mockDb, spies } = createMockDb();
    const repository = new MemoryLinkRepository(mockDb as never);

    const removed = await repository.deleteLinksForChunk('chunk-3');

    expect(removed).toBe(1);
    expect(spies.delete).toHaveBeenCalledTimes(1);
    expect(spies.deleteWhere).toHaveBeenCalledTimes(1);
    expect(spies.deleteReturning).toHaveBeenCalledTimes(1);
  });
});
