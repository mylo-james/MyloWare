import { timingSafeEqual } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../config';
import { PromptEmbeddingsRepository } from '../../db/repository';
import { OperationsRepository, RunStatus, runStatusEnum, VideoStatus, videoStatusEnum } from '../../db/operations';
import { EpisodicMemoryRepository } from '../../db/episodicRepository';
import { embedTexts } from '../../vector/embedTexts';
import { resolvePrompt } from '../tools/promptGetTool';
import { searchPrompts } from '../tools/promptSearchTool';
import { enhanceQuery as baseEnhanceQuery } from '../../vector/queryEnhancer';
import { sendValidationError, sendError } from '../utils/errorResponses';
import { normaliseSlug } from '../../utils/slug';
import {
  featureFlagDefinitions,
  featureFlagNames,
  getFeatureFlagsSnapshot,
  resetFeatureFlag,
  setFeatureFlag,
  type FeatureFlagName,
} from '../../config/featureFlags';

const videoStatusValues = new Set(videoStatusEnum.enumValues);
const runStatusValues = new Set(runStatusEnum.enumValues);

const tagQuerySchema = z.union([z.string().trim(), z.array(z.string().trim())]).optional();

const promptResolveQuerySchema = z
  .object({
    project: z.string().trim().optional(),
    persona: z.string().trim().optional(),
    tags: tagQuerySchema,
    tag: tagQuerySchema,
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

function normalizeQueryTags(tags?: string | string[], alias?: string | string[]): string[] {
  const inputs = [tags, alias].filter((value): value is string | string[] => value !== undefined);
  if (inputs.length === 0) {
    return [];
  }

  const collected: string[] = [];

  for (const entry of inputs) {
    const values = Array.isArray(entry) ? entry : entry.split(',');
    for (const raw of values) {
      const slug = normaliseSlug(raw);
      if (slug && !collected.includes(slug)) {
        collected.push(slug);
      }
    }
  }

  return collected;
}

const promptSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'q is required'),
  persona: z.string().trim().optional(),
  project: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
  minSimilarity: z.coerce.number().min(0).max(1).optional(),
});

const videoCreateSchema = z.object({
  runId: z.string().trim().min(1, 'runId is required'),
  projectId: z.string().trim().min(1, 'projectId is required'),
  idea: z.string().trim().min(1, 'idea is required'),
  userIdea: z.string().optional().nullable(),
  vibe: z.string().optional().nullable(),
  prompt: z.string().optional().nullable(),
  videoLink: z.string().optional().nullable(),
  status: z.string().trim().optional().superRefine(validateVideoStatus),
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
      .refine(
        (values) => values.every((value) => videoStatusValues.has(value.trim() as VideoStatus)),
        {
          message: `status must be one of: ${Array.from(videoStatusValues).join(', ')}`,
        },
      )
      .transform(
        (values) =>
          values.map((value) => value.trim()).filter((value) => value.length > 0) as VideoStatus[],
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

const conversationRoles = ['user', 'assistant', 'system', 'tool'] as const;

const conversationStoreSchema = z.object({
  sessionId: z.string().trim().uuid('sessionId must be a valid UUID'),
  role: z.enum(conversationRoles, {
    required_error: 'role is required',
    invalid_type_error: 'role must be one of user, assistant, system, or tool',
  }),
  content: z.string().trim().min(1, 'content is required'),
  userId: z.string().trim().optional().nullable(),
  summary: z.record(z.unknown()).optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
  embeddingText: z.string().trim().min(1, 'embeddingText must not be empty').optional(),
});

const optionalDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date')
  .transform((value) => new Date(value));

const conversationRecallQuerySchema = z.object({
  sessionId: z.string().trim().uuid('sessionId must be a valid UUID'),
  limit: z.coerce.number().int().positive().max(200).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  from: optionalDate.optional(),
  to: optionalDate.optional(),
});

const conversationTurnParamsSchema = z.object({
  id: z.string().trim().uuid('turnId must be a valid UUID'),
});

const runBaseSchema = z.object({
  personaId: z.string().trim().uuid('personaId must be a valid UUID').optional(),
  chatId: z.string().trim().optional(),
  status: z.string().trim().optional(),
  result: z.string().trim().optional().nullable(),
  input: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  startedAt: z.string().trim().optional().nullable(),
  completedAt: z.string().trim().optional().nullable(),
});

const validateRunStatus = (value: { status?: string | null }, ctx: z.RefinementCtx) => {
  if (value.status && !runStatusValues.has(value.status as RunStatus)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: `status must be one of: ${Array.from(runStatusValues).join(', ')}`,
    });
  }
};

const runCreateSchema = runBaseSchema
  .extend({
    projectId: z.string().trim().uuid('projectId must be a valid UUID'),
  })
  .superRefine(validateRunStatus);

const runUpdateSchema = runBaseSchema
  .partial()
  .extend({
    projectId: z.never().optional(),
  })
  .superRefine(validateRunStatus);

const runParamsSchema = z.object({
  id: z.string().trim().uuid('runId must be a valid UUID'),
});

const featureFlagNameEnum = z.enum(
  [...featureFlagNames] as [FeatureFlagName, ...FeatureFlagName[]],
);

const featureFlagUpdateSchema = z.object({
  updates: z
    .array(
      z
        .object({
          flag: featureFlagNameEnum,
          value: z.boolean().optional(),
          reset: z.boolean().optional(),
        })
        .superRefine((entry, ctx) => {
          const hasValue = entry.value !== undefined;
          const shouldReset = entry.reset === true;
          if (shouldReset && hasValue) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Provide either value or reset, but not both.',
            });
          }
          if (!shouldReset && !hasValue) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Provide a boolean value when reset is not specified.',
            });
          }
        }),
    )
    .min(1, 'Provide at least one feature flag update.'),
});

