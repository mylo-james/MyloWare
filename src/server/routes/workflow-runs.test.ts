import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { registerWorkflowRunRoutes } from './workflow-runs';
import { WorkflowRunRepository } from '../../db/operations/workflowRunRepository';
import { NotFoundError } from '../../types/errors';
import type { WorkflowRun } from '../../db/operations/schema';
import { errorHandler } from '../errorHandler';

describe('Workflow Run Routes', () => {
  let app: FastifyInstance;
  let mockRepo: {
    createWorkflowRun: ReturnType<typeof vi.fn>;
    getWorkflowRunById: ReturnType<typeof vi.fn>;
    updateWorkflowRun: ReturnType<typeof vi.fn>;
    listWorkflowRuns: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    app = fastify();

    app.setErrorHandler(errorHandler);

    mockRepo = {
      createWorkflowRun: vi.fn(),
      getWorkflowRunById: vi.fn(),
      updateWorkflowRun: vi.fn(),
      listWorkflowRuns: vi.fn(),
    };

    const mockRepository = mockRepo as unknown as WorkflowRunRepository;

    await registerWorkflowRunRoutes(app, { workflowRunRepository: mockRepository });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('GET /api/workflow-runs', () => {
    it('should list workflow runs without filters', async () => {
      const mockRuns: WorkflowRun[] = [
        {
          id: 'run-1',
          projectId: 'aismr',
          sessionId: 'session-1',
          currentStage: 'idea_generation',
          status: 'running',
          stages: {},
          input: {},
          output: null,
          workflowDefinitionChunkId: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
      ];

      mockRepo.listWorkflowRuns.mockResolvedValue(mockRuns);

      const response = await app.inject({
        method: 'GET',
        url: '/api/workflow-runs',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.workflowRuns).toBeDefined();
      expect(mockRepo.listWorkflowRuns).toHaveBeenCalledWith({});
    });

    it('should list workflow runs with filters', async () => {
      mockRepo.listWorkflowRuns.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/workflow-runs?status=running&projectId=aismr',
      });

      expect(response.statusCode).toBe(200);
      expect(mockRepo.listWorkflowRuns).toHaveBeenCalled();
    });
  });

  describe('GET /api/workflow-runs/:id', () => {
    it('should return workflow run when found', async () => {
      const mockRun: WorkflowRun = {
        id: 'run-1',
        projectId: 'aismr',
        sessionId: 'session-1',
        currentStage: 'idea_generation',
        status: 'running',
        stages: {},
        input: {},
        output: null,
        workflowDefinitionChunkId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockRepo.getWorkflowRunById.mockResolvedValue(mockRun);

      const response = await app.inject({
        method: 'GET',
        url: '/api/workflow-runs/run-1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.workflowRun).toEqual(mockRun);
    });

    it('should return 404 when workflow run not found', async () => {
      mockRepo.getWorkflowRunById.mockRejectedValue(
        new NotFoundError('Workflow run with id non-existent-id not found'),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/workflow-runs/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('not found');
      expect(body.error.requestId).toBeDefined();
      expect(body.error.timestamp).toBeDefined();
    });
  });

  describe('PATCH /api/workflow-runs/:id', () => {
    it('should return 404 when workflow run not found', async () => {
      mockRepo.updateWorkflowRun.mockRejectedValue(
        new NotFoundError('Workflow run with id non-existent-id not found'),
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/workflow-runs/non-existent-id',
        payload: {
          status: 'completed',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.requestId).toBeDefined();
      expect(body.error.timestamp).toBeDefined();
    });

    it('should return 200 when workflow run updated successfully', async () => {
      const mockRun: WorkflowRun = {
        id: 'run-1',
        projectId: 'aismr',
        sessionId: 'session-1',
        currentStage: 'idea_generation',
        status: 'completed',
        stages: {},
        input: {},
        output: null,
        workflowDefinitionChunkId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockRepo.updateWorkflowRun.mockResolvedValue(mockRun);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/workflow-runs/run-1',
        payload: {
          status: 'completed',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.workflowRun.status).toBe('completed');
    });

    it('should return 500 on unexpected error', async () => {
      mockRepo.updateWorkflowRun.mockRejectedValue(new Error('Database connection failed'));

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/workflow-runs/run-1',
        payload: {
          status: 'completed',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.requestId).toBeDefined();
      expect(body.error.timestamp).toBeDefined();
    });

    it('should return 400 on validation error', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/workflow-runs/run-1',
        payload: {
          status: 'invalid-status',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/workflow-runs', () => {
    it('should create workflow run successfully', async () => {
      const mockRun: WorkflowRun = {
        id: 'run-1',
        projectId: 'aismr',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        currentStage: 'idea_generation',
        status: 'running',
        stages: {},
        input: { test: true },
        output: null,
        workflowDefinitionChunkId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockRepo.createWorkflowRun.mockResolvedValue(mockRun);

      const response = await app.inject({
        method: 'POST',
        url: '/api/workflow-runs',
        payload: {
          projectId: 'aismr',
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          input: { test: true },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.workflowRun).toEqual(mockRun);
    });

    it('should return 400 on validation error', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/workflow-runs',
        payload: {
          projectId: '',
          sessionId: 'not-a-uuid',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

