import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../../config';
import { PromptEmbeddingsRepository } from '../../db/repository';
import {
  OperationsRepository,
  RunStatus,
  VideoStatus,
  runStatusEnum,
  videoStatusEnum,
} from '../../db/operations';
import { embedTexts } from '../../vector/embedTexts';
import { resolvePrompt } from '../tools/promptGetTool';
import { searchPrompts } from '../tools/promptSearchTool';

const runStatusValues = new Set(runStatusEnum.enumValues);
const videoStatusValues = new Set(videoStatusEnum.enumValues);

const promptResolveQuerySchema = z
  .object({
    project: z.string().trim().optional(),
    persona: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.project && !value.persona) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least project or persona.',
        fatal: true,
      });
    }
  });

const promptSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'q is required'),
  persona: z.string().trim().optional(),
  project: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
  minSimilarity: z.coerce.number().min(0).max(1).optional(),
});

const runCreateSchema = z.object({
  projectId: z.string().trim().min(1, 'projectId is required'),
  personaId: z.string().trim().optional().nullable(),
  chatId: z.string().trim().optional().nullable(),
  status: z
    .string()
    .trim()
    .optional()
    .superRefine(validateRunStatus),
  result: z.string().optional().nullable(),
  input: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  startedAt: z.string().trim().optional().nullable(),
  completedAt: z.string().trim().optional().nullable(),
});

const runUpdateSchema = runCreateSchema.partial().extend({
  projectId: z.never().optional(),
});

const videoCreateSchema = z.object({
  runId: z.string().trim().min(1, 'runId is required'),
  projectId: z.string().trim().min(1, 'projectId is required'),
  idea: z.string().trim().min(1, 'idea is required'),
  userIdea: z.string().optional().nullable(),
  vibe: z.string().optional().nullable(),
  prompt: z.string().optional().nullable(),
  videoLink: z.string().optional().nullable(),
  status: z
    .string()
    .trim()
    .optional()
    .superRefine(validateVideoStatus),
  errorMessage: z.string().optional().nullable(),
  startedAt: z.string().trim().optional().nullable(),
  completedAt: z.string().trim().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

const videoUpdateSchema = videoCreateSchema.partial().extend({
  runId: z.never().optional(),
  projectId: z.string().trim().optional(),
  idea: z.string().trim().optional(),
});

const videoListQuerySchema = z
  .object({
    project: z.string().trim().min(1, 'project query parameter is required').optional(),
    run: z.string().trim().min(1, 'run query parameter is required').optional(),
    status: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) => {
        if (!value) {
          return [] as string[];
        }

        return Array.isArray(value) ? value : value.split(',');
      })
      .refine((values) => values.every((value) => videoStatusValues.has(value.trim() as VideoStatus)), {
        message: `status must be one of: ${Array.from(videoStatusValues).join(', ')}`,
      })
      .transform((values) =>
        values
          .map((value) => value.trim())
          .filter((value) => value.length > 0) as VideoStatus[],
      ),
    limit: z.coerce.number().int().positive().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.project && !value.run) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide project or run query parameter.',
        fatal: true,
      });
    }

    if (value.project && value.run) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Specify only one of project or run.',
        fatal: true,
      });
    }
  });

export interface ApiRouteDependencies {
  promptRepository?: PromptEmbeddingsRepository;
  operationsRepository?: OperationsRepository | null;
  embedTexts?: typeof embedTexts;
}

