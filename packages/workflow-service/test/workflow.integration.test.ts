/**
 * Workflow Service Integration Tests
 */

import { createMockWorkOrderInput } from './setup';

describe('Workflow Service Integration', () => {
  it('should have proper types defined', () => {
    const mockInput = createMockWorkOrderInput();

    expect(mockInput.workOrderId).toBeDefined();
    expect(mockInput.workItems).toHaveLength(2);
    expect(mockInput.priority).toBe('MEDIUM');
    expect(mockInput.workItems[0].type).toBe('INVOICE');
    expect(mockInput.workItems[1].type).toBe('TICKET');
  });

  it('should export all required activity functions', async () => {
    const activities = await import('../src/activities');

    expect(activities.recordGenActivity).toBeDefined();
    expect(activities.extractorLLMActivity).toBeDefined();
    expect(activities.jsonRestylerActivity).toBeDefined();
    expect(activities.schemaGuardActivity).toBeDefined();
    expect(activities.persisterActivity).toBeDefined();
    expect(activities.verifierActivity).toBeDefined();
  });

  it('should export workflow definitions', async () => {
    const workflows = await import('../src/workflows');

    expect(workflows.docsExtractVerifyWorkflow).toBeDefined();
  });

  it('should have proper configuration constants', () => {
    const {
      DEFAULT_WORKFLOW_CONFIG,
      DEFAULT_ACTIVITY_CONFIG,
      TEMPORAL_ACTIVITY_OPTIONS,
      TEMPORAL_WORKFLOW_OPTIONS,
    } = require('../src/types/workflow');

    expect(DEFAULT_WORKFLOW_CONFIG.taskQueue).toBe('myloware-tasks');
    expect(DEFAULT_ACTIVITY_CONFIG.taskQueue).toBe('myloware-tasks');
    expect(TEMPORAL_ACTIVITY_OPTIONS.startToCloseTimeout).toBe(300000);
    expect(TEMPORAL_WORKFLOW_OPTIONS.taskQueue).toBe('myloware-tasks');
  });
});
