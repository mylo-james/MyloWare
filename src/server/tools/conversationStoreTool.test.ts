import { describe, expect, it, vi } from 'vitest';
import type { StoreConversationTurnInput } from '../../db/episodicRepository';
import { storeConversationTurn } from './conversationStoreTool';

function createRepositoryStub() {
  const storeConversationTurn = vi.fn(async (params: StoreConversationTurnInput) => ({
    turn: {
      id: 'turn-1',
      sessionId: params.sessionId,
      userId: params.userId ?? null,
      role: params.role,
      turnIndex: 0,
      content: params.content,
      summary: params.summary ?? null,
      metadata: params.metadata ?? {},
      createdAt: '2025-10-30T08:00:00.000Z',
      updatedAt: '2025-10-30T08:00:00.000Z',
    },
    chunkId: `episodic::${params.sessionId}::turn-1`,
    promptKey: `episodic::${params.sessionId}`,
    isNewSession: true,
  }));

  return {
    storeConversationTurn,
  };
}

describe('conversation_store tool', () => {
  it('stores a conversation turn with normalized metadata and tags', async () => {
    const repository = createRepositoryStub();

    const result = await storeConversationTurn(repository as never, {
      sessionId: '5cf73633-a22d-43ec-9b28-6f4bee6f909d',
      role: 'assistant',
      content: ' Deployment succeeded with zero errors.  ',
      userId: 'agent-1',
      summary: { headline: 'Deployment succeeded' },
      metadata: { channel: 'cli' },
      tags: ['deployment', 'summary', 'deployment'],
    });

    expect(repository.storeConversationTurn).toHaveBeenCalledTimes(1);
    const call = repository.storeConversationTurn.mock.calls[0][0];

    expect(call.sessionId).toBe('5cf73633-a22d-43ec-9b28-6f4bee6f909d');
    expect(call.content).toBe('Deployment succeeded with zero errors.');
    expect(call.metadata).toMatchObject({
      channel: 'cli',
      source: 'conversation.store',
      tags: ['deployment', 'summary'],
    });
    expect(result.chunkId).toBe('episodic::5cf73633-a22d-43ec-9b28-6f4bee6f909d::turn-1');
  });

  it('generates a session id when one is not provided', async () => {
    const repository = createRepositoryStub();

    const result = await storeConversationTurn(
      repository as never,
      {
        role: 'user',
        content: 'Hello agent',
      },
      {
        generateSessionId: () => 'generated-session-id',
      },
    );

    const call = repository.storeConversationTurn.mock.calls[0][0];
    expect(call.sessionId).toBe('generated-session-id');
    expect(result.turn.sessionId).toBe('generated-session-id');
  });

  it('preserves existing source metadata and respects occurredAt hints', async () => {
    const repository = createRepositoryStub();

    await storeConversationTurn(repository as never, {
      sessionId: 'd6c1ab7e-1c35-4d89-8a3f-5b90917f1bf9',
      role: 'assistant',
      content: 'Reminder to rotate API keys.',
      metadata: { source: 'custom-source' },
      occurredAt: '2025-10-30T07:45:00.000Z',
    });

    const call = repository.storeConversationTurn.mock.calls[0][0];
    expect(call.metadata?.source).toBe('custom-source');
    expect(call.metadata?.occurred_at).toBe('2025-10-30T07:45:00.000Z');
  });
});
