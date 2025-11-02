import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowRunRepository } from './workflowRunRepository';
import type { WorkflowRun, WorkflowRunStatus, WorkflowStage } from './schema';

function createMockDb() {
  const insertReturning = vi.fn().mockResolvedValue([
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
      projectId: 'aismr',
      sessionId: '123e4567-e89b-12d3-a456-426614174001',
      currentStage: 'idea_generation',
      status: 'running',
      stages: {
        idea_generation: { status: 'pending' },
        screenplay: { status: 'pending' },
        video_generation: { status: 'pending' },
        publishing: { status: 'pending' },
      },
      input: {},
      output: null,
      workflowDefinitionChunkId: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
  ]);
  const values = vi.fn().mockReturnValue({ returning: insertReturning });
  const insert = vi.fn().mockReturnValue({ values });

  const selectLimit = vi.fn().mockResolvedValue([
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
      projectId: 'aismr',
      sessionId: '123e4567-e89b-12d3-a456-426614174001',
      currentStage: 'idea_generation',
      status: 'running',
      stages: {
        idea_generation: { status: 'pending' },
        screenplay: { status: 'pending' },
        video_generation: { status: 'pending' },
        publishing: { status: 'pending' },
      },
      input: {},
      output: null,
      workflowDefinitionChunkId: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
  ]);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const updateReturning = vi.fn().mockResolvedValue([
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
      projectId: 'aismr',
      sessionId: '123e4567-e89b-12d3-a456-426614174001',
      currentStage: 'screenplay',
      status: 'waiting_for_hitl',
      stages: {
        idea_generation: { status: 'completed', output: { ideas: [] } },
        screenplay: { status: 'in_progress' },
        video_generation: { status: 'pending' },
        publishing: { status: 'pending' },
      },
      input: {},
      output: null,
      workflowDefinitionChunkId: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:01.000Z',
    },
  ]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const selectOrderBy = vi.fn().mockResolvedValue([
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
      projectId: 'aismr',
      sessionId: '123e4567-e89b-12d3-a456-426614174001',
      currentStage: 'idea_generation',
      status: 'running',
      stages: {
        idea_generation: { status: 'pending' },
        screenplay: { status: 'pending' },
        video_generation: { status: 'pending' },
        publishing: { status: 'pending' },
      },
      input: {},
      output: null,
      workflowDefinitionChunkId: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
  ]);
  const selectFromOrderBy = vi.fn().mockReturnValue({ orderBy: selectOrderBy });
  const selectFromWhere = vi.fn().mockReturnValue({
    orderBy: selectOrderBy,
    where: vi.fn().mockReturnValue({ orderBy: selectOrderBy }),
  });

  const mockDb = {
    insert,
    select: vi.fn().mockImplementation((...args) => {
      if (args.length === 0) {
        return { from: selectFromWhere };
      }
      return { from: selectFrom };
    }),
    update,
  } as Record<string, unknown>;

  return {
    mockDb,
    spies: {
      insert,
      values,
      insertReturning,
      select,
      selectFrom,
      selectWhere,
      selectLimit,
      selectOrderBy,
      update,
      updateSet,
      updateWhere,
      updateReturning,
    },
  };
}

describe('WorkflowRunRepository', () => {
  let repository: WorkflowRunRepository;
  let mockDb: Record<string, unknown>;
  let spies: ReturnType<typeof createMockDb>['spies'];

  beforeEach(() => {
    const setup = createMockDb();
    mockDb = setup.mockDb;
    spies = setup.spies;
    repository = new WorkflowRunRepository(mockDb as never);
  });

  describe('createWorkflowRun', () => {
    it('creates workflow run with correct initial state', async () => {
      const data = {
        projectId: 'aismr',
        sessionId: '123e4567-e89b-12d3-a456-426614174001',
        input: { userInput: 'lava apple' },
      };

      const result = await repository.createWorkflowRun(data);

      expect(spies.insert).toHaveBeenCalled();
      expect(spies.values).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'aismr',
          sessionId: '123e4567-e89b-12d3-a456-426614174001',
          currentStage: 'idea_generation',
          status: 'running',
          input: { userInput: 'lava apple' },
        }),
      );
      expect(result).toBeDefined();
      expect(result.currentStage).toBe('idea_generation');
      expect(result.status).toBe('running');
      expect(result.stages).toEqual({
        idea_generation: { status: 'pending' },
        screenplay: { status: 'pending' },
        video_generation: { status: 'pending' },
        publishing: { status: 'pending' },
      });
    });
  });

  describe('getWorkflowRunById', () => {
    it('retrieves workflow run by id', async () => {
      const runId = '123e4567-e89b-12d3-a456-426614174000';

      const result = await repository.getWorkflowRunById(runId);

      expect(spies.select).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result?.id).toBe(runId);
    });

    it('returns null if workflow run not found', async () => {
      spies.selectLimit.mockResolvedValueOnce([]);

      const result = await repository.getWorkflowRunById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('updateWorkflowRun', () => {
    it('updates workflow run fields', async () => {
      const runId = '123e4567-e89b-12d3-a456-426614174000';
      const updates = {
        status: 'waiting_for_hitl' as WorkflowRunStatus,
        currentStage: 'screenplay' as WorkflowStage,
      };

      const result = await repository.updateWorkflowRun(runId, updates);

      expect(spies.update).toHaveBeenCalled();
      expect(spies.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'waiting_for_hitl',
          currentStage: 'screenplay',
          updatedAt: expect.any(String),
        }),
      );
      expect(result).toBeDefined();
    });

    it('throws error if workflow run not found', async () => {
      spies.updateReturning.mockResolvedValueOnce([]);

      await expect(
        repository.updateWorkflowRun('non-existent-id', { status: 'running' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('transitionStage', () => {
    it('transitions between stages and updates jsonb correctly', async () => {
      const runId = '123e4567-e89b-12d3-a456-426614174000';
      const output = { ideas: [{ idea: 'lava apple', vibe: 'molten' }] };

      // Mock getWorkflowRunById to return existing run
      spies.selectLimit.mockResolvedValueOnce([
        {
          id: runId,
          projectId: 'aismr',
          sessionId: '123e4567-e89b-12d3-a456-426614174001',
          currentStage: 'idea_generation',
          status: 'running',
          stages: {
            idea_generation: { status: 'pending' },
            screenplay: { status: 'pending' },
            video_generation: { status: 'pending' },
            publishing: { status: 'pending' },
          },
          input: {},
          output: null,
          workflowDefinitionChunkId: null,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ]);

      await repository.transitionStage(runId, 'idea_generation', 'screenplay', output);

      expect(spies.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          currentStage: 'screenplay',
          stages: expect.objectContaining({
            idea_generation: { status: 'completed', output },
            screenplay: { status: 'in_progress' },
          }),
        }),
      );
    });
  });

  describe('listWorkflowRuns', () => {
    it('lists workflow runs with filters', async () => {
      const filters = {
        status: ['running' as WorkflowRunStatus],
        projectId: 'aismr',
      };

      const result = await repository.listWorkflowRuns(filters);

      expect(spies.select).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns all workflow runs when no filters provided', async () => {
      const result = await repository.listWorkflowRuns();

      expect(spies.select).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

