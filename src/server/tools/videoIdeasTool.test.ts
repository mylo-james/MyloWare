import { describe, expect, it, vi } from 'vitest';
import type { OperationsRepository, Video } from '../../db/operations';
import { fetchVideoIdeasSnapshot } from './videoIdeasTool';

function createVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video-1',
    runId: 'run-1',
    projectId: 'project-1',
    idea: 'void puppy',
    userIdea: 'puppy',
    vibe: 'A warm void with drifting pups.',
    prompt: null,
    videoLink: null,
    status: 'idea_gen',
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2025-11-03T00:00:00.000Z',
    updatedAt: '2025-11-03T00:00:00.000Z',
    metadata: {},
    ...overrides,
  } as Video;
}

describe('fetchVideoIdeasSnapshot', () => {
  it('returns a snapshot scoped by project with status filtering', async () => {
    const repository = {
      listVideosByProject: vi
        .fn()
        .mockResolvedValue([
          createVideo(),
          createVideo({ id: 'video-2', idea: 'velvet puppy', status: 'complete' }),
        ]),
      listVideosByRun: vi.fn(),
    } as unknown as OperationsRepository;

    const snapshot = await fetchVideoIdeasSnapshot(repository, {
      projectId: '123e4567-e89b-12d3-a456-426614174000',
      status: ['idea_gen', 'complete'],
      limit: 2,
    });

    expect(repository.listVideosByProject).toHaveBeenCalledWith(
      '123e4567-e89b-12d3-a456-426614174000',
      {
        status: ['idea_gen', 'complete'],
        limit: 2,
      },
    );
    expect(snapshot.count).toBe(2);
    expect(snapshot.projectId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(snapshot.statusFilter).toEqual(['idea_gen', 'complete']);
    expect(snapshot.videos[0]).not.toHaveProperty('metadata');
  });

  it('scopes to a run and includes metadata when requested', async () => {
    const repository = {
      listVideosByProject: vi.fn(),
      listVideosByRun: vi.fn().mockResolvedValue([
        createVideo({
          id: 'video-run',
          runId: 'run-99',
          projectId: 'project-99',
          metadata: { uniqueness: 'ok' },
        }),
      ]),
    } as unknown as OperationsRepository;

    const snapshot = await fetchVideoIdeasSnapshot(repository, {
      runId: 'run-99',
      includeMetadata: true,
    });

    expect(repository.listVideosByRun).toHaveBeenCalledWith('run-99', {
      status: undefined,
      limit: 200,
    });
    expect(snapshot.runId).toBe('run-99');
    expect(snapshot.videos[0].metadata).toEqual({ uniqueness: 'ok' });
  });
});
