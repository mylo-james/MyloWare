import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../config';
import { HITLService } from '../../services/hitl/HITLService';
import { workflowStageEnum } from '../../db/operations/schema';
import { sendValidationError, sendError } from '../utils/errorResponses';

const workflowStageValues = new Set(workflowStageEnum.enumValues);

const approveRequestSchema = z.object({
  reviewedBy: z.string().trim().min(1, 'reviewedBy is required'),
  selectedItem: z.unknown().optional(),
  feedback: z.string().trim().optional(),
});

const rejectRequestSchema = z.object({
  reviewedBy: z.string().trim().min(1, 'reviewedBy is required'),
  reason: z.string().trim().min(1, 'reason is required'),
});

const requestApprovalSchema = z.object({
  workflowRunId: z.string().uuid('workflowRunId must be a UUID'),
  stage: z
    .string()
    .refine((value) => workflowStageValues.has(value as never), {
      message: `stage must be one of: ${Array.from(workflowStageValues).join(', ')}`,
    }),
  content: z.unknown(),
  notifyChannels: z.array(z.string()).optional(),
});

const pendingApprovalsQuerySchema = z.object({
  stage: z
    .string()
    .refine((value) => workflowStageValues.has(value as never), {
      message: `stage must be one of: ${Array.from(workflowStageValues).join(', ')}`,
    })
    .optional(),
  project: z.string().trim().optional(),
});

export async function registerHITLRoutes(
  app: FastifyInstance,
  dependencies: { hitlService?: HITLService | null } = {},
): Promise<void> {
  const hitlService =
    dependencies.hitlService !== undefined
      ? dependencies.hitlService
      : config.operationsDatabaseUrl
        ? new HITLService()
        : null;

  // GET /api/hitl/pending - List pending approvals
  app.get('/api/hitl/pending', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!ensureHitlAvailable(reply, hitlService)) {
      return;
    }

    const parsed = pendingApprovalsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const approvals = await hitlService.getPendingApprovals({
        stage: parsed.data.stage as never,
        projectId: parsed.data.project,
      });

      void reply.status(200).send({ approvals });
    } catch (error) {
      app.log.error(error, 'Failed to get pending approvals');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to retrieve pending approvals');
    }
  });

  // GET /api/hitl/approval/:id - Get specific approval
  app.get(
    '/api/hitl/approval/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!ensureHitlAvailable(reply, hitlService)) {
        return;
      }

      const { id } = request.params;

      try {
        const approval = await hitlService.getApproval(id);

        if (!approval) {
          return sendError(reply, 404, 'NOT_FOUND', `HITL approval with id ${id} not found`);
        }

        void reply.status(200).send({ approval });
      } catch (error) {
        app.log.error(error, 'Failed to get approval');
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to retrieve approval');
      }
    },
  );

  // POST /api/hitl/approve/:id - Approve an item
  app.post(
    '/api/hitl/approve/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: unknown }>,
      reply: FastifyReply,
    ) => {
      if (!ensureHitlAvailable(reply, hitlService)) {
        return;
      }

      const { id } = request.params;
      const parsed = approveRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendValidationError(reply, parsed.error);
      }

      try {
        await hitlService.approve(id, {
          reviewedBy: parsed.data.reviewedBy,
          selectedItem: parsed.data.selectedItem,
          feedback: parsed.data.feedback,
        });

        void reply.status(200).send({ success: true });
      } catch (error) {
        app.log.error(error, 'Failed to approve');
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to approve item');
      }
    },
  );

  // POST /api/hitl/reject/:id - Reject an item
  app.post(
    '/api/hitl/reject/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: unknown }>,
      reply: FastifyReply,
    ) => {
      if (!ensureHitlAvailable(reply, hitlService)) {
        return;
      }

      const { id } = request.params;
      const parsed = rejectRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendValidationError(reply, parsed.error);
      }

      try {
        await hitlService.reject(id, {
          reviewedBy: parsed.data.reviewedBy,
          reason: parsed.data.reason,
        });

        void reply.status(200).send({ success: true });
      } catch (error) {
        app.log.error(error, 'Failed to reject');
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to reject item');
      }
    },
  );

  // POST /api/hitl/request-approval - Internal endpoint for workflows
  app.post(
    '/api/hitl/request-approval',
    async (
      request: FastifyRequest<{ Body: unknown }>,
      reply: FastifyReply,
    ) => {
      if (!ensureHitlAvailable(reply, hitlService)) {
        return;
      }

      const parsed = requestApprovalSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendValidationError(reply, parsed.error);
      }

      try {
        const approval = await hitlService.requestApproval({
          workflowRunId: parsed.data.workflowRunId,
          stage: parsed.data.stage as never,
          content: parsed.data.content,
          notifyChannels: parsed.data.notifyChannels,
        });

        void reply.status(201).send({ approval });
      } catch (error) {
        app.log.error(error, 'Failed to request approval');
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to request approval');
      }
    },
  );
}

function ensureHitlAvailable(
  reply: FastifyReply,
  service: HITLService | null,
): service is HITLService {
  if (service) {
    return true;
  }

  void reply.status(503).send({
    error: {
      code: 'HITL_SERVICE_UNAVAILABLE',
      message: 'HITL service is not configured.',
    },
  });

  return false;
}
