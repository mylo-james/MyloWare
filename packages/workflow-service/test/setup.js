'use strict';
/**
 * Test Setup for Workflow Service
 *
 * Global test configuration and utilities for Jest tests.
 */
Object.defineProperty(exports, '__esModule', { value: true });
exports.createMockWorkflowResult =
  exports.createMockAttemptResult =
  exports.createMockWorkOrderInput =
    void 0;
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
const createMockWorkOrderInput = (overrides = {}) => ({
  workOrderId: 'test-work-order-123',
  workItems: [
    {
      workItemId: 'test-item-1',
      type: 'INVOICE',
      content: 'Sample invoice content for testing',
      metadata: { test: true },
    },
    {
      workItemId: 'test-item-2',
      type: 'TICKET',
      content: 'Sample ticket content for testing',
      metadata: { test: true },
    },
  ],
  priority: 'MEDIUM',
  metadata: { testRun: true },
  ...overrides,
});
exports.createMockWorkOrderInput = createMockWorkOrderInput;
const createMockAttemptResult = (overrides = {}) => ({
  attemptId: 'test-attempt-123',
  status: 'COMPLETED',
  result: { test: 'data' },
  startTime: new Date(),
  endTime: new Date(),
  agentId: 'test-agent',
  metadata: { test: true },
  ...overrides,
});
exports.createMockAttemptResult = createMockAttemptResult;
const createMockWorkflowResult = (overrides = {}) => ({
  workOrderId: 'test-work-order-123',
  status: 'COMPLETED',
  completedItems: ['test-item-1', 'test-item-2'],
  failedItems: [],
  totalAttempts: 2,
  totalDuration: 5000,
  errors: [],
  ...overrides,
});
exports.createMockWorkflowResult = createMockWorkflowResult;
//# sourceMappingURL=setup.js.map
