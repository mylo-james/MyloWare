import { randomUUID } from 'node:crypto';
import fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerApiRoutes } from './api';
import type {
  PromptEmbeddingsRepository,
  PromptChunk,
  PromptSummary,
  PromptLookupFilters,
  SearchResult,
} from '../../db/repository';
import type { OperationsRepository } from '../../db/operations';
import type { Video } from '../../db/operations';
import type {
  ConversationTurnRecord,
  EpisodicMemoryRepository,
  StoreConversationTurnResult,
} from '../../db/episodicRepository';

import type { EnhancedQuery } from '../../vector/queryEnhancer';

const enhanceMock = vi.fn<(query: string, options?: unknown) => Promise<EnhancedQuery>>();

describe('registerApiRoutes', () => {
  let app: FastifyInstance;
  let promptRepository: PromptEmbeddingsRepositoryMock;
  let operationsRepository: OperationsRepositoryMock;
  let episodicRepository: EpisodicMemoryRepositoryMock;
  const embedMock = vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));

  beforeEach(async () => {
    promptRepository = createPromptRepositoryMock();
    operationsRepository = createOperationsRepositoryMock();
    episodicRepository = createEpisodicRepositoryMock();
    enhanceMock.mockResolvedValue({
      intent: 'general_knowledge',
      confidence: 0,
      persona: undefined,
      project: undefined,
      appliedPersona: false,
      appliedProject: false,
      notes: [],
    });
    app = fastify();
    await registerApiRoutes(app, {
      promptRepository,
      operationsRepository,
      embedTexts: embedMock,
      enhanceQuery: enhanceMock,
      episodicRepository: episodicRepository as unknown as EpisodicMemoryRepository,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.resetAllMocks();
    enhanceMock.mockReset();
  });

  it('resolves a prompt via /api/prompts/resolve', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/prompts/resolve?project=aismr&persona=ideagenerator',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.prompt.promptKey).toBe('ideagenerator-aismr');
    expect(body.data.resolution.strategy).toBe('exact');
  });

  it('returns 404 when prompt cannot be resolved', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/prompts/resolve?persona=unknown',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe('PROMPT_NOT_FOUND');
  });

  it('performs prompt search via /api/prompts/search', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/prompts/search?q=aismr',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.matches).toHaveLength(1);
    expect(body.data.graph).toBeNull();
    expect(embedMock).toHaveBeenCalled();
  });

  it('creates and updates videos via REST endpoints', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/videos',
      payload: {
        runId: 'run-1',
        projectId: 'project-1',
        idea: 'Test Idea',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json().data.video;

    const updateResponse = await app.inject({
      method: 'PUT',
      url: `/api/videos/${created.id}`,
      payload: {
        status: 'script_gen',
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().data.video.status).toBe('script_gen');
  });

  it('lists videos by project with status filters', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/videos',
      payload: {
        runId: 'run-1',
        projectId: 'project-2',
        idea: 'Idea A',
        status: 'idea_gen',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/videos',
      payload: {
        runId: 'run-1',
        projectId: 'project-2',
        idea: 'Idea B',
        status: 'script_gen',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/videos?project=project-2&status=script_gen',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.videos).toHaveLength(1);
    expect(body.data.videos[0].idea).toBe('Idea B');
  });

  it('returns 503 when operations repository is unavailable', async () => {
    const localApp = fastify();
    const localEpisodicRepository = createEpisodicRepositoryMock();
    await registerApiRoutes(localApp, {
      promptRepository,
      operationsRepository: null,
      embedTexts: embedMock,
      episodicRepository: localEpisodicRepository as unknown as EpisodicMemoryRepository,
    });
    await localApp.ready();

    const response = await localApp.inject({
      method: 'GET',
      url: '/api/videos/video-1',
    });

    expect(response.statusCode).toBe(503);
    await localApp.close();
  });

  it('stores conversation turns via /api/conversation/store', async () => {
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const timestamp = '2025-10-30T12:00:00.000Z';
    const storeResult: StoreConversationTurnResult = {
      turn: {
        id: turnId,
        sessionId,
        userId: null,
        role: 'user',
        turnIndex: 0,
        content: 'Hello world',
        summary: null,
        metadata: { preview: 'Hello world' },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      chunkId: `episodic::${sessionId}::${turnId}`,
      promptKey: `episodic::${sessionId}`,
      isNewSession: true,
    };
    episodicRepository.storeConversationTurn.mockResolvedValueOnce(storeResult);

    const response = await app.inject({
      method: 'POST',
      url: '/api/conversation/store',
      payload: {
        sessionId,
        role: 'user',
        content: 'Hello world',
        metadata: { source: 'telegram' },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data.turn).toEqual(storeResult.turn);
    expect(body.data.chunkId).toBe(storeResult.chunkId);
    expect(episodicRepository.storeConversationTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        role: 'user',
        content: 'Hello world',
        metadata: { source: 'telegram' },
      }),
    );
  });

  it('recalls conversation history via /api/conversation/recall', async () => {
    const sessionId = randomUUID();
    const timestamp = '2025-10-30T13:00:00.000Z';
    const turns: ConversationTurnRecord[] = [
      {
        id: randomUUID(),
        sessionId,
        userId: null,
        role: 'assistant',
        turnIndex: 0,
        content: 'Response content',
        summary: null,
        metadata: { preview: 'Response content' },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    episodicRepository.getSessionHistory.mockResolvedValueOnce(turns);

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversation/recall?sessionId=${sessionId}&limit=5`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.turns).toEqual(turns);
    expect(episodicRepository.getSessionHistory).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ limit: 5, order: 'desc' }),
    );
  });

  it('returns 503 when episodic repository is unavailable', async () => {
    const localApp = fastify();
    await registerApiRoutes(localApp, {
      promptRepository,
      operationsRepository,
      embedTexts: embedMock,
      episodicRepository: null,
    });
    await localApp.ready();

    const response = await localApp.inject({
      method: 'POST',
      url: '/api/conversation/store',
      payload: {
        sessionId: randomUUID(),
        role: 'user',
        content: 'Hello',
      },
    });

    expect(response.statusCode).toBe(503);
    await localApp.close();
  });
});

type PromptEmbeddingsRepositoryMock = PromptEmbeddingsRepository & {
  listPrompts: ReturnType<typeof vi.fn>;
  getChunksByPromptKey: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  searchWithGraphExpansion: ReturnType<typeof vi.fn>;
  keywordSearch: ReturnType<typeof vi.fn>;
};

function createPromptRepositoryMock(): PromptEmbeddingsRepositoryMock {
  const summaries: PromptSummary[] = [
    {
      promptKey: 'ideagenerator-aismr',
      metadata: {
        persona: ['ideagenerator'],
        project: ['aismr'],
        type: 'combination',
      },
      chunkCount: 2,
      updatedAt: '2025-01-01T00:00:00.000Z',
      memoryType: 'semantic',
    },
    {
      promptKey: 'ideagenerator',
      metadata: {
        persona: ['ideagenerator'],
        type: 'persona',
      },
      chunkCount: 1,
      updatedAt: '2025-01-01T00:00:00.000Z',
      memoryType: 'persona',
    },
  ];

  const documentChunk: PromptChunk = {
    chunkId: 'checksum-document-0',
    promptKey: 'ideagenerator-aismr',
    chunkText: 'Prompt content body.',
    rawSource: 'Prompt content body.',
    granularity: 'document',
    metadata: {
      persona: ['ideagenerator'],
      project: ['aismr'],
      type: 'combination',
    },
    checksum: 'checksum',
    memoryType: 'semantic',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };

  const listPrompts = vi.fn(async (filters: PromptLookupFilters = {}) => {
    return summaries.filter((summary) => {
      const metadata = summary.metadata as {
        persona?: string[];
        project?: string[];
        type?: string;
      };
      if (filters.persona && !(metadata.persona ?? []).includes(filters.persona)) {
        return false;
      }
      if (filters.project && !(metadata.project ?? []).includes(filters.project)) {
        return false;
      }
      if (filters.type && metadata.type !== filters.type) {
        return false;
      }
      return true;
    });
  });

  const getChunksByPromptKey = vi.fn(async (promptKey: string) => {
    if (promptKey === 'ideagenerator-aismr') {
      return [documentChunk];
    }

    return [
      {
        ...documentChunk,
        promptKey,
        memoryType: promptKey === 'ideagenerator' ? 'persona' : documentChunk.memoryType,
      },
    ];
  });

  const search = vi.fn(
    async (): Promise<SearchResult[]> => [
      {
        chunkId: 'checksum-document-0',
        promptKey: 'ideagenerator-aismr',
        chunkText: 'Prompt content body.',
        rawSource: 'Prompt content body.',
        metadata: documentChunk.metadata,
        similarity: 0.9,
        ageDays: null,
        temporalDecayApplied: false,
        memoryType: documentChunk.memoryType,
      },
    ],
  );

  const searchWithGraphExpansion = vi.fn(
    async (): Promise<SearchResult[]> => [
      {
        chunkId: 'checksum-document-0',
        promptKey: 'ideagenerator-aismr',
        chunkText: 'Prompt content body.',
        rawSource: 'Prompt content body.',
        metadata: documentChunk.metadata,
        similarity: 0.9,
        ageDays: null,
        temporalDecayApplied: false,
        memoryType: documentChunk.memoryType,
      },
    ],
  );

  const keywordSearch = vi.fn(
    async (): Promise<SearchResult[]> => [
      {
        chunkId: 'checksum-document-0',
        promptKey: 'ideagenerator-aismr',
        chunkText: 'Prompt content body.',
        rawSource: 'Prompt content body.',
        metadata: documentChunk.metadata,
        similarity: 0.85,
        ageDays: null,
        temporalDecayApplied: false,
        memoryType: documentChunk.memoryType,
      },
    ],
  );

  return {
    listPrompts,
    getChunksByPromptKey,
    search,
    searchWithGraphExpansion,
    keywordSearch,
  } as unknown as PromptEmbeddingsRepositoryMock;
}

type EpisodicMemoryRepositoryMock = Pick<
  EpisodicMemoryRepository,
  'storeConversationTurn' | 'getSessionHistory'
> & {
  storeConversationTurn: ReturnType<typeof vi.fn>;
  getSessionHistory: ReturnType<typeof vi.fn>;
};

function createEpisodicRepositoryMock(): EpisodicMemoryRepositoryMock {
  return {
    storeConversationTurn: vi.fn(),
    getSessionHistory: vi.fn(),
  } as unknown as EpisodicMemoryRepositoryMock;
}

type OperationsRepositoryMock = OperationsRepository & {
  videos: Map<string, Video>;
};

function createOperationsRepositoryMock(): OperationsRepositoryMock {
  const videos = new Map<string, Video>();

  const mock: Partial<OperationsRepository> & {
    videos: Map<string, Video>;
  } = {
    videos,
    async getVideoById(videoId: string) {
      return videos.get(videoId) ?? null;
    },
    async createVideo(data) {
      const id = data.id ?? randomUUID();
      const now = new Date().toISOString();
      const video: Video = {
        id,
        runId: data.runId,
        projectId: data.projectId,
        idea: data.idea,
        userIdea: data.userIdea ?? null,
        vibe: data.vibe ?? null,
        prompt: data.prompt ?? null,
        videoLink: data.videoLink ?? null,
        status: data.status ?? 'idea_gen',
        errorMessage: data.errorMessage ?? null,
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
        createdAt: now,
        updatedAt: now,
        metadata: data.metadata ?? {},
      };
      videos.set(id, video);
      return video;
    },
    async updateVideo(videoId: string, data) {
      const existing = videos.get(videoId);
      if (!existing) {
        return null;
      }
      const updated: Video = {
        ...existing,
        ...data,
        metadata: data.metadata ?? existing.metadata,
        updatedAt: new Date().toISOString(),
      };
      videos.set(videoId, updated);
      return updated;
    },
    async listVideosByProject(projectId: string, options = {}) {
      const all = Array.from(videos.values()).filter((video) => video.projectId === projectId);
      const filtered =
        options.status && options.status.length
          ? all.filter((video) => options.status?.includes(video.status))
          : all;
      if (options.limit && options.limit > 0) {
        return filtered.slice(0, options.limit);
      }
      return filtered;
    },
  };

  return mock as OperationsRepositoryMock;
}
