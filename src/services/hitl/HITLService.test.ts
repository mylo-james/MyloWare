import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HITLService } from './HITLService';
import { NotificationService } from './NotificationService';
import { WorkflowRunRepository } from '../../db/operations/workflowRunRepository';
import { HITLRepository } from '../../db/operations/hitlRepository';
import { EpisodicMemoryRepository } from '../../db/episodicRepository';
import type { HITLApproval, WorkflowRun } from '../../db/operations/schema';

describe('HITLService', () => {
  let service: HITLService;
  let mockWorkflowRunRepo: vi.Mocked<WorkflowRunRepository>;
  let mockHITLRepo: vi.Mocked<HITLRepository>;
  let mockNotificationService: vi.Mocked<NotificationService>;
  let mockEpisodicRepo: vi.Mocked<EpisodicMemoryRepository>;

  beforeEach(() => {
    mockWorkflowRunRepo = {
      getWorkflowRunById: vi.fn(),
      updateWorkflowRun: vi.fn(),
    } as never;

    mockHITLRepo = {
      createHITLApproval: vi.fn(),
      getHITLApproval: vi.fn(),
      updateHITLApproval: vi.fn(),
      getPendingApprovals: vi.fn(),
    } as never;

    mockNotificationService = {
      notify: vi.fn(),
    } as never;

    mockEpisodicRepo = {
      storeConversationTurn: vi.fn(),
    } as never;

    service = new HITLService(
      mockWorkflowRunRepo,
      mockHITLRepo,
      mockNotificationService,
      mockEpisodicRepo,
    );

    // Mock fetch globally
    global.fetch = vi.fn();
  });

  describe('requestApproval', () => {
    it('creates approval and updates workflow run', async () => {
      const workflowRun: WorkflowRun = {
        id: 'run-1',
        projectId: 'aismr',
        sessionId: 'session-1',
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
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      const approval: HITLApproval = {
        id: 'approval-1',
        workflowRunId: 'run-1',
        stage: 'idea_generation',
        content: { ideas: [] },
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        feedback: null,
        createdAt: '2025-01-01T00:00:00Z',
      };

      mockWorkflowRunRepo.getWorkflowRunById.mockResolvedValue(workflowRun);
      mockHITLRepo.createHITLApproval.mockResolvedValue(approval);
      mockWorkflowRunRepo.updateWorkflowRun.mockResolvedValue(workflowRun);
      mockNotificationService.notify.mockResolvedValue();

      const result = await service.requestApproval({
        workflowRunId: 'run-1',
        stage: 'idea_generation',
        content: { ideas: [] },
        notifyChannels: ['slack'],
      });

      expect(mockWorkflowRunRepo.getWorkflowRunById).toHaveBeenCalledWith('run-1');
      expect(mockHITLRepo.createHITLApproval).toHaveBeenCalledWith({
        workflowRunId: 'run-1',
        stage: 'idea_generation',
        content: { ideas: [] },
      });
      expect(mockWorkflowRunRepo.updateWorkflowRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'waiting_for_hitl',
          stages: expect.objectContaining({
            idea_generation: { status: 'awaiting_approval' },
          }),
        }),
      );
      expect(mockNotificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          channels: ['slack'],
          message: expect.stringContaining('idea_generation'),
        }),
      );
      expect(result).toEqual(approval);
    });

    it('throws error if workflow run not found', async () => {
      mockWorkflowRunRepo.getWorkflowRunById.mockResolvedValue(null);

      await expect(
        service.requestApproval({
          workflowRunId: 'non-existent',
          stage: 'idea_generation',
          content: {},
        }),
      ).rejects.toThrow('not found');
    });
  });

  describe('approve', () => {
    it('updates approval and resumes workflow', async () => {
      const approval: HITLApproval = {
        id: 'approval-1',
        workflowRunId: 'run-1',
        stage: 'idea_generation',
        content: { ideas: [] },
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        feedback: null,
        createdAt: '2025-01-01T00:00:00Z',
      };

      const workflowRun: WorkflowRun = {
        id: 'run-1',
        projectId: 'aismr',
        sessionId: 'session-1',
        currentStage: 'idea_generation',
        status: 'waiting_for_hitl',
        stages: {
          idea_generation: { status: 'awaiting_approval' },
          screenplay: { status: 'pending' },
          video_generation: { status: 'pending' },
          publishing: { status: 'pending' },
        },
        input: {},
        output: null,
        workflowDefinitionChunkId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockHITLRepo.getHITLApproval.mockResolvedValue(approval);
      mockHITLRepo.updateHITLApproval.mockResolvedValue({
        ...approval,
        status: 'approved',
        reviewedBy: 'reviewer@example.com',
        reviewedAt: '2025-01-01T00:01:00Z',
      });
      mockWorkflowRunRepo.getWorkflowRunById.mockResolvedValue(workflowRun);
      mockWorkflowRunRepo.updateWorkflowRun.mockResolvedValue(workflowRun);
      mockEpisodicRepo.storeConversationTurn.mockResolvedValue({
        turn: {
          id: 'turn-1',
          sessionId: 'session-1',
          userId: null,
          role: 'tool',
          turnIndex: 1,
          content: '',
          summary: null,
          metadata: {},
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
        chunkId: 'chunk-1',
        promptKey: 'key-1',
        isNewSession: false,
      });
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
      } as Response);

      await service.approve('approval-1', {
        reviewedBy: 'reviewer@example.com',
        selectedItem: { idea: 'lava apple' },
        feedback: 'Great idea!',
      });

      expect(mockHITLRepo.updateHITLApproval).toHaveBeenCalledWith(
        'approval-1',
        expect.objectContaining({
          status: 'approved',
          reviewedBy: 'reviewer@example.com',
          feedback: 'Great idea!',
        }),
      );
      expect(mockWorkflowRunRepo.updateWorkflowRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'running',
          stages: expect.objectContaining({
            idea_generation: {
              status: 'approved',
              output: { idea: 'lava apple' },
            },
          }),
        }),
      );
      expect(mockEpisodicRepo.storeConversationTurn).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/hitl/resume/run-1'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  describe('reject', () => {
    it('updates approval status and workflow run', async () => {
      const approval: HITLApproval = {
        id: 'approval-1',
        workflowRunId: 'run-1',
        stage: 'idea_generation',
        content: { ideas: [] },
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        feedback: null,
        createdAt: '2025-01-01T00:00:00Z',
      };

      const workflowRun: WorkflowRun = {
        id: 'run-1',
        projectId: 'aismr',
        sessionId: 'session-1',
        currentStage: 'idea_generation',
        status: 'waiting_for_hitl',
        stages: {
          idea_generation: { status: 'awaiting_approval' },
          screenplay: { status: 'pending' },
          video_generation: { status: 'pending' },
          publishing: { status: 'pending' },
        },
        input: {},
        output: null,
        workflowDefinitionChunkId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockHITLRepo.getHITLApproval.mockResolvedValue(approval);
      mockHITLRepo.updateHITLApproval.mockResolvedValue({
        ...approval,
        status: 'rejected',
        reviewedBy: 'reviewer@example.com',
        reviewedAt: '2025-01-01T00:01:00Z',
        feedback: 'Not unique enough',
      });
      mockWorkflowRunRepo.getWorkflowRunById.mockResolvedValue(workflowRun);
      mockWorkflowRunRepo.updateWorkflowRun.mockResolvedValue(workflowRun);
      mockEpisodicRepo.storeConversationTurn.mockResolvedValue({
        turn: {
          id: 'turn-1',
          sessionId: 'session-1',
          userId: null,
          role: 'tool',
          turnIndex: 1,
          content: '',
          summary: null,
          metadata: {},
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
        chunkId: 'chunk-1',
        promptKey: 'key-1',
        isNewSession: false,
      });

      await service.reject('approval-1', {
        reviewedBy: 'reviewer@example.com',
        reason: 'Not unique enough',
      });

      expect(mockHITLRepo.updateHITLApproval).toHaveBeenCalledWith(
        'approval-1',
        expect.objectContaining({
          status: 'rejected',
          reviewedBy: 'reviewer@example.com',
          feedback: 'Not unique enough',
        }),
      );
      expect(mockWorkflowRunRepo.updateWorkflowRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'needs_revision',
          stages: expect.objectContaining({
            idea_generation: {
              status: 'rejected',
              error: 'Not unique enough',
            },
          }),
        }),
      );
      expect(mockEpisodicRepo.storeConversationTurn).toHaveBeenCalled();
    });
  });

  describe('getPendingApprovals', () => {
    it('delegates to repository', async () => {
      const approvals: HITLApproval[] = [];
      mockHITLRepo.getPendingApprovals.mockResolvedValue(approvals);

      const result = await service.getPendingApprovals({ stage: 'idea_generation' });

      expect(mockHITLRepo.getPendingApprovals).toHaveBeenCalledWith({
        stage: 'idea_generation',
      });
      expect(result).toEqual(approvals);
    });
  });
});

