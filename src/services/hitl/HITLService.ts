import { EpisodicMemoryRepository } from '../../db/episodicRepository';
import { WorkflowRunRepository } from '../../db/operations/workflowRunRepository';
import { HITLRepository } from '../../db/operations/hitlRepository';
import { NotificationService, type NotifyParams } from './NotificationService';
import { NotFoundError } from '../../types/errors';
import type {
  WorkflowRun,
  HITLApproval,
  WorkflowStage,
  WorkflowRunStatus,
} from '../../db/operations/schema';

export interface RequestApprovalParams {
  workflowRunId: string;
  stage: WorkflowStage;
  content: unknown;
  notifyChannels?: string[];
}

export interface ApproveParams {
  reviewedBy: string;
  selectedItem?: unknown;
  feedback?: string;
}

export interface RejectParams {
  reviewedBy: string;
  reason: string;
}

export interface HITLFilters {
  stage?: WorkflowStage;
  projectId?: string;
}

export class HITLService {
  constructor(
    private workflowRunRepo: WorkflowRunRepository = new WorkflowRunRepository(),
    private hitlRepo: HITLRepository = new HITLRepository(),
    private notificationService: NotificationService = new NotificationService(),
    private episodicRepo: EpisodicMemoryRepository = new EpisodicMemoryRepository(),
  ) {}

  async requestApproval(params: RequestApprovalParams): Promise<HITLApproval> {
    // Validate workflow run exists (throws NotFoundError if not found)
    const workflowRun = await this.workflowRunRepo.getWorkflowRunById(
      params.workflowRunId,
    );

    // Create HITL approval record
    const approval = await this.hitlRepo.createHITLApproval({
      workflowRunId: params.workflowRunId,
      stage: params.stage,
      content: params.content,
    });

    // Update workflow run status
    const stages = workflowRun.stages as Record<
      string,
      { status: string; output?: unknown; error?: string }
    >;

    stages[params.stage] = {
      ...stages[params.stage],
      status: 'awaiting_approval',
    };

    await this.workflowRunRepo.updateWorkflowRun(params.workflowRunId, {
      status: 'waiting_for_hitl',
      stages,
    });

    // Extract Telegram chat ID from workflow run input
    const input = workflowRun.input as Record<string, unknown> | null;
    const telegramChatId = input?.telegramChatId as string | undefined;

    // Determine notification channels - prefer Telegram if available
    const channels = params.notifyChannels || (telegramChatId ? ['telegram'] : ['slack']);

    // Send notification
    await this.notificationService.notify({
      channels,
      message: `🔔 *${params.stage} Approval Needed*\n\nProject: ${workflowRun.projectId}\n\nReview the content and reply to approve or reject.`,
      link: `/hitl/review/${approval.id}`,
      data: params.content,
      telegramChatId,
    });

    return approval;
  }

  async approve(approvalId: string, params: ApproveParams): Promise<void> {
    const approval = await this.hitlRepo.getHITLApproval(approvalId);

    if (!approval) {
      throw new NotFoundError(`HITL approval with id ${approvalId} not found`);
    }

    const reviewedAt = new Date().toISOString();

    // Update approval status
    await this.hitlRepo.updateHITLApproval(approvalId, {
      status: 'approved',
      reviewedBy: params.reviewedBy,
      reviewedAt,
      feedback: params.feedback || null,
    });

    // Update workflow run status (throws NotFoundError if not found)
    const workflowRun = await this.workflowRunRepo.getWorkflowRunById(
      approval.workflowRunId,
    );

    const stages = workflowRun.stages as Record<
      string,
      { status: string; output?: unknown; error?: string }
    >;

    stages[approval.stage] = {
      ...stages[approval.stage],
      status: 'approved',
      output: params.selectedItem || approval.content,
    };

    await this.workflowRunRepo.updateWorkflowRun(approval.workflowRunId, {
      status: 'running',
      stages,
    });

    // Store approval in episodic memory
    await this.storeApprovalInMemory(approval, {
      reviewedBy: params.reviewedBy,
      selectedItem: params.selectedItem,
      feedback: params.feedback,
      reviewedAt,
    });

    // Resume workflow via webhook
    await this.resumeWorkflow(approval.workflowRunId, {
      stage: approval.stage,
      approved: true,
      selectedItem: params.selectedItem || approval.content,
      feedback: params.feedback,
    });
  }

