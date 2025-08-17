'use strict';
/**
 * Temporal Client Service Tests
 */
Object.defineProperty(exports, '__esModule', { value: true });
const client_1 = require('@temporalio/client');
const temporal_client_service_1 = require('../src/services/temporal-client.service');
const setup_1 = require('./setup');
describe('TemporalClientService', () => {
  let service;
  let mockClient;
  let mockConnection;
  beforeEach(() => {
    mockConnection = {
      close: jest.fn(),
    };
    mockClient = {
      workflow: {
        start: jest.fn(),
        getHandle: jest.fn(),
        list: jest.fn(),
      },
    };
    client_1.Connection.connect.mockResolvedValue(mockConnection);
    client_1.Client.mockReturnValue(mockClient);
    service = new temporal_client_service_1.TemporalClientService(
      'localhost',
      7233,
      'test-namespace'
    );
  });
  afterEach(() => {
    jest.clearAllMocks();
  });
  describe('initialize', () => {
    it('should initialize client and connection successfully', async () => {
      await service.initialize();
      expect(client_1.Connection.connect).toHaveBeenCalledWith({
        address: 'localhost:7233',
      });
      expect(client_1.Client).toHaveBeenCalledWith({
        connection: mockConnection,
        namespace: 'test-namespace',
      });
    });
    it('should handle connection failures', async () => {
      const connectionError = new Error('Connection failed');
      client_1.Connection.connect.mockRejectedValue(connectionError);
      await expect(service.initialize()).rejects.toThrow(
        'Temporal client initialization failed: Connection failed'
      );
    });
  });
  describe('startDocsExtractVerifyWorkflow', () => {
    beforeEach(async () => {
      await service.initialize();
    });
    it('should start workflow successfully', async () => {
      const mockHandle = {
        workflowId: 'test-workflow-123',
        firstExecutionRunId: 'test-run-123',
      };
      mockClient.workflow.start.mockResolvedValue(mockHandle);
      const workOrderInput = (0, setup_1.createMockWorkOrderInput)();
      const result = await service.startDocsExtractVerifyWorkflow(workOrderInput);
      expect(result).toBe(mockHandle);
      expect(mockClient.workflow.start).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          args: [workOrderInput],
          taskQueue: 'myloware-tasks',
          workflowId: `docs-extract-verify-${workOrderInput.workOrderId}`,
        })
      );
    });
    it('should use custom workflow ID when provided', async () => {
      const mockHandle = {
        workflowId: 'custom-workflow-id',
        firstExecutionRunId: 'test-run-123',
      };
      mockClient.workflow.start.mockResolvedValue(mockHandle);
      const workOrderInput = (0, setup_1.createMockWorkOrderInput)();
      await service.startDocsExtractVerifyWorkflow(workOrderInput, 'custom-workflow-id');
      expect(mockClient.workflow.start).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          workflowId: 'custom-workflow-id',
        })
      );
    });
    it('should handle workflow start failures', async () => {
      mockClient.workflow.start.mockRejectedValue(new Error('Start failed'));
      const workOrderInput = (0, setup_1.createMockWorkOrderInput)();
      await expect(service.startDocsExtractVerifyWorkflow(workOrderInput)).rejects.toThrow(
        'Workflow start failed: Start failed'
      );
    });
    it('should throw error if client not initialized', async () => {
      const uninitializedService = new temporal_client_service_1.TemporalClientService();
      const workOrderInput = (0, setup_1.createMockWorkOrderInput)();
      await expect(
        uninitializedService.startDocsExtractVerifyWorkflow(workOrderInput)
      ).rejects.toThrow('Temporal client not initialized');
    });
  });
  describe('getHealthStatus', () => {
    it('should return disconnected status before initialization', () => {
      const status = service.getHealthStatus();
      expect(status).toEqual({
        isConnected: false,
        namespace: 'test-namespace',
      });
    });
    it('should return connected status after initialization', async () => {
      await service.initialize();
      const status = service.getHealthStatus();
      expect(status).toEqual({
        isConnected: true,
        namespace: 'test-namespace',
      });
    });
  });
  describe('close', () => {
    it('should close connection and reset client', async () => {
      await service.initialize();
      await service.close();
      expect(mockConnection.close).toHaveBeenCalled();
      expect(service.getHealthStatus().isConnected).toBe(false);
    });
    it('should handle close errors gracefully', async () => {
      await service.initialize();
      mockConnection.close.mockImplementation(() => {
        throw new Error('Close failed');
      });
      await expect(service.close()).rejects.toThrow('Temporal client close failed: Close failed');
    });
  });
});
//# sourceMappingURL=temporal-client.service.test.js.map
