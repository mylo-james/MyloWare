import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HITLRepository } from './hitlRepository';
import type { HITLApproval, HITLApprovalStatus, WorkflowStage } from './schema';

function createMockDb() {
  const insertReturning = vi.fn().mockResolvedValue([
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
      workflowRunId: '123e4567-e89b-12d3-a456-426614174001',
      stage: 'idea_generation',
      content: { ideas: [] },
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      feedback: null,
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  ]);
  const values = vi.fn().mockReturnValue({ returning: insertReturning });
  const insert = vi.fn().mockReturnValue({ values });

  const selectLimit = vi.fn().mockResolvedValue([
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
      workflowRunId: '123e4567-e89b-12d3-a456-426614174001',
      stage: 'idea_generation',
      content: { ideas: [] },
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      feedback: null,
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  ]);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const updateReturning = vi.fn().mockResolvedValue([
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
      workflowRunId: '123e4567-e89b-12d3-a456-426614174001',
      stage: 'idea_generation',
      content: { ideas: [] },
      status: 'approved',
      reviewedBy: 'reviewer@example.com',
      reviewedAt: '2025-01-01T00:01:00.000Z',
      feedback: 'Looks good!',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  ]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const selectOrderBy = vi.fn().mockResolvedValue([
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
      workflowRunId: '123e4567-e89b-12d3-a456-426614174001',
      stage: 'idea_generation',
      content: { ideas: [] },
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      feedback: null,
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  ]);
  const selectFromOrderBy = vi.fn().mockReturnValue({ orderBy: selectOrderBy });
  const selectInnerJoin = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: selectOrderBy }) });

  const mockDb = {
    insert,
    select: vi.fn().mockImplementation((...args) => {
      if (args.length === 0) {
        return { from: selectFromOrderBy, innerJoin: selectInnerJoin };
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
      selectInnerJoin,
    },
  };
}

describe('HITLRepository', () => {
  let repository: HITLRepository;
  let mockDb: Record<string, unknown>;
  let spies: ReturnType<typeof createMockDb>['spies'];

  beforeEach(() => {
    const setup = createMockDb();
    mockDb = setup.mockDb;
    spies = setup.spies;
    repository = new HITLRepository(mockDb as never);
  });

  describe('createHITLApproval', () => {
    it('creates HITL approval with status pending', async () => {
      const data = {
        workflowRunId: '123e4567-e89b-12d3-a456-426614174001',
        stage: 'idea_generation' as WorkflowStage,
        content: { ideas: [{ idea: 'lava apple', vibe: 'molten' }] },
      };

      const result = await repository.createHITLApproval(data);

      expect(spies.insert).toHaveBeenCalled();
      expect(spies.values).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: data.workflowRunId,
          stage: data.stage,
          content: data.content,
          status: 'pending',
          reviewedBy: null,
          reviewedAt: null,
          feedback: null,
        }),
      );
      expect(result).toBeDefined();
      expect(result.status).toBe('pending');
    });
  });

  describe('getHITLApproval', () => {
    it('retrieves HITL approval by id', async () => {
      const approvalId = '123e4567-e89b-12d3-a456-426614174000';

      const result = await repository.getHITLApproval(approvalId);

      expect(spies.select).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result?.id).toBe(approvalId);
    });

    it('returns null if approval not found', async () => {
      spies.selectLimit.mockResolvedValueOnce([]);

      const result = await repository.getHITLApproval('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('updateHITLApproval', () => {
    it('updates approval status and timestamps', async () => {
      const approvalId = '123e4567-e89b-12d3-a456-426614174000';
      const updates = {
        status: 'approved' as HITLApprovalStatus,
        reviewedBy: 'reviewer@example.com',
        reviewedAt: '2025-01-01T00:01:00.000Z',
        feedback: 'Looks good!',
      };

      const result = await repository.updateHITLApproval(approvalId, updates);

      expect(spies.update).toHaveBeenCalled();
      expect(spies.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'approved',
          reviewedBy: 'reviewer@example.com',
          reviewedAt: '2025-01-01T00:01:00.000Z',
          feedback: 'Looks good!',
        }),
      );
      expect(result).toBeDefined();
      expect(result.status).toBe('approved');
    });

    it('throws error if approval not found', async () => {
      spies.updateReturning.mockResolvedValueOnce([]);

      await expect(
        repository.updateHITLApproval('non-existent-id', { status: 'approved' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('getPendingApprovals', () => {
    it('filters approvals by status pending', async () => {
      const filters = {};

      const result = await repository.getPendingApprovals(filters);

      expect(spies.select).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('filters by stage', async () => {
      const filters = { stage: 'idea_generation' as WorkflowStage };

      const result = await repository.getPendingApprovals(filters);

      expect(spies.select).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('filters by workflowRunId', async () => {
      const filters = { workflowRunId: '123e4567-e89b-12d3-a456-426614174001' };

      const result = await repository.getPendingApprovals(filters);

      expect(spies.select).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('filters by projectId with join', async () => {
      const filters = { projectId: 'aismr' };

      const result = await repository.getPendingApprovals(filters);

      expect(spies.select).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('getApprovalsByWorkflowRun', () => {
    it('retrieves all approvals for a workflow run', async () => {
      const workflowRunId = '123e4567-e89b-12d3-a456-426614174001';

      const result = await repository.getApprovalsByWorkflowRun(workflowRunId);

      expect(spies.select).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

