import { jest } from '@jest/globals';
import { TemporalWorkerService } from '../src/services/temporal-worker.service';

jest.mock('@temporalio/worker', () => ({
  NativeConnection: { connect: jest.fn(async () => ({ close: jest.fn() })) },
  Worker: {
    create: jest.fn(async () => ({ run: jest.fn(async () => undefined), shutdown: jest.fn() })),
  },
}));

describe('TemporalWorkerService', () => {
  it('starts, reports health/metrics, and stops', async () => {
    const svc = new TemporalWorkerService();
    await svc.start();
    expect(svc.getHealthStatus().isRunning).toBe(true);

    const m = await svc.getMetrics();
    expect(m.namespace).toBeDefined();

    await svc.stop();
    expect(svc.getHealthStatus().isRunning).toBe(false);
  });
});
