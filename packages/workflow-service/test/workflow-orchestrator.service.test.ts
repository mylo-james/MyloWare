import { jest } from '@jest/globals';
import { WorkflowOrchestratorService } from '../src/services/workflow-orchestrator.service';

// Mock shared notification utilities to avoid running scripts
jest.mock('@myloware/shared', () => ({
  __esModule: true,
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  withTaskCompletion: async (_: string, fn: () => Promise<any>) => fn(),
  notifyTaskSuccess: jest.fn(async () => undefined),
  setupCompletionGuardrails: () => jest.fn(),
}));

class TemporalClientServiceMock {
  startDocsExtractVerifyWorkflow = jest.fn(async () => ({ workflowId: 'wf1' }));
  waitForWorkflowCompletion = jest.fn(async () => ({
    status: 'COMPLETED',
    completedItems: [],
    failedItems: [],
    totalAttempts: 0,
    totalDuration: 0,
  }));
}

describe('WorkflowOrchestratorService', () => {
  it('executes workflow and returns result with notifications', async () => {
    const temporal = new TemporalClientServiceMock() as any;
    const svc = new WorkflowOrchestratorService(temporal);
    const result = await svc.executeWorkflow({
      workOrderId: 'wo1',
      priority: 'MEDIUM',
      workItems: [],
    } as any);

    expect(temporal.startDocsExtractVerifyWorkflow).toHaveBeenCalled();
    expect(temporal.waitForWorkflowCompletion).toHaveBeenCalled();
    expect(result.status).toBe('COMPLETED');
  });
});
