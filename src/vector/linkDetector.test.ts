import { describe, expect, it, vi } from 'vitest';
import { MemoryLinkGenerator, LinkDetector } from './linkDetector';

describe('LinkDetector', () => {
  it('classifies neighbors into similar and related links', async () => {
    const promptRepository = {
      getChunkEmbedding: vi.fn().mockResolvedValue({
        chunkId: 'chunk-root',
        promptKey: 'demo::root',
        embedding: [0.1, 0.2, 0.3],
        memoryType: 'semantic',
        metadata: {},
      }),
      search: vi.fn().mockResolvedValue([
        {
          chunkId: 'chunk-root',
          promptKey: 'demo::root',
          chunkText: 'root',
          rawSource: 'root',
          metadata: {},
          similarity: 1,
          ageDays: null,
          temporalDecayApplied: false,
          memoryType: 'semantic',
        },
        {
          chunkId: 'chunk-similar',
          promptKey: 'demo::similar',
          chunkText: 'similar',
          rawSource: 'similar',
          metadata: {},
          similarity: 0.82,
          ageDays: null,
          temporalDecayApplied: false,
          memoryType: 'semantic',
        },
        {
          chunkId: 'chunk-related',
          promptKey: 'demo::related',
          chunkText: 'related',
          rawSource: 'related',
          metadata: {},
          similarity: 0.58,
          ageDays: null,
          temporalDecayApplied: false,
          memoryType: 'semantic',
        },
        {
          chunkId: 'chunk-weak',
          promptKey: 'demo::weak',
          chunkText: 'weak',
          rawSource: 'weak',
          metadata: {},
          similarity: 0.3,
          ageDays: null,
          temporalDecayApplied: false,
          memoryType: 'semantic',
        },
      ]),
    };

    const detector = new LinkDetector({
      promptRepository: promptRepository as never,
      config: {
        similarThreshold: 0.75,
        relatedThreshold: 0.5,
        minStrength: 0.4,
        topK: 10,
        bidirectional: false,
      },
      now: () => new Date('2025-10-30T00:00:00Z'),
    });

    const candidates = await detector.generateCandidates('chunk-root');

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      sourceChunkId: 'chunk-root',
      targetChunkId: 'chunk-similar',
      linkType: 'similar',
    });
    expect(candidates[1]).toMatchObject({
      sourceChunkId: 'chunk-root',
      targetChunkId: 'chunk-related',
      linkType: 'related',
    });
    expect(promptRepository.search).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding: [0.1, 0.2, 0.3],
        limit: 10,
        minSimilarity: 0.5,
      }),
    );
  });
});

describe('MemoryLinkGenerator', () => {
  it('persists generated links for each chunk', async () => {
    const promptRepository = {
      getChunkEmbedding: vi.fn().mockResolvedValue({
        chunkId: 'chunk-root',
        promptKey: 'demo::root',
        embedding: [0.1, 0.2, 0.3],
        memoryType: 'semantic',
        metadata: {},
      }),
      search: vi.fn().mockResolvedValue([
        {
          chunkId: 'chunk-similar',
          promptKey: 'demo::similar',
          chunkText: 'similar',
          rawSource: 'similar',
          metadata: {},
          similarity: 0.82,
          ageDays: null,
          temporalDecayApplied: false,
          memoryType: 'semantic',
        },
      ]),
    };

    const linkRepository = {
      upsertLinks: vi.fn().mockResolvedValue(1),
    };

    const generator = new MemoryLinkGenerator({
      promptRepository: promptRepository as never,
      linkRepository: linkRepository as never,
      config: {
        topK: 5,
        similarThreshold: 0.75,
        relatedThreshold: 0.5,
        minStrength: 0.4,
        bidirectional: false,
      },
      now: () => new Date('2025-10-30T00:00:00Z'),
    });

    const result = await generator.generateForChunk('chunk-root');

    expect(result.createdCount).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(linkRepository.upsertLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        sourceChunkId: 'chunk-root',
        targetChunkId: 'chunk-similar',
        linkType: 'similar',
      }),
    ]);
  });

  it('aggregates summary across multiple chunks', async () => {
    const promptRepository = {
      getChunkEmbedding: vi.fn().mockImplementation(async (chunkId: string) => ({
        chunkId,
        promptKey: `demo::${chunkId}`,
        embedding: [0.2, 0.3, 0.4],
        memoryType: 'semantic',
        metadata: {},
      })),
      search: vi.fn().mockResolvedValue([]),
    };
    const linkRepository = {
      upsertLinks: vi.fn().mockResolvedValue(0),
    };

    const generator = new MemoryLinkGenerator({
      promptRepository: promptRepository as never,
      linkRepository: linkRepository as never,
      config: {
        topK: 5,
        similarThreshold: 0.75,
        relatedThreshold: 0.5,
        minStrength: 0.45,
        bidirectional: true,
      },
      now: () => new Date('2025-10-30T00:00:00Z'),
    });

    const summary = await generator.generateForChunks(['chunk-a', 'chunk-b']);

    expect(summary.totalChunks).toBe(2);
    expect(summary.totalCandidates).toBe(0);
    expect(summary.totalCreated).toBe(0);
    expect(linkRepository.upsertLinks).toHaveBeenCalledTimes(0);
  });
});
