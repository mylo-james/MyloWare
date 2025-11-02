import { WorkflowRunRepository } from '../db/operations/workflowRunRepository';
import type { WorkflowStage, WorkflowRunStatus } from '../db/operations/schema';
import type { ExecutionContext } from '../types/workflow';

/**
 * WorkflowStateManager - Manages workflow state across stages
 *
 * Provides clean inter-workflow communication via API endpoints
 * and workflow run state tracking.
 */
export class WorkflowStateManager {
  constructor(private workflowRunRepo: WorkflowRunRepository = new WorkflowRunRepository()) {}

  /**
   * Get stage output from a previous workflow stage
   */
  async getStageOutput(
    workflowRunId: string,
    stage: WorkflowStage,
  ): Promise<unknown | null> {
    const workflowRun = await this.workflowRunRepo.getWorkflowRunById(workflowRunId);

    if (!workflowRun) {
      throw new Error(`Workflow run ${workflowRunId} not found`);
    }

    const stages = workflowRun.stages as Record<
      string,
      { status: string; output?: unknown; error?: string }
    >;

    const stageData = stages[stage];
    return stageData?.output ?? null;
  }

  /**
   * Set stage output after stage completion
   */
  async setStageOutput(
    workflowRunId: string,
    stage: WorkflowStage,
    output: unknown,
  ): Promise<void> {
    const workflowRun = await this.workflowRunRepo.getWorkflowRunById(workflowRunId);

    if (!workflowRun) {
      throw new Error(`Workflow run ${workflowRunId} not found`);
    }

    const stages = (workflowRun.stages as Record<
      string,
      { status: string; output?: unknown; error?: string }
    >) || {};

    stages[stage] = {
      ...stages[stage],
      status: 'completed',
      output,
    };

    await this.workflowRunRepo.updateWorkflowRun(workflowRunId, {
      stages: stages as never,
      currentStage: stage,
    });
  }

  /**
   * Mark stage as running
   */
  async markStageRunning(
    workflowRunId: string,
    stage: WorkflowStage,
  ): Promise<void> {
    const workflowRun = await this.workflowRunRepo.getWorkflowRunById(workflowRunId);

    if (!workflowRun) {
      throw new Error(`Workflow run ${workflowRunId} not found`);
    }

    const stages = (workflowRun.stages as Record<
      string,
      { status: string; output?: unknown; error?: string }
    >) || {};

    stages[stage] = {
      ...stages[stage],
      status: 'running',
    };

    await this.workflowRunRepo.updateWorkflowRun(workflowRunId, {
      stages: stages as never,
      currentStage: stage,
      status: 'running',
    });
  }

  /**
   * Mark stage as failed
   */
  async markStageFailed(
    workflowRunId: string,
    stage: WorkflowStage,
    error: string,
  ): Promise<void> {
    const workflowRun = await this.workflowRunRepo.getWorkflowRunById(workflowRunId);

    if (!workflowRun) {
      throw new Error(`Workflow run ${workflowRunId} not found`);
    }

    const stages = (workflowRun.stages as Record<
      string,
      { status: string; output?: unknown; error?: string }
    >) || {};

    stages[stage] = {
      ...stages[stage],
      status: 'failed',
      error,
    };

    await this.workflowRunRepo.updateWorkflowRun(workflowRunId, {
      stages: stages as never,
      status: 'failed',
    });
  }

  /**
   * Get execution context for a workflow run
   */
  async getExecutionContext(workflowRunId: string): Promise<ExecutionContext | null> {
    const workflowRun = await this.workflowRunRepo.getWorkflowRunById(workflowRunId);

    if (!workflowRun) {
      return null;
    }

    // Collect outputs from all completed stages
    const stages = workflowRun.stages as Record<
      string,
      { status: string; output?: unknown; error?: string }
    >;

    const stepResults: Record<string, unknown> = {};

    for (const [stageName, stageData] of Object.entries(stages)) {
      if (stageData.status === 'completed' && stageData.output) {
        stepResults[stageName] = stageData.output;
      }
    }

    return {
      workflowRunId: workflowRun.id,
      sessionId: workflowRun.sessionId,
      projectId: workflowRun.projectId,
      userInput: (workflowRun.input as Record<string, unknown>)?.userInput as string || '',
      stepResults,
    };
  }

  /**
   * Check if stage is ready to execute (depends on previous stages being complete)
   */
  async isStageReady(
    workflowRunId: string,
    stage: WorkflowStage,
    requiredStages: WorkflowStage[],
  ): Promise<boolean> {
    const workflowRun = await this.workflowRunRepo.getWorkflowRunById(workflowRunId);

    if (!workflowRun) {
      return false;
    }

    const stages = workflowRun.stages as Record<
      string,
      { status: string; output?: unknown; error?: string }
    >;

    // Check if all required stages are completed
    for (const requiredStage of requiredStages) {
      const requiredStageData = stages[requiredStage];
      if (!requiredStageData || requiredStageData.status !== 'completed') {
        return false;
      }
    }

    return true;
  }

  /**
   * Complete workflow run
   */
  async completeWorkflow(workflowRunId: string, finalOutput: unknown): Promise<void> {
    await this.workflowRunRepo.updateWorkflowRun(workflowRunId, {
      status: 'completed',
      output: finalOutput as never,
    });
  }
}

