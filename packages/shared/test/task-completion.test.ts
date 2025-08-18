import { jest } from '@jest/globals';
import {
  withTaskCompletion,
  notifyTaskSuccess,
  notifyTaskFailure,
  setupCompletionGuardrails,
} from '../src/utils/task-completion';

// Mock child_process to avoid actually running notification scripts
jest.mock('child_process', () => ({
  execFileSync: jest.fn(() => undefined),
}));

describe('task-completion utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('withTaskCompletion: resolves and notifies on success', async () => {
    const result = await withTaskCompletion(
      'Test Task Success',
      async () => {
        return 42;
      },
      { includeDetails: true }
    );

    expect(result).toBe(42);
    const { execFileSync } = require('child_process');
    expect(execFileSync).toHaveBeenCalled();
  });

  it('withTaskCompletion: rejects and notifies on failure', async () => {
    const error = new Error('boom');
    await expect(
      withTaskCompletion('Test Task Failure', async () => {
        throw error;
      })
    ).rejects.toThrow('boom');

    const { execFileSync } = require('child_process');
    expect(execFileSync).toHaveBeenCalled();
  });

  it('notifyTaskSuccess and notifyTaskFailure: send notifications', async () => {
    await notifyTaskSuccess('Manual Success', 'done');
    await notifyTaskFailure('Manual Failure', 'bad');

    const { execFileSync } = require('child_process');
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it('setupCompletionGuardrails: returns a completion marker', async () => {
    const markCompleted = setupCompletionGuardrails('Guarded Task');
    expect(typeof markCompleted).toBe('function');
    // Mark completion to avoid triggering failure path
    markCompleted();
  });
});
