import { jest } from '@jest/globals';
import { TemporalClientService } from '../src/services/temporal-client.service';

jest.mock('@temporalio/client', () => ({
  Connection: { connect: jest.fn(async () => ({ close: jest.fn() })) },
  Client: jest.fn().mockImplementation(() => ({
    workflow: {
      start: jest.fn(async () => ({ workflowId: 'wf1', firstExecutionRunId: 'run1' })),
      getHandle: jest.fn((id: string) => ({
        workflowId: id,
        query: jest.fn(async () => ({ status: 'COMPLETED' })),
        signal: jest.fn(async () => undefined),
        result: jest.fn(async () => ({
          status: 'COMPLETED',
          completedItems: [],
          failedItems: [],
          totalAttempts: 0,
          totalDuration: 0,
        })),
      })),
      list: jest.fn(async function* () {
        yield { workflowId: 'wf1', runId: 'run1', status: { name: 'RUNNING' } } as any;
      }),
    },
  })),
}));

describe('TemporalClientService', () => {
  it('initializes, starts workflow, queries, signals, waits, lists, and closes', async () => {
    const svc = new TemporalClientService('localhost', 7233, 'default');
    await svc.initialize();

    const handle = await svc.startDocsExtractVerifyWorkflow({
      workOrderId: 'WO1',
      workItems: [],
      priority: 'MEDIUM',
    } as any);
    expect(handle.workflowId).toBe('wf1');

    const status = await svc.getWorkflowStatus('wf1');
    expect(status).toBeDefined();

    await svc.pauseWorkflow('wf1');
    await svc.resumeWorkflow('wf1');
    await svc.cancelWorkflow('wf1');

    const result = await svc.waitForWorkflowCompletion('wf1');
    expect(result.status).toBe('COMPLETED');

    const list = await svc.listWorkflows();
    expect(list.length).toBeGreaterThanOrEqual(1);

    await svc.close();
  });
});
