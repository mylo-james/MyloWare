/**
 * Test Setup for Workflow Service
 *
 * Global test configuration and utilities for Jest tests.
 */

import { createLogger } from '@myloware/shared';

// Set test environment
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'ERROR'; // Reduce log noise in tests

// Mock console methods to reduce test output noise
const originalConsole = console;
global.console = {
  ...originalConsole,
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: originalConsole.error, // Keep error logs for debugging
};

// Global test timeout
jest.setTimeout(30000);

// Mock external dependencies
jest.mock('@temporalio/worker', () => ({
  Worker: {
    create: jest.fn().mockResolvedValue({
      run: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn(),
    }),
  },
  NativeConnection: {
    connect: jest.fn().mockResolvedValue({
      close: jest.fn(),
    }),
  },
}));

jest.mock('@temporalio/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    workflow: {
      start: jest.fn(),
      getHandle: jest.fn(),
      list: jest.fn().mockReturnValue([]),
    },
  })),
  Connection: {
    connect: jest.fn().mockResolvedValue({
      close: jest.fn(),
    }),
  },
}));

// Test utilities
export const createMockWorkOrderInput = (overrides: any = {}) => ({
  workOrderId: 'test-work-order-123',
  workItems: [
    {
      workItemId: 'test-item-1',
      type: 'INVOICE' as const,
      content: 'Sample invoice content for testing',
      metadata: { test: true },
    },
    {
      workItemId: 'test-item-2',
      type: 'TICKET' as const,
      content: 'Sample ticket content for testing',
      metadata: { test: true },
    },
  ],
  priority: 'MEDIUM' as const,
  metadata: { testRun: true },
  ...overrides,
});

export const createMockAttemptResult = (overrides: any = {}) => ({
  attemptId: 'test-attempt-123',
  status: 'COMPLETED' as const,
  result: { test: 'data' },
  startTime: new Date(),
  endTime: new Date(),
  agentId: 'test-agent',
  metadata: { test: true },
  ...overrides,
});

export const createMockWorkflowResult = (overrides: any = {}) => ({
  workOrderId: 'test-work-order-123',
  status: 'COMPLETED' as const,
  completedItems: ['test-item-1', 'test-item-2'],
  failedItems: [],
  totalAttempts: 2,
  totalDuration: 5000,
  errors: [],
  ...overrides,
});
