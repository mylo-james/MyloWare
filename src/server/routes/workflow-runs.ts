import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { WorkflowRunRepository } from '../../db/operations/workflowRunRepository';
import { workflowStageEnum } from '../../db/operations/schema';
import { sendValidationError, sendError } from '../utils/errorResponses';

const workflowStageValues = new Set(workflowStageEnum.enumValues);

const createWorkflowRunSchema = z.object({
  projectId: z.string().trim().min(1, 'projectId is required'),
  sessionId: z.string().uuid('sessionId must be a UUID'),
  input: z.record(z.unknown()).optional(),
  workflowDefinitionChunkId: z.string().optional().nullable(),
});

const updateWorkflowRunSchema = z.object({
  status: z.enum(['running', 'waiting_for_hitl', 'completed', 'failed', 'needs_revision']).optional(),
  currentStage: z
    .string()
    .refine((value) => workflowStageValues.has(value as never), {
      message: `currentStage must be one of: ${Array.from(workflowStageValues).join(', ')}`,
    })
    .optional(),
  stages: z.record(z.unknown()).optional(),
  output: z.unknown().optional(),
  workflowDefinitionChunkId: z.string().optional().nullable(),
});

export async function registerWorkflowRunRoutes(
  app: FastifyInstance,
  dependencies: { workflowRunRepository?: WorkflowRunRepository } = {},
): Promise<void> {
  const workflowRunRepo = dependencies.workflowRunRepository ?? new WorkflowRunRepository();

  // GET /api/workflow-runs - List workflow runs
  app.get(
    '/api/workflow-runs',
    async (
      request: FastifyRequest<{ Querystring: { status?: string; projectId?: string; sessionId?: string } }>,
      reply: FastifyReply,
    ) => {
      const filters: {
        status?: string[];
        projectId?: string;
        sessionId?: string;
      } = {};

      if (request.query.status) {
        filters.status = Array.isArray(request.query.status)
          ? request.query.status
          : [request.query.status];
      }

      if (request.query.projectId) {
        filters.projectId = request.query.projectId;
      }

      if (request.query.sessionId) {
        filters.sessionId = request.query.sessionId;
      }

      const workflowRuns = await workflowRunRepo.listWorkflowRuns(filters as never);

      void reply.status(200).send({ workflowRuns });
    },
  );

  // POST /api/workflow-runs - Create workflow run
  app.post(
    '/api/workflow-runs',
    async (
      request: FastifyRequest<{ Body: unknown }>,
      reply: FastifyReply,
    ) => {
      const parsed = createWorkflowRunSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendValidationError(reply, parsed.error);
      }

      try {
        const workflowRun = await workflowRunRepo.createWorkflowRun({
          projectId: parsed.data.projectId,
          sessionId: parsed.data.sessionId,
          input: parsed.data.input,
          workflowDefinitionChunkId: parsed.data.workflowDefinitionChunkId ?? null,
        });

        void reply.status(201).send({ workflowRun });
      } catch (error) {
        app.log.error(error, 'Failed to create workflow run');
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create workflow run');
      }
    },
  );

  // GET /api/workflow-runs/:id - Get workflow run
  app.get(
    '/api/workflow-runs/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      const workflowRun = await workflowRunRepo.getWorkflowRunById(id);

      void reply.status(200).send({ workflowRun });
    },
  );

  // PATCH /api/workflow-runs/:id - Update workflow run
  app.patch(
    '/api/workflow-runs/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: unknown }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const parsed = updateWorkflowRunSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendValidationError(reply, parsed.error);
      }

      const workflowRun = await workflowRunRepo.updateWorkflowRun(id, {
        status: parsed.data.status,
        currentStage: parsed.data.currentStage as never,
        stages: parsed.data.stages as never,
        output: parsed.data.output,
        workflowDefinitionChunkId: parsed.data.workflowDefinitionChunkId ?? null,
      });

      void reply.status(200).send({ workflowRun });
    },
  );

  // GET /api/workflow-runs/:id/context - Get execution context
  app.get(
    '/api/workflow-runs/:id/context',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      try {
        const { WorkflowStateManager } = await import('../../workflow/WorkflowStateManager');
        const stateManager = new WorkflowStateManager();

        const context = await stateManager.getExecutionContext(id);

        if (!context) {
          return sendError(reply, 404, 'NOT_FOUND', `Workflow run with id ${id} not found`);
        }

        void reply.status(200).send({ context });
      } catch (error) {
        app.log.error(error, 'Failed to get execution context');
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to retrieve execution context');
      }
    },
  );

  // GET /api/workflow-runs/:id/stage/:stage/output - Get stage output
  app.get(
    '/api/workflow-runs/:id/stage/:stage/output',
    async (
      request: FastifyRequest<{ Params: { id: string; stage: string } }>,
      reply: FastifyReply,
    ) => {
      const { id, stage } = request.params;

      if (!workflowStageValues.has(stage as never)) {
        return sendError(
          reply,
          400,
          'VALIDATION_ERROR',
          `stage must be one of: ${Array.from(workflowStageValues).join(', ')}`,
        );
      }

      const workflowRun = await workflowRunRepo.getWorkflowRunById(id);

      const stages = workflowRun.stages as Record<
          string,
          { status: string; output?: unknown; error?: string }
        >;

        const stageData = stages[stage];

        if (!stageData) {
          return sendError(
            reply,
            404,
            'NOT_FOUND',
            `Stage ${stage} not found in workflow run ${id}`,
          );
        }

      void reply.status(200).send({ output: stageData.output ?? null });
    },
  );
}

