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
import type { Run, Video } from '../../db/operations';

describe('registerApiRoutes', () => {
  let app: FastifyInstance;
  let promptRepository: PromptEmbeddingsRepositoryMock;
  let operationsRepository: OperationsRepositoryMock;
  const embedMock = vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));

  beforeEach(async () => {
    promptRepository = createPromptRepositoryMock();
    operationsRepository = createOperationsRepositoryMock();
    app = fastify();
    await registerApiRoutes(app, {
      promptRepository,
      operationsRepository,
      embedTexts: embedMock,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.resetAllMocks();
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
    expect(embedMock).toHaveBeenCalled();
  });

  it('creates and retrieves runs via REST endpoints', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        projectId: 'project-1',
        personaId: 'persona-1',
        status: 'pending',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json().data.run;

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/runs/${created.id}`,
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().data.run.projectId).toBe('project-1');
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
    await registerApiRoutes(localApp, {
      promptRepository,
      operationsRepository: null,
      embedTexts: embedMock,
    });
    await localApp.ready();

    const response = await localApp.inject({
      method: 'GET',
      url: '/api/runs/run-1',
    });

    expect(response.statusCode).toBe(503);
    await localApp.close();
  });
});

type PromptEmbeddingsRepositoryMock = PromptEmbeddingsRepository & {
  listPrompts: ReturnType<typeof vi.fn>;
  getChunksByPromptKey: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
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
    },
    {
      promptKey: 'ideagenerator',
      metadata: {
        persona: ['ideagenerator'],
        type: 'persona',
      },
      chunkCount: 1,
      updatedAt: '2025-01-01T00:00:00.000Z',
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
    updatedAt: '2025-01-01T00:00:00.000Z',
  };

  const listPrompts = vi.fn(async (filters: PromptLookupFilters = {}) => {
    return summaries.filter((summary) => {
      const metadata = summary.metadata as { persona?: string[]; project?: string[]; type?: string };
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
      },
    ];
  });

  const search = vi.fn(async (): Promise<SearchResult[]> => [
    {
      chunkId: 'checksum-document-0',
      promptKey: 'ideagenerator-aismr',
      chunkText: 'Prompt content body.',
      rawSource: 'Prompt content body.',
      metadata: documentChunk.metadata,
      similarity: 0.9,
    },
  ]);

  return {
    listPrompts,
    getChunksByPromptKey,
    search,
  } as unknown as PromptEmbeddingsRepositoryMock;
}

type OperationsRepositoryMock = OperationsRepository & {
  runs: Map<string, Run>;
  videos: Map<string, Video>;
};

function createOperationsRepositoryMock(): OperationsRepositoryMock {
  const runs = new Map<string, Run>();
  const videos = new Map<string, Video>();

  const mock: Partial<OperationsRepository> & {
    runs: Map<string, Run>;
    videos: Map<string, Video>;
  } = {
    runs,
    videos,
    async createRun(data) {
      const id = data.id ?? randomUUID();
      const now = new Date().toISOString();
      const run: Run = {
        id,
        projectId: data.projectId,
        personaId: data.personaId ?? null,
        chatId: data.chatId ?? null,
        status: data.status ?? 'pending',
        result: data.result ?? null,
        input: data.input ?? {},
        metadata: data.metadata ?? {},
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      runs.set(id, run);
      return run;
    },
    async getRunById(runId: string) {
      return runs.get(runId) ?? null;
    },
    async updateRun(runId: string, data) {
      const existing = runs.get(runId);
      if (!existing) {
        return null;
      }
      const updated: Run = {
        ...existing,
        ...data,
        input: data.input ?? existing.input,
        metadata: data.metadata ?? existing.metadata,
        updatedAt: new Date().toISOString(),
      };
      runs.set(runId, updated);
      return updated;
    },
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
      const filtered = options.status && options.status.length
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