export async function registerApiRoutes(
  app: FastifyInstance,
  dependencies: ApiRouteDependencies = {},
): Promise<void> {
  const promptRepository =
    dependencies.promptRepository ?? new PromptEmbeddingsRepository();
  const embed = dependencies.embedTexts ?? embedTexts;
  const operationsRepository =
    dependencies.operationsRepository !== undefined
      ? dependencies.operationsRepository
      : config.operationsDatabaseUrl
        ? new OperationsRepository()
        : null;

  app.get('/api/prompts/resolve', async (request, reply) => {
    const parsed = promptResolveQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const result = await resolvePrompt(promptRepository, {
        project_name: parsed.data.project ?? undefined,
        persona_name: parsed.data.persona ?? undefined,
      });

      if (!result.prompt) {
        const isAmbiguous = result.message.toLowerCase().includes('multiple prompts');
        const status = isAmbiguous ? 409 : 404;
        return sendError(reply, status, isAmbiguous ? 'PROMPT_AMBIGUOUS' : 'PROMPT_NOT_FOUND', result.message, {
          resolution: result.resolution,
          candidates: result.candidates,
        });
      }

      return reply.status(200).send({
        data: {
          prompt: result.prompt,
          resolution: result.resolution,
          candidates: result.candidates,
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'prompt resolve failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error resolving prompt.';
      return sendError(reply, 500, 'PROMPT_RESOLUTION_ERROR', message);
    }
  });

  app.get('/api/prompts/search', async (request, reply) => {
    const parsed = promptSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const result = await searchPrompts(promptRepository, embed, {
        query: parsed.data.q,
        persona: parsed.data.persona,
        project: parsed.data.project,
        limit: parsed.data.limit,
        minSimilarity: parsed.data.minSimilarity,
      });

      return reply.status(200).send({ data: result });
    } catch (error) {
      request.log.error({ err: error }, 'prompt search failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error performing prompt search.';
      return sendError(reply, 500, 'PROMPT_SEARCH_ERROR', message);
    }
  });

  app.get('/api/runs/:id', async (request, reply) => {
    if (!ensureOperationsAvailable(reply, operationsRepository)) {
      return;
    }

    const runId = String((request.params as Record<string, unknown>).id ?? '');

    if (!runId) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Run id is required.');
    }

    try {
      const run = await operationsRepository!.getRunById(runId);
      if (!run) {
        return sendError(reply, 404, 'RUN_NOT_FOUND', `No run found with id "${runId}".`);
      }

      return reply.status(200).send({ data: { run } });
    } catch (error) {
      request.log.error({ err: error }, 'get run failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error fetching run.';
      return sendError(reply, 500, 'RUN_FETCH_ERROR', message);
    }
  });

  app.post('/api/runs', async (request, reply) => {
    if (!ensureOperationsAvailable(reply, operationsRepository)) {
      return;
    }

    const parsed = runCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const run = await operationsRepository!.createRun({
        ...parsed.data,
        status: parsed.data.status as RunStatus | undefined,
        input: (parsed.data.input ?? {}) as Record<string, unknown>,
        metadata: (parsed.data.metadata ?? {}) as Record<string, unknown>,
      });
      return reply.status(201).send({ data: { run } });
    } catch (error) {
      request.log.error({ err: error }, 'create run failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error creating run.';
      return sendError(reply, 500, 'RUN_CREATE_ERROR', message);
    }
  });

  app.put('/api/runs/:id', async (request, reply) => {
    if (!ensureOperationsAvailable(reply, operationsRepository)) {
      return;
    }

    const runId = String((request.params as Record<string, unknown>).id ?? '');
    if (!runId) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Run id is required.');
    }

    const parsed = runUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const run = await operationsRepository!.updateRun(runId, {
        ...parsed.data,
        status: parsed.data.status as RunStatus | undefined,
        input: parsed.data.input as Record<string, unknown> | undefined,
        metadata: parsed.data.metadata as Record<string, unknown> | undefined,
      });
      if (!run) {
        return sendError(reply, 404, 'RUN_NOT_FOUND', `No run found with id "${runId}".`);
      }

      return reply.status(200).send({ data: { run } });
    } catch (error) {
      request.log.error({ err: error }, 'update run failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error updating run.';
      return sendError(reply, 500, 'RUN_UPDATE_ERROR', message);
    }
  });

  app.get('/api/videos/:id', async (request, reply) => {
    if (!ensureOperationsAvailable(reply, operationsRepository)) {
      return;
    }

    const videoId = String((request.params as Record<string, unknown>).id ?? '');
    if (!videoId) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Video id is required.');
    }

    try {
      const video = await operationsRepository!.getVideoById(videoId);
      if (!video) {
        return sendError(reply, 404, 'VIDEO_NOT_FOUND', `No video found with id "${videoId}".`);
      }

      return reply.status(200).send({ data: { video } });
    } catch (error) {
      request.log.error({ err: error }, 'get video failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error fetching video.';
      return sendError(reply, 500, 'VIDEO_FETCH_ERROR', message);
    }
  });

  app.get('/api/videos', async (request, reply) => {
    if (!ensureOperationsAvailable(reply, operationsRepository)) {
      return;
    }

    const parsed = videoListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const statusFilter =
        parsed.data.status.length > 0 ? (parsed.data.status as VideoStatus[]) : undefined;

      const videos = parsed.data.run
        ? await operationsRepository!.listVideosByRun(parsed.data.run, {
            status: statusFilter,
            limit: parsed.data.limit,
          })
        : await operationsRepository!.listVideosByProject(parsed.data.project!, {
            status: statusFilter,
            limit: parsed.data.limit,
          });

      return reply.status(200).send({ data: { videos } });
    } catch (error) {
      request.log.error({ err: error }, 'list videos failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error listing videos.';
      return sendError(reply, 500, 'VIDEO_LIST_ERROR', message);
    }
  });

  app.post('/api/videos', async (request, reply) => {
    if (!ensureOperationsAvailable(reply, operationsRepository)) {
      return;
    }

    const parsed = videoCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const video = await operationsRepository!.createVideo({
        ...parsed.data,
        status: parsed.data.status as VideoStatus | undefined,
        metadata: (parsed.data.metadata ?? {}) as Record<string, unknown>,
      });
      return reply.status(201).send({ data: { video } });
    } catch (error) {
      request.log.error({ err: error }, 'create video failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error creating video.';
      return sendError(reply, 500, 'VIDEO_CREATE_ERROR', message);
    }
  });

  app.put('/api/videos/:id', async (request, reply) => {
    if (!ensureOperationsAvailable(reply, operationsRepository)) {
      return;
    }

    const videoId = String((request.params as Record<string, unknown>).id ?? '');
    if (!videoId) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Video id is required.');
    }

    const parsed = videoUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const video = await operationsRepository!.updateVideo(videoId, {
        ...parsed.data,
        status: parsed.data.status as VideoStatus | undefined,
        metadata: parsed.data.metadata as Record<string, unknown> | undefined,
      });
      if (!video) {
        return sendError(reply, 404, 'VIDEO_NOT_FOUND', `No video found with id "${videoId}".`);
      }

      return reply.status(200).send({ data: { video } });
    } catch (error) {
      request.log.error({ err: error }, 'update video failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error updating video.';
      return sendError(reply, 500, 'VIDEO_UPDATE_ERROR', message);
    }
  });
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      details: error.flatten(),
    },
  });
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return reply.status(statusCode).send({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

function ensureOperationsAvailable(
  reply: FastifyReply,
  repository: OperationsRepository | null,
): repository is OperationsRepository {
  if (repository) {
    return true;
  }

  void reply.status(503).send({
    error: {
      code: 'OPERATIONS_DB_UNAVAILABLE',
      message: 'Operations database is not configured.',
    },
  });

  return false;
}

function validateRunStatus(status: unknown, ctx: z.RefinementCtx) {
  if (status === undefined) {
    return;
  }

  if (typeof status !== 'string' || !runStatusValues.has(status as RunStatus)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `status must be one of: ${Array.from(runStatusValues).join(', ')}`,
    });
  }
}

function validateVideoStatus(status: unknown, ctx: z.RefinementCtx) {
  if (status === undefined) {
    return;
  }

  if (typeof status !== 'string' || !videoStatusValues.has(status as VideoStatus)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `status must be one of: ${Array.from(videoStatusValues).join(', ')}`,
    });
  }
}