export interface ApiRouteDependencies {
  promptRepository?: PromptEmbeddingsRepository;
  operationsRepository?: OperationsRepository | null;
  embedTexts?: typeof embedTexts;
  enhanceQuery?: typeof baseEnhanceQuery;
  episodicRepository?: EpisodicMemoryRepository | null;
  hitlService?: import('../../services/hitl/HITLService').HITLService;
}

export async function registerApiRoutes(
  app: FastifyInstance,
  dependencies: ApiRouteDependencies = {},
): Promise<void> {
  // Register HITL routes
  const { registerHITLRoutes } = await import('./hitl.js');
  await registerHITLRoutes(app, { hitlService: dependencies.hitlService });

  // Register workflow-runs routes
  const { registerWorkflowRunRoutes } = await import('./workflow-runs.js');
  await registerWorkflowRunRoutes(app);
  const promptRepository = dependencies.promptRepository ?? new PromptEmbeddingsRepository();
  const embed = dependencies.embedTexts ?? embedTexts;
  const enhance = dependencies.enhanceQuery ?? baseEnhanceQuery;
  const operationsRepository =
    dependencies.operationsRepository !== undefined
      ? dependencies.operationsRepository
      : config.operationsDatabaseUrl
        ? new OperationsRepository()
        : null;
  const episodicRepository =
    dependencies.episodicRepository !== undefined
      ? dependencies.episodicRepository
      : new EpisodicMemoryRepository();

  app.get('/api/admin/features', async (request, reply) => {
    if (!ensureAdminAuthorized(request, reply)) {
      return;
    }

    return reply.status(200).send({
      data: {
        flags: getFeatureFlagsSnapshot(),
        definitions: featureFlagDefinitions,
      },
    });
  });

  app.patch('/api/admin/features', async (request, reply) => {
    if (!ensureAdminAuthorized(request, reply)) {
      return;
    }

    const parsed = featureFlagUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    for (const update of parsed.data.updates) {
      if (update.reset) {
        resetFeatureFlag(update.flag);
      } else {
        setFeatureFlag(update.flag, update.value!);
      }
    }

    return reply.status(200).send({
      data: {
        flags: getFeatureFlagsSnapshot(),
      },
    });
  });

  app.post('/api/conversation/store', async (request, reply) => {
    if (!ensureEpisodicAvailable(reply, episodicRepository)) {
      return;
    }

    const parsed = conversationStoreSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const result = await episodicRepository.storeConversationTurn({
        sessionId: parsed.data.sessionId,
        role: parsed.data.role,
        content: parsed.data.content,
        userId: parsed.data.userId ?? undefined,
        summary: parsed.data.summary === null ? null : (parsed.data.summary ?? undefined),
        metadata: parsed.data.metadata ?? {},
        embeddingText: parsed.data.embeddingText,
      });

      return reply.status(201).send({
        data: {
          turn: result.turn,
          chunkId: result.chunkId,
          promptKey: result.promptKey,
          isNewSession: result.isNewSession,
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'conversation store failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error storing conversation turn.';
      return sendError(reply, 500, 'CONVERSATION_STORE_ERROR', message);
    }
  });

  app.get('/api/conversation/recall', async (request, reply) => {
    if (!ensureEpisodicAvailable(reply, episodicRepository)) {
      return;
    }

    const parsed = conversationRecallQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const turns = await episodicRepository.getSessionHistory(parsed.data.sessionId, {
        limit: parsed.data.limit,
        order: parsed.data.order ?? 'desc',
        from: parsed.data.from,
        to: parsed.data.to,
      });

      return reply.status(200).send({
        data: {
          turns,
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'conversation recall failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error recalling conversation.';
      return sendError(reply, 500, 'CONVERSATION_RECALL_ERROR', message);
    }
  });

  app.get('/api/conversation/turns/:id', async (request, reply) => {
    if (!ensureEpisodicAvailable(reply, episodicRepository)) {
      return;
    }

    const parsed = conversationTurnParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const turn = await episodicRepository!.getTurnById(parsed.data.id);
      if (!turn) {
        return sendError(reply, 404, 'TURN_NOT_FOUND', `No conversation turn found with id "${parsed.data.id}".`);
      }

      return reply.status(200).send({
        data: {
          turn,
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'conversation turn fetch failed');
      const message = error instanceof Error ? error.message : 'Unexpected error fetching conversation turn.';
      return sendError(reply, 500, 'CONVERSATION_TURN_ERROR', message);
    }
  });

  app.get('/api/prompts/resolve', async (request, reply) => {
    const parsed = promptResolveQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const tags = normalizeQueryTags(parsed.data.tags, parsed.data.tag);
      const result = await resolvePrompt(promptRepository, {
        project_name: parsed.data.project ?? undefined,
        persona_name: parsed.data.persona ?? undefined,
        ...(tags.length > 0 ? { tags } : {}),
      });

      if (!result.prompt) {
        const isAmbiguous = result.message.toLowerCase().includes('multiple prompts');
        const status = isAmbiguous ? 409 : 404;
        return sendError(
          reply,
          status,
          isAmbiguous ? 'PROMPT_AMBIGUOUS' : 'PROMPT_NOT_FOUND',
          result.message,
          {
            resolution: result.resolution,
            candidates: result.candidates,
          },
        );
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
      const message = error instanceof Error ? error.message : 'Unexpected error resolving prompt.';
      return sendError(reply, 500, 'PROMPT_RESOLUTION_ERROR', message);
    }
  });

  app.get('/api/prompts/search', async (request, reply) => {
    const parsed = promptSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    try {
      const result = await searchPrompts(
        promptRepository,
        embed,
        {
          query: parsed.data.q,
          searchMode: 'hybrid',
          autoFilter: true,
          persona: parsed.data.persona,
          project: parsed.data.project,
          limit: parsed.data.limit,
          minSimilarity: parsed.data.minSimilarity,
        },
        enhance,
      );

      return reply.status(200).send({ data: result });
    } catch (error) {
      request.log.error({ err: error }, 'prompt search failed');
      const message =
        error instanceof Error ? error.message : 'Unexpected error performing prompt search.';
      return sendError(reply, 500, 'PROMPT_SEARCH_ERROR', message);
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
      const message = error instanceof Error ? error.message : 'Unexpected error fetching video.';
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
      const message = error instanceof Error ? error.message : 'Unexpected error listing videos.';
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
      const message = error instanceof Error ? error.message : 'Unexpected error creating video.';
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
      const message = error instanceof Error ? error.message : 'Unexpected error updating video.';
      return sendError(reply, 500, 'VIDEO_UPDATE_ERROR', message);
    }
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

function ensureEpisodicAvailable(
  reply: FastifyReply,
  repository: EpisodicMemoryRepository | null,
): repository is EpisodicMemoryRepository {
  if (repository) {
    return true;
  }

  void reply.status(503).send({
    error: {
      code: 'EPISODIC_MEMORY_UNAVAILABLE',
      message: 'Episodic memory repository is not configured.',
    },
  });

  return false;
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

function ensureAdminAuthorized(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = config.mcpApiKey;
  if (!expected) {
    return true;
  }

  const header = request.headers['x-api-key'];
  const provided =
    typeof header === 'string'
      ? header.trim()
      : Array.isArray(header)
        ? header[0]?.trim()
        : null;

  if (!provided) {
    void sendError(reply, 401, 'UNAUTHORIZED', 'Missing x-api-key header.');
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    void sendError(reply, 403, 'FORBIDDEN', 'Invalid API key provided.');
    return false;
  }

  return true;
}
