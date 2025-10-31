import { describe, expect, it, vi } from 'vitest';
import type { ConversationSearchResult } from '../../db/episodicRepository';
import { rememberConversations } from './conversationMemoryTool';

function createResult(overrides: Partial<ConversationSearchResult> = {}): ConversationSearchResult {
  const nowIso = '2025-10-30T08:00:00.000Z';
  return {
    similarity: overrides.similarity ?? 0.9,
    chunkId: overrides.chunkId ?? 'episodic::session::turn',
    promptKey: overrides.promptKey ?? 'episodic::session',
    turn: {
      id: overrides.turn?.id ?? 'turn-1',
      sessionId: overrides.turn?.sessionId ?? 'session-1',
      userId: overrides.turn?.userId ?? 'user-1',
      role: overrides.turn?.role ?? 'user',
      turnIndex: overrides.turn?.turnIndex ?? 0,
      content: overrides.turn?.content ?? 'Example turn content for testing.',
      summary: overrides.turn?.summary ?? null,
      metadata: overrides.turn?.metadata ?? {},
      createdAt: overrides.turn?.createdAt ?? nowIso,
      updatedAt: overrides.turn?.updatedAt ?? nowIso,
    },
  };
}

describe('conversation.remember', () => {
  it('retrieves conversation turns with applied filters and formats context', async () => {
    const searchConversationHistory = vi.fn().mockResolvedValue([
      createResult({
        turn: {
          id: 'turn-1',
          sessionId: 'session-42',
          userId: 'user-9',
          role: 'user',
          turnIndex: 0,
          content: 'How did the deployment go yesterday?',
          summary: null,
          metadata: { channel: 'cli' },
          createdAt: '2025-10-28T10:00:00.000Z',
          updatedAt: '2025-10-28T10:00:00.000Z',
        },
      }),
      createResult({
        similarity: 0.78,
        turn: {
          id: 'turn-2',
          sessionId: 'session-42',
          userId: 'user-9',
          role: 'assistant',
          turnIndex: 1,
          content: 'Deployment completed successfully. Monitoring looks stable.',
          summary: { headline: 'Deployment success confirmed' },
          metadata: { channel: 'cli' },
          createdAt: '2025-10-28T10:02:00.000Z',
          updatedAt: '2025-10-28T10:02:10.000Z',
        },
      }),
    ]);

    const repository = {
      searchConversationHistory,
    } as unknown as Parameters<typeof rememberConversations>[0];

    const result = await rememberConversations(repository, {
      query: 'deployment status',
      sessionId: 'b8b9d5da-1fcd-4b60-9c25-1d4a7f63deab',
      limit: 5,
      minSimilarity: 0.3,
      timeRange: {
        start: '2025-10-27T00:00:00.000Z',
        end: '2025-10-30T00:00:00.000Z',
      },
      format: 'chat',
    });

    expect(searchConversationHistory).toHaveBeenCalledWith(
      'deployment status',
      expect.objectContaining({
        limit: 5,
        minSimilarity: 0.3,
        sessionId: 'b8b9d5da-1fcd-4b60-9c25-1d4a7f63deab',
      }),
    );

    expect(result.turns).toHaveLength(2);
    expect(result.turns[0].id).toBe('turn-1');
    expect(result.turns[1].role).toBe('assistant');
    expect(result.appliedFilters.sessionId).toBe('b8b9d5da-1fcd-4b60-9c25-1d4a7f63deab');
    expect(result.context).toContain('How did the deployment go yesterday?');
    expect(result.context).toContain('Deployment completed successfully.');
  });

  it('returns empty context when no matches found', async () => {
    const repository = {
      searchConversationHistory: vi.fn().mockResolvedValue([]),
    } as unknown as Parameters<typeof rememberConversations>[0];

    const result = await rememberConversations(repository, {
      query: 'nonexistent topic',
      limit: 3,
    });

    expect(result.turns).toHaveLength(0);
    expect(result.context).toBe('');
  });

  it('supports bullet formatting with keyword enrichment', async () => {
    const repository = {
      searchConversationHistory: vi.fn().mockResolvedValue([
        createResult({
          turn: {
            id: 'turn-11',
            sessionId: 'session-xyz',
            userId: null,
            role: 'assistant',
            turnIndex: 3,
            content: 'Reminder: rotate the API key for the staging environment by Friday.',
            summary: null,
            metadata: {},
            createdAt: '2025-10-30T07:45:00.000Z',
            updatedAt: '2025-10-30T07:45:00.000Z',
          },
        }),
      ]),
    } as unknown as Parameters<typeof rememberConversations>[0];

    const result = await rememberConversations(repository, {
      query: 'API key rotation',
      format: 'bullets',
    });

    expect(result.context).toContain('- (assistant)');
    expect(result.appliedFilters.format).toBe('bullets');
  });
});