  async reject(approvalId: string, params: RejectParams): Promise<void> {
    const approval = await this.hitlRepo.getHITLApproval(approvalId);

    if (!approval) {
      throw new NotFoundError(`HITL approval with id ${approvalId} not found`);
    }

    const reviewedAt = new Date().toISOString();

    // Update approval status
    await this.hitlRepo.updateHITLApproval(approvalId, {
      status: 'rejected',
      reviewedBy: params.reviewedBy,
      reviewedAt,
      feedback: params.reason,
    });

    // Update workflow run status (throws NotFoundError if not found)
    const workflowRun = await this.workflowRunRepo.getWorkflowRunById(
      approval.workflowRunId,
    );

    const stages = workflowRun.stages as Record<
      string,
      { status: string; output?: unknown; error?: string }
    >;

    stages[approval.stage] = {
      ...stages[approval.stage],
      status: 'rejected',
      error: params.reason,
    };

    await this.workflowRunRepo.updateWorkflowRun(approval.workflowRunId, {
      status: 'needs_revision',
      stages,
    });

    // Store rejection in episodic memory for learning
    await this.storeRejectionInMemory(approval, {
      reviewedBy: params.reviewedBy,
      reason: params.reason,
      reviewedAt,
    });
  }

  async getPendingApprovals(filters: HITLFilters = {}): Promise<HITLApproval[]> {
    return this.hitlRepo.getPendingApprovals(filters);
  }

  async getApproval(id: string): Promise<HITLApproval | null> {
    return this.hitlRepo.getHITLApproval(id);
  }

  private async resumeWorkflow(
    workflowRunId: string,
    data: unknown,
  ): Promise<void> {
    const n8nWebhookBase = process.env.N8N_WEBHOOK_BASE || 'http://localhost:5678';

    try {
      const response = await fetch(`${n8nWebhookBase}/hitl/resume/${workflowRunId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`Failed to resume workflow: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Failed to resume workflow ${workflowRunId}:`, error);
      // Don't throw - we've already updated the database, logging is sufficient
    }
  }

  private async storeApprovalInMemory(
    approval: HITLApproval,
    params: {
      reviewedBy: string;
      selectedItem?: unknown;
      feedback?: string;
      reviewedAt: string;
    },
  ): Promise<void> {
    const workflowRun = await this.workflowRunRepo.getWorkflowRunById(
      approval.workflowRunId,
    );

    if (!workflowRun) {
      return;
    }

    const content = JSON.stringify({
      type: 'hitl_approval',
      approvalId: approval.id,
      workflowRunId: approval.workflowRunId,
      stage: approval.stage,
      reviewedBy: params.reviewedBy,
      selectedItem: params.selectedItem,
      feedback: params.feedback,
      reviewedAt: params.reviewedAt,
    });

    await this.episodicRepo.storeConversationTurn({
      sessionId: workflowRun.sessionId,
      role: 'tool',
      content,
      metadata: {
        source: 'hitl.approve',
        stage: approval.stage,
        projectId: workflowRun.projectId,
        approvalId: approval.id,
      },
    });
  }

  private async storeRejectionInMemory(
    approval: HITLApproval,
    params: {
      reviewedBy: string;
      reason: string;
      reviewedAt: string;
    },
  ): Promise<void> {
    const workflowRun = await this.workflowRunRepo.getWorkflowRunById(
      approval.workflowRunId,
    );

    if (!workflowRun) {
      return;
    }

    const content = JSON.stringify({
      type: 'hitl_rejection',
      approvalId: approval.id,
      workflowRunId: approval.workflowRunId,
      stage: approval.stage,
      reviewedBy: params.reviewedBy,
      reason: params.reason,
      reviewedAt: params.reviewedAt,
    });

    await this.episodicRepo.storeConversationTurn({
      sessionId: workflowRun.sessionId,
      role: 'tool',
      content,
      metadata: {
        source: 'hitl.reject',
        stage: approval.stage,
        projectId: workflowRun.projectId,
        approvalId: approval.id,
      },
    });
  }
}
