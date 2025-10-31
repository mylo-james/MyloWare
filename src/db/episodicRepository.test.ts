import { describe, expect, it, vi } from 'vitest';
import { EpisodicMemoryRepository } from './episodicRepository';
import type { PromptEmbeddingsRepository } from './repository';

function createSqlStubResult<T>(rows: T[]): { rows: T[] } {
  return { rows };
}

describe('EpisodicMemoryRepository', () => {
  it('stores conversation turns and upserts episodic embeddings', async () => {
    const mockTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(createSqlStubResult([{ next_index: 0 }]))
        .mockResolvedValueOnce(
          createSqlStubResult([
            {
              id: 'turn-1',
              session_id: 'session-123',
              user_id: 'user-42',
              role: 'user',
              turn_index: 0,
              content: 'Hello world',
              summary: null,
              metadata: { channel: 'cli' },
              created_at: '2025-10-30T07:00:00.000Z',
              updated_at: '2025-10-30T07:00:00.000Z',
            },
          ]),
        ),
    };

    const mockDb = {
      transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
      execute: vi.fn(),
    };

    const upsertEmbeddings = vi.fn().mockResolvedValue(undefined);
    const mockPromptRepo: Partial<PromptEmbeddingsRepository> = {
      upsertEmbeddings,
    };

    const promptRepoFactory = vi.fn().mockReturnValue(mockPromptRepo);
    const embed = vi.fn().mockResolvedValue([[0.11, 0.22, 0.33]]);

    const repository = new EpisodicMemoryRepository({
      db: mockDb as unknown as any,
      embed,
      promptRepositoryFactory: promptRepoFactory,
    });

    const result = await repository.storeConversationTurn({
      sessionId: 'session-123',
      content: 'Hello world',
      role: 'user',
      userId: 'user-42',
      metadata: { channel: 'cli' },
    });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.execute).toHaveBeenCalledTimes(2);
    expect(promptRepoFactory).toHaveBeenCalledWith(mockTx);
    expect(upsertEmbeddings).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(['Hello world']);

    const embeddingRecord = upsertEmbeddings.mock.calls[0][0][0];
    expect(embeddingRecord.memoryType).toBe('episodic');
    expect(embeddingRecord.chunkId).toBe('episodic::session-123::turn-1');
    expect(embeddingRecord.metadata).toMatchObject({
      session_id: 'session-123',
      turn_id: 'turn-1',
      role: 'user',
      user_id: 'user-42',
      channel: 'cli',
    });

    expect(result.isNewSession).toBe(true);
    expect(result.turn.turnIndex).toBe(0);
    expect(result.turn.sessionId).toBe('session-123');
    expect(result.chunkId).toBe('episodic::session-123::turn-1');
  });

  it('persists sequential turns within a session and writes embeddings for each', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(createSqlStubResult([{ next_index: 0 }]))
      .mockResolvedValueOnce(
        createSqlStubResult([
          {
            id: 'turn-1',
            session_id: 'session-789',
            user_id: 'agent-99',
            role: 'assistant',
            turn_index: 0,
            content: 'First turn',
            summary: null,
            metadata: {},
            created_at: '2025-10-30T08:00:00.000Z',
            updated_at: '2025-10-30T08:00:00.000Z',
          },
        ]),
      )
      .mockResolvedValueOnce(createSqlStubResult([{ next_index: 1 }]))
      .mockResolvedValueOnce(
        createSqlStubResult([
          {
            id: 'turn-2',
            session_id: 'session-789',
            user_id: 'agent-99',
            role: 'assistant',
            turn_index: 1,
            content: 'Second turn',
            summary: null,
            metadata: {},
            created_at: '2025-10-30T08:01:00.000Z',
            updated_at: '2025-10-30T08:01:00.000Z',
          },
        ]),
      );

    const promptRepo = {
      upsertEmbeddings: vi.fn().mockResolvedValue(undefined),
    };

    const promptRepoFactory = vi.fn().mockReturnValue(promptRepo);
    const embed = vi
      .fn()
      .mockResolvedValueOnce([[0.11, 0.22]])
      .mockResolvedValueOnce([[0.33, 0.44]]);

    const mockDb = {
      transaction: vi.fn(async (fn: (tx: { execute: typeof execute }) => Promise<unknown>) =>
        fn({ execute }),
      ),
    };

    const repository = new EpisodicMemoryRepository({
      db: mockDb as never,
      promptRepositoryFactory: promptRepoFactory,
      embed,
    });

    const first = await repository.storeConversationTurn({
      sessionId: 'session-789',
      content: 'First turn',
      role: 'assistant',
      userId: 'agent-99',
    });

    const second = await repository.storeConversationTurn({
      sessionId: 'session-789',
      content: 'Second turn',
      role: 'assistant',
      userId: 'agent-99',
    });

    expect(first.isNewSession).toBe(true);
    expect(first.turn.turnIndex).toBe(0);
    expect(second.isNewSession).toBe(false);
    expect(second.turn.turnIndex).toBe(1);

    expect(embed).toHaveBeenCalledTimes(2);
    expect(promptRepoFactory).toHaveBeenCalledTimes(2);
    expect(promptRepo.upsertEmbeddings).toHaveBeenCalledTimes(2);

    const firstEmbeddingCall = promptRepo.upsertEmbeddings.mock.calls[0][0][0];
    const secondEmbeddingCall = promptRepo.upsertEmbeddings.mock.calls[1][0][0];

    expect(firstEmbeddingCall.chunkId).toBe('episodic::session-789::turn-1');
    expect(secondEmbeddingCall.chunkId).toBe('episodic::session-789::turn-2');
    expect(secondEmbeddingCall.metadata).toMatchObject({
      session_id: 'session-789',
      turn_index: 1,
    });

    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('retrieves ordered session history within a time range', async () => {
    const mockDb = {
      transaction: vi.fn(),
      execute: vi.fn().mockResolvedValueOnce(
        createSqlStubResult([
          {
            id: 'turn-2',
            session_id: 'session-abc',
            user_id: null,
            role: 'assistant',
            turn_index: 1,
            content: 'Assistant reply',
            summary: null,
            metadata: {},
            created_at: '2025-10-30T07:01:00.000Z',
            updated_at: '2025-10-30T07:01:01.000Z',
          },
          {
            id: 'turn-1',
            session_id: 'session-abc',
            user_id: 'user-123',
            role: 'user',
            turn_index: 0,
            content: 'User question',
            summary: null,
            metadata: {},
            created_at: '2025-10-30T07:00:00.000Z',
            updated_at: '2025-10-30T07:00:00.000Z',
          },
        ]),
      ),
    };

    const repository = new EpisodicMemoryRepository({
      db: mockDb as unknown as any,
    });

    const history = await repository.getSessionHistory('session-abc', {
      order: 'desc',
      limit: 2,
    });

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe('turn-2');
    expect(history[1].id).toBe('turn-1');
  });

  it('searches episodic memory using embeddings and metadata filters', async () => {
    const mockDb = {
      transaction: vi.fn(),
      execute: vi.fn().mockResolvedValueOnce(
        createSqlStubResult([
          {
            id: 'turn-1',
            session_id: 'session-xyz',
            user_id: 'user-55',
            role: 'user',
            turn_index: 0,
            content: 'First message',
            summary: null,
            metadata: {},
            created_at: '2025-10-30T07:10:00.000Z',
            updated_at: '2025-10-30T07:10:00.000Z',
          },
        ]),
      ),
    };

    const search = vi.fn().mockResolvedValue([
      {
        chunkId: 'episodic::session-xyz::turn-1',
        promptKey: 'episodic::session-xyz',
        similarity: 0.82,
        metadata: {
          session_id: 'session-xyz',
          turn_id: 'turn-1',
          user_id: 'user-55',
          created_at: '2025-10-30T07:10:00.000Z',
        },
      },
      {
        chunkId: 'episodic::other::turn-x',
        promptKey: 'episodic::other',
        similarity: 0.4,
        metadata: {
          session_id: 'other',
          turn_id: 'turn-x',
          user_id: 'user-999',
        },
      },
    ]);

    const promptRepoFactory = vi.fn().mockReturnValue({
      search,
    });

    const embed = vi.fn().mockResolvedValue([[0.9, 0.1]]);

    const repository = new EpisodicMemoryRepository({
      db: mockDb as unknown as any,
      embed,
      promptRepositoryFactory: promptRepoFactory,
    });

    const results = await repository.searchConversationHistory('remember this', {
      sessionId: 'session-xyz',
      userId: 'user-55',
    });

    expect(embed).toHaveBeenCalledWith(['remember this']);
    expect(promptRepoFactory).toHaveBeenCalledWith(mockDb);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryTypes: ['episodic'],
      }),
    );
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].turn.id).toBe('turn-1');
    expect(results[0].similarity).toBeCloseTo(0.82);
  });

  it('lists sessions with aggregated metadata', async () => {
    const mockDb = {
      transaction: vi.fn(),
      execute: vi.fn().mockResolvedValueOnce(
        createSqlStubResult([
          {
            session_id: 'session-1',
            turn_count: '3',
            started_at: '2025-10-29T10:00:00.000Z',
            ended_at: '2025-10-29T10:05:00.000Z',
            user_id: 'user-1',
          },
          {
            session_id: 'session-2',
            turn_count: '1',
            started_at: '2025-10-30T08:00:00.000Z',
            ended_at: '2025-10-30T08:01:00.000Z',
            user_id: null,
          },
        ]),
      ),
    };

    const repository = new EpisodicMemoryRepository({
      db: mockDb as unknown as any,
    });

    const sessions = await repository.listSessions({ limit: 5 });

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(sessions).toEqual([
      {
        sessionId: 'session-1',
        userId: 'user-1',
        turnCount: 3,
        startedAt: '2025-10-29T10:00:00.000Z',
        endedAt: '2025-10-29T10:05:00.000Z',
      },
      {
        sessionId: 'session-2',
        userId: null,
        turnCount: 1,
        startedAt: '2025-10-30T08:00:00.000Z',
        endedAt: '2025-10-30T08:01:00.000Z',
      },
    ]);
  });
});
