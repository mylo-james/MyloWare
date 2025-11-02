import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { registerHITLRoutes } from './hitl';
import { HITLService } from '../../services/hitl/HITLService';
import type { HITLApproval } from '../../db/operations/schema';

describe('HITL Routes', () => {
  let app: FastifyInstance;
  let mockHITLService: vi.Mocked<HITLService>;

  beforeEach(async () => {
    app = fastify();
    mockHITLService = {
      getPendingApprovals: vi.fn(),
      getApproval: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      requestApproval: vi.fn(),
    } as never;

    await registerHITLRoutes(app, { hitlService: mockHITLService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/hitl/pending', () => {
    it('returns filtered pending approvals', async () => {
      const approvals: HITLApproval[] = [
        {
          id: 'approval-1',
          workflowRunId: 'run-1',
          stage: 'idea_generation',
          content: { ideas: [] },
          status: 'pending',
          reviewedBy: null,
          reviewedAt: null,
          feedback: null,
          createdAt: '2025-01-01T00:00:00Z',
        },
      ];

      mockHITLService.getPendingApprovals.mockResolvedValue(approvals);

      const response = await app.inject({
        method: 'GET',
        url: '/api/hitl/pending?stage=idea_generation&project=aismr',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ approvals });
      expect(mockHITLService.getPendingApprovals).toHaveBeenCalledWith({
        stage: 'idea_generation',
        projectId: 'aismr',
      });
    });

    it('validates query parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/hitl/pending?stage=invalid_stage',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/hitl/approval/:id', () => {
    it('returns approval details', async () => {
      const approval: HITLApproval = {
        id: 'approval-1',
        workflowRunId: 'run-1',
        stage: 'idea_generation',
        content: { ideas: [] },
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        feedback: null,
        createdAt: '2025-01-01T00:00:00Z',
      };

      mockHITLService.getApproval.mockResolvedValue(approval);

      const response = await app.inject({
        method: 'GET',
        url: '/api/hitl/approval/approval-1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ approval });
    });

    it('returns 404 if approval not found', async () => {
      mockHITLService.getApproval.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/hitl/approval/non-existent',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/hitl/approve/:id', () => {
    it('approves an item', async () => {
      mockHITLService.approve.mockResolvedValue();

      const response = await app.inject({
        method: 'POST',
        url: '/api/hitl/approve/approval-1',
        payload: {
          reviewedBy: 'reviewer@example.com',
          selectedItem: { idea: 'lava apple' },
          feedback: 'Great idea!',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ success: true });
      expect(mockHITLService.approve).toHaveBeenCalledWith('approval-1', {
        reviewedBy: 'reviewer@example.com',
        selectedItem: { idea: 'lava apple' },
        feedback: 'Great idea!',
      });
    });

    it('validates request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/hitl/approve/approval-1',
        payload: {
          // missing reviewedBy
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/hitl/reject/:id', () => {
    it('rejects an item', async () => {
      mockHITLService.reject.mockResolvedValue();

      const response = await app.inject({
        method: 'POST',
        url: '/api/hitl/reject/approval-1',
        payload: {
          reviewedBy: 'reviewer@example.com',
          reason: 'Not unique enough',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ success: true });
      expect(mockHITLService.reject).toHaveBeenCalledWith('approval-1', {
        reviewedBy: 'reviewer@example.com',
        reason: 'Not unique enough',
      });
    });

    it('validates request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/hitl/reject/approval-1',
        payload: {
          reviewedBy: 'reviewer@example.com',
          // missing reason
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/hitl/request-approval', () => {
    it('creates approval request', async () => {
      const approval: HITLApproval = {
        id: 'approval-1',
        workflowRunId: '123e4567-e89b-12d3-a456-426614174000',
        stage: 'idea_generation',
        content: { ideas: [] },
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        feedback: null,
        createdAt: '2025-01-01T00:00:00Z',
      };

      mockHITLService.requestApproval.mockResolvedValue(approval);

      const response = await app.inject({
        method: 'POST',
        url: '/api/hitl/request-approval',
        payload: {
          workflowRunId: '123e4567-e89b-12d3-a456-426614174000',
          stage: 'idea_generation',
          content: { ideas: [] },
          notifyChannels: ['slack'],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ approval });
      expect(mockHITLService.requestApproval).toHaveBeenCalledWith({
        workflowRunId: '123e4567-e89b-12d3-a456-426614174000',
        stage: 'idea_generation',
        content: { ideas: [] },
        notifyChannels: ['slack'],
      });
    });

    it('validates request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/hitl/request-approval',
        payload: {
          workflowRunId: 'invalid-uuid',
          stage: 'idea_generation',
          content: {},
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('when HITL service unavailable', () => {
    let unavailableApp: FastifyInstance;

    beforeEach(async () => {
      unavailableApp = fastify();
      await registerHITLRoutes(unavailableApp);
      await unavailableApp.ready();
    });

    afterEach(async () => {
      await unavailableApp.close();
    });

    it('returns 503 for pending approvals', async () => {
      const response = await unavailableApp.inject({
        method: 'GET',
        url: '/api/hitl/pending',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('HITL_SERVICE_UNAVAILABLE');
      expect(body.error.message).toBe('HITL service is not configured.');
    });
  });
});
