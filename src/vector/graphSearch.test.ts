import { describe, expect, it, vi } from 'vitest';
import type { MemoryLinkRepository } from '../db/linkRepository';
import { expandGraphSeeds } from './graphSearch';

describe('expandGraphSeeds', () => {
  it('expands seeds across multiple hops with path tracking', async () => {
    const neighbors = new Map<string, unknown[]>([
      [
        'seed',
        [
          {
            sourceChunkId: 'seed',
            targetChunkId: 'child-a',
            linkType: 'similar',
            strength: 0.85,
            metadata: {},
            targetPromptKey: 'demo::child-a',
            targetMemoryType: 'semantic',
            targetUpdatedAt: null,
          },
          {
            sourceChunkId: 'seed',
            targetChunkId: 'child-b',
            linkType: 'related',
            strength: 0.6,
            metadata: {},
            targetPromptKey: 'demo::child-b',
            targetMemoryType: 'semantic',
            targetUpdatedAt: null,
          },
        ],
      ],
      [
        'child-a',
        [
          {
            sourceChunkId: 'child-a',
            targetChunkId: 'grandchild',
            linkType: 'related',
            strength: 0.7,
            metadata: {},
            targetPromptKey: 'demo::grandchild',
            targetMemoryType: 'semantic',
            targetUpdatedAt: null,
          },
        ],
      ],
      ['child-b', []],
      ['grandchild', []],
    ]);

    const getLinkedChunks = vi.fn(async (chunkId: string) => {
      const value = neighbors.get(chunkId) ?? [];
      return value as never;
    });

    const linkRepository = {
      getLinkedChunks,
    } as unknown as MemoryLinkRepository;

    const matches = await expandGraphSeeds({
      seeds: [
        {
          chunkId: 'seed',
          similarity: 0.9,
        },
      ],
      linkRepository,
      options: {
        maxHops: 2,
        minLinkStrength: 0.5,
        maxPerNode: 5,
        maxResults: 5,
        seedWeight: 0.7,
        linkWeight: 0.3,
      },
    });

    expect(getLinkedChunks).toHaveBeenCalledTimes(3);
    expect(matches.map((match) => match.chunkId)).toEqual(['child-a', 'child-b', 'grandchild']);
    const grandchild = matches.find((match) => match.chunkId === 'grandchild');
    expect(grandchild?.hopCount).toBe(2);
    expect(grandchild?.path).toEqual([
      {
        from: 'seed',
        to: 'child-a',
        linkType: 'similar',
        strength: 0.85,
      },
      {
        from: 'child-a',
        to: 'grandchild',
        linkType: 'related',
        strength: 0.7,
      },
    ]);
  });

  it('deduplicates matches keeping the highest score across seeds', async () => {
    const getLinkedChunks = vi.fn(async (chunkId: string) => {
      if (chunkId === 'seed-a') {
        return [
          {
            sourceChunkId: 'seed-a',
            targetChunkId: 'shared',
            linkType: 'similar',
            strength: 0.6,
            metadata: {},
            targetPromptKey: 'demo::shared',
            targetMemoryType: 'semantic',
            targetUpdatedAt: null,
          },
        ] as never;
      }

      if (chunkId === 'seed-b') {
        return [
          {
            sourceChunkId: 'seed-b',
            targetChunkId: 'shared',
            linkType: 'similar',
            strength: 0.9,
            metadata: {},
            targetPromptKey: 'demo::shared',
            targetMemoryType: 'semantic',
            targetUpdatedAt: null,
          },
        ] as never;
      }

      return [] as never;
    });

    const linkRepository = {
      getLinkedChunks,
    } as unknown as MemoryLinkRepository;

    const matches = await expandGraphSeeds({
      seeds: [
        { chunkId: 'seed-a', similarity: 0.5 },
        { chunkId: 'seed-b', similarity: 0.7 },
      ],
      linkRepository,
      options: {
        maxHops: 1,
        minLinkStrength: 0.5,
        maxPerNode: 5,
        maxResults: 10,
        seedWeight: 0.7,
        linkWeight: 0.3,
      },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      chunkId: 'shared',
      seedChunkId: 'seed-b',
    });
  });
});
