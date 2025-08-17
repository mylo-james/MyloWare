'use strict';
/**
 * RecordGen Activity Tests
 */
Object.defineProperty(exports, '__esModule', { value: true });
const activity_1 = require('@temporalio/activity');
const record_gen_activity_1 = require('../src/activities/record-gen.activity');
const setup_1 = require('./setup');
// Mock the Temporal activity context
jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn(() => ({
      info: {
        activityId: 'test-activity-123',
        startTime: new Date(),
      },
      heartbeat: jest.fn(),
    })),
  },
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
describe('RecordGen Activity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset random to ensure deterministic tests
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it('should successfully generate records for valid input', async () => {
    const input = {
      workOrderId: 'test-work-order-123',
      workItems: (0, setup_1.createMockWorkOrderInput)().workItems,
    };
    const result = await (0, record_gen_activity_1.recordGenActivity)(input);
    expect(result.success).toBe(true);
    expect(result.recordsCreated).toBe(5); // 1 work order + 2 work items + 2 attempts
    expect(result.errors).toBeUndefined();
  });
  it('should handle work order creation failure', async () => {
    // Mock failure case (random < 0.05)
    jest.spyOn(Math, 'random').mockReturnValue(0.01);
    const input = {
      workOrderId: 'test-work-order-123',
      workItems: (0, setup_1.createMockWorkOrderInput)().workItems,
    };
    const result = await (0, record_gen_activity_1.recordGenActivity)(input);
    expect(result.success).toBe(false);
    expect(result.recordsCreated).toBe(4); // 2 work items + 2 attempts (work order failed)
    expect(result.errors).toContain('Failed to create work order record: test-work-order-123');
  });
  it('should handle work item creation failures', async () => {
    // Mock failure for work items (random < 0.02)
    let callCount = 0;
    jest.spyOn(Math, 'random').mockImplementation(() => {
      callCount++;
      // First call (work order): success (0.1 > 0.05)
      // Second call (first work item): failure (0.01 < 0.02)
      // Third call (second work item): success (0.1 > 0.02)
      return callCount === 2 ? 0.01 : 0.1;
    });
    const input = {
      workOrderId: 'test-work-order-123',
      workItems: (0, setup_1.createMockWorkOrderInput)().workItems,
    };
    const result = await (0, record_gen_activity_1.recordGenActivity)(input);
    expect(result.success).toBe(false);
    expect(result.recordsCreated).toBe(4); // 1 work order + 1 work item + 2 attempts
    expect(result.errors).toContain('Failed to create work item record: test-item-1');
  });
  it('should handle empty work items list', async () => {
    const input = {
      workOrderId: 'test-work-order-123',
      workItems: [],
    };
    const result = await (0, record_gen_activity_1.recordGenActivity)(input);
    expect(result.success).toBe(true);
    expect(result.recordsCreated).toBe(1); // Only work order record
    expect(result.errors).toBeUndefined();
  });
  it('should handle unexpected errors gracefully', async () => {
    // Mock Context.current to throw an error
    activity_1.Context.current.mockImplementation(() => {
      throw new Error('Context error');
    });
    const input = {
      workOrderId: 'test-work-order-123',
      workItems: (0, setup_1.createMockWorkOrderInput)().workItems,
    };
    const result = await (0, record_gen_activity_1.recordGenActivity)(input);
    expect(result.success).toBe(false);
    expect(result.recordsCreated).toBe(0);
    expect(result.errors).toContain('Context error');
  });
  it('should call heartbeat for each work item', async () => {
    const mockHeartbeat = jest.fn();
    activity_1.Context.current.mockReturnValue({
      info: {
        activityId: 'test-activity-123',
        startTime: new Date(),
      },
      heartbeat: mockHeartbeat,
    });
    const input = {
      workOrderId: 'test-work-order-123',
      workItems: (0, setup_1.createMockWorkOrderInput)().workItems,
    };
    await (0, record_gen_activity_1.recordGenActivity)(input);
    expect(mockHeartbeat).toHaveBeenCalledTimes(2); // Once per work item
    expect(mockHeartbeat).toHaveBeenCalledWith({
      workItemId: 'test-item-1',
      recordsCreated: 2,
    });
    expect(mockHeartbeat).toHaveBeenCalledWith({
      workItemId: 'test-item-2',
      recordsCreated: 3,
    });
  });
});
//# sourceMappingURL=record-gen.activity.test.js.map
