import { WorkflowRunRepository } from '../../db/repositories/workflow-run-repository.js';

export interface WorkflowStatusParams {
  workflowRunId: string;
}

export interface WorkflowStatusResult {
  workflowRunId: string;
  workflowName: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
}

/**
 * Get workflow run status
 *
 * @param params - Status query parameters
 * @returns Workflow run status
 */
export async function getWorkflowStatus(
  params: WorkflowStatusParams
): Promise<WorkflowStatusResult> {
  const repository = new WorkflowRunRepository();

  const run = await repository.findById(params.workflowRunId);

  if (!run) {
    throw new Error(`Workflow run not found: ${params.workflowRunId}`);
  }

  return {
    workflowRunId: run.id,
    workflowName: run.workflowName,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() || null,
    input: run.input,
    output: run.output,
    error: run.error,
  };
}

