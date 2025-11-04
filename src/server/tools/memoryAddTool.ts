import { createHash, randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js' with { 'resolution-mode': 'import' };
import { config } from '../../config';
import {
  PromptEmbeddingsRepository,
  type EmbeddingRecord,
  type PromptChunk,
} from '../../db/repository';
import { MemoryLinkRepository, type MemoryLinkType } from '../../db/linkRepository';
import type { MemoryType } from '../../db/schema';
import { embedTexts } from '../../vector/embedTexts';
import { normaliseSlug, normaliseSlugOptional } from '../../utils/slug';
import { extractToolArgs } from './argUtils';

const MEMORY_TYPES = ['persona', 'project', 'semantic', 'procedural', 'episodic'] as const;
const ACTOR_TYPES = ['system', 'agent', 'user', 'integration', 'operator'] as const;
const SOURCE_VALUES = ['agent', 'user', 'workflow', 'system'] as const;
const VISIBILITY_VALUES = ['public', 'team', 'private'] as const;
const LINK_TYPE_DEFAULT: MemoryLinkType = 'related';
const MODERATION_MODEL = 'omni-moderation-latest';

type MemoryRepositoryAdapter = Pick<
  PromptEmbeddingsRepository,
  'upsertEmbeddings' | 'getChunksByIds' | 'getChunkEmbedding'
>;

type MemoryLinkRepositoryAdapter = Pick<
  MemoryLinkRepository,
  'upsertLinks' | 'deleteLinksForSource' | 'deleteLinksForChunk'
>;

type MemoryModerationStatus = 'accepted' | 'pending_review' | 'rejected';

interface MemoryModeration {
  status: MemoryModerationStatus;
  categories: string[];
}

interface MemoryHistoryEntry {
  action: 'updated' | 'deleted';
  timestamp: string;
  actorId: string;
  changes?: string[];
  reason?: string | null;
}

type MemoryMetadata = Record<string, unknown> & {
  title: string | null;
  summary: string | null;
  tags?: string[];
  source: (typeof SOURCE_VALUES)[number];
  visibility: (typeof VISIBILITY_VALUES)[number];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  status: 'active' | 'inactive';
  confidence: number;
  actorType: (typeof ACTOR_TYPES)[number];
  sensitivity: 'low' | 'medium' | 'high';
  history: MemoryHistoryEntry[];
  moderation: MemoryModeration;
  relatedChunkIds?: string[];
  sessionId?: string;
  custom?: Record<string, unknown>;
};

const tagSchema = z
  .string()
  .trim()
  .min(1, 'tags must not contain empty strings')
  .max(40, 'tags must not exceed 40 characters each');

const metadataSchema = z.record(z.string(), z.unknown());

const actorSchema = z
  .object({
    type: z.enum(ACTOR_TYPES),
    id: z.string().trim().min(1, 'actor.id must not be empty'),
    scopes: z.array(z.string().trim().min(1)).max(20).optional(),
  })
  .strict();

const baseContentSchema = z
  .string()
  .trim()
  .min(1, 'content must not be empty')
  .max(2048, 'content must not exceed 2048 characters');

const MEMORY_ADD_ARG_KEYS = [
  'content',
  'memoryType',
  'title',
  'summary',
  'tags',
  'source',
  'visibility',
  'metadata',
  'relatedChunkIds',
  'confidence',
  'sessionId',
  'actor',
  'force',
] as const;

const memoryAddArgsBaseSchema = z
  .object({
    content: baseContentSchema,
    memoryType: z.enum(MEMORY_TYPES),
    title: z.string().trim().max(120).optional(),
    summary: z.string().trim().max(280).optional(),
    tags: z.array(tagSchema).max(10, 'tags must not exceed 10 entries').optional(),
    source: z.enum(SOURCE_VALUES).optional(),
    visibility: z.enum(VISIBILITY_VALUES).optional(),
    metadata: metadataSchema.optional(),
    relatedChunkIds: z.array(z.string().trim().min(1)).max(20).optional(),
    confidence: z.number().min(0).max(1).optional(),
    sessionId: z.string().uuid().optional(),
    actor: actorSchema,
    force: z.boolean().optional(),
  })
  .strict();

const memoryAddArgsSchema = memoryAddArgsBaseSchema
  .superRefine((input, ctx) => {
    if (input.memoryType !== 'episodic' && !input.title) {
      ctx.addIssue({
        path: ['title'],
        code: z.ZodIssueCode.custom,
        message: 'title is required for non-episodic memories',
      });
    }
    if (input.memoryType === 'episodic' && !input.sessionId) {
      ctx.addIssue({
        path: ['sessionId'],
        code: z.ZodIssueCode.custom,
        message: 'sessionId is required when memoryType is episodic',
      });
    }
  });

const MEMORY_UPDATE_ARG_KEYS = [
  'memoryId',
  'content',
  'title',
  'summary',
  'tags',
  'visibility',
  'metadata',
  'relatedChunkIds',
  'confidence',
  'actor',
  'force',
] as const;

const memoryUpdateArgsBaseSchema = z
  .object({
    memoryId: z.string().trim().min(1, 'memoryId must not be empty'),
    content: baseContentSchema.optional(),
    title: z.string().trim().max(120).optional(),
    summary: z.string().trim().max(280).optional(),
    tags: z.array(tagSchema).max(10).optional(),
    visibility: z.enum(VISIBILITY_VALUES).optional(),
    metadata: metadataSchema.optional(),
    relatedChunkIds: z.array(z.string().trim().min(1)).max(20).optional(),
    confidence: z.number().min(0).max(1).optional(),
    actor: actorSchema,
    force: z.boolean().optional(),
  })
  .strict();

const memoryUpdateArgsSchema = memoryUpdateArgsBaseSchema
  .superRefine((input, ctx) => {
    const keys = ['content', 'title', 'summary', 'tags', 'visibility', 'metadata', 'relatedChunkIds', 'confidence'] as const;
    const hasUpdate = keys.some((key) => input[key] !== undefined);
    if (!hasUpdate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field (content, title, summary, tags, visibility, metadata, relatedChunkIds, confidence) must be provided to update.',
      });
    }
  });

const MEMORY_DELETE_ARG_KEYS = ['memoryId', 'actor', 'reason', 'force'] as const;

const memoryDeleteArgsSchema = z
  .object({
    memoryId: z.string().trim().min(1, 'memoryId must not be empty'),
    actor: actorSchema,
    reason: z.string().trim().max(280).optional(),
    force: z.boolean().optional(),
  })
  .strict();

const addOutputSchema = z.object({
  memoryId: z.string(),
  memoryType: z.enum(MEMORY_TYPES),
  promptKey: z.string(),
  status: z.literal('created'),
  moderationStatus: z.enum(['accepted', 'pending_review']),
  createdAt: z.string(),
});

const updateOutputSchema = z.object({
  memoryId: z.string(),
  memoryType: z.enum(MEMORY_TYPES),
  promptKey: z.string(),
  status: z.literal('updated'),
  version: z.number().int().positive(),
  contentChanged: z.boolean(),
  updatedAt: z.string(),
});

const deleteOutputSchema = z.object({
  memoryId: z.string(),
  status: z.literal('inactive'),
  deletedAt: z.string(),
});

type MemoryAddArgs = z.infer<typeof memoryAddArgsSchema>;
type MemoryUpdateArgs = z.infer<typeof memoryUpdateArgsSchema>;
type MemoryDeleteArgs = z.infer<typeof memoryDeleteArgsSchema>;

export type MemoryAddOutput = z.infer<typeof addOutputSchema>;
export type MemoryUpdateOutput = z.infer<typeof updateOutputSchema>;
export type MemoryDeleteOutput = z.infer<typeof deleteOutputSchema>;

interface ModerationDecision {
  flagged: boolean;
  categories: string[];
}

export interface MemoryToolDependencies {
  repository?: MemoryRepositoryAdapter;
  linkRepository?: MemoryLinkRepositoryAdapter;
  embed?: typeof embedTexts;
  moderate?: (content: string) => Promise<ModerationDecision>;
  now?: () => Date;
  idGenerator?: () => string;
}

const defaultModerationClient = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

async function defaultModerate(content: string): Promise<ModerationDecision> {
  const response = await defaultModerationClient.moderations.create({
    model: MODERATION_MODEL,
    input: content,
  });

  const [result] = response.results ?? [];
  if (!result) {
    return { flagged: false, categories: [] };
  }

  const categories = Object.entries(result.categories ?? {})
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);

  return {
    flagged: Boolean(result.flagged),
    categories,
  };
}

export async function addMemory(
  args: MemoryAddArgs,
  dependencies: MemoryToolDependencies = {},
): Promise<MemoryAddOutput> {
  const repository: MemoryRepositoryAdapter =
    dependencies.repository ?? (new PromptEmbeddingsRepository() as MemoryRepositoryAdapter);
  const linkRepository: MemoryLinkRepositoryAdapter =
    dependencies.linkRepository ?? (new MemoryLinkRepository() as MemoryLinkRepositoryAdapter);
  const embed = dependencies.embed ?? embedTexts;
  const moderate = dependencies.moderate ?? defaultModerate;
  const now = dependencies.now ?? (() => new Date());
  const generateId = dependencies.idGenerator ?? randomUUID;

  enforceAddPermissions(args);

  const moderationDecision = await moderate(args.content);
  const allowFlagged =
    moderationDecision.flagged && args.force === true && canOverrideModeration(args.actor.type);
  if (moderationDecision.flagged && !allowFlagged) {
    throw new Error(
      `Content failed moderation: ${moderationDecision.categories.join(', ') || 'flagged'}.`,
    );
  }

  const chunkId = `memory-${generateId()}`;
  const promptKey = derivePromptKey(args.memoryType, args.title, chunkId);
  const createdAt = now().toISOString();
  const checksum = createHash('sha256').update(args.content).digest('hex');
  const [embedding] = await embed([args.content]);

  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Failed to generate embedding for memory content.');
  }

  const sanitizedTags = sanitiseTags(args.tags);
  const metadata = buildBaseMetadata({
    args,
    actor: args.actor,
    createdAt,
    version: 1,
    tags: sanitizedTags,
    moderation: moderationDecision,
    allowFlagged,
  });

  if (args.metadata) {
    metadata.custom = {
      ...(metadata.custom ?? {}),
      ...args.metadata,
    };
  }

  const relatedChunkIds =
    args.relatedChunkIds && args.relatedChunkIds.length > 0
      ? Array.from(new Set(args.relatedChunkIds))
      : undefined;
  if (relatedChunkIds) {
    metadata.relatedChunkIds = relatedChunkIds;
  }

  const record: EmbeddingRecord = {
    chunkId,
    promptKey,
    chunkText: args.content,
    rawSource: args.content,
    granularity: 'runtime',
    embedding,
    metadata,
    checksum,
    memoryType: args.memoryType,
  };

  await repository.upsertEmbeddings([record]);

  if (relatedChunkIds && relatedChunkIds.length > 0) {
    await linkRepository.upsertLinks(
      relatedChunkIds.map((targetChunkId) => ({
        sourceChunkId: chunkId,
        targetChunkId,
        linkType: LINK_TYPE_DEFAULT,
        strength: 0.6,
        metadata: {
          createdAt,
          createdBy: args.actor.id,
        },
      })),
    );
  }

  const moderationStatus = moderationDecision.flagged ? 'pending_review' : 'accepted';

  return {
    memoryId: chunkId,
    memoryType: args.memoryType,
    promptKey,
    status: 'created',
    moderationStatus,
    createdAt,
  };
}

export async function updateMemory(
  args: MemoryUpdateArgs,
  dependencies: MemoryToolDependencies = {},
): Promise<MemoryUpdateOutput> {
  const repository: MemoryRepositoryAdapter =
    dependencies.repository ?? (new PromptEmbeddingsRepository() as MemoryRepositoryAdapter);
  const linkRepository: MemoryLinkRepositoryAdapter =
    dependencies.linkRepository ?? (new MemoryLinkRepository() as MemoryLinkRepositoryAdapter);
  const embed = dependencies.embed ?? embedTexts;
  const now = dependencies.now ?? (() => new Date());

  const existing = await loadExistingChunk(repository, args.memoryId);
  enforceUpdatePermissions(args, existing);

  const sanitizedTags = args.tags ? sanitiseTags(args.tags) : undefined;
  const existingRelated = Array.isArray((existing.metadata as Record<string, unknown>)?.relatedChunkIds)
    ? ((existing.metadata as Record<string, unknown>).relatedChunkIds as string[])
    : undefined;
  const relatedChunkIds =
    args.relatedChunkIds !== undefined
      ? Array.from(new Set(args.relatedChunkIds))
      : existingRelated;

  const updatedMetadata = buildUpdatedMetadata({
    existing,
    actor: args.actor,
    tags: sanitizedTags,
    summary: args.summary,
    title: args.title,
    visibility: args.visibility,
    confidence: args.confidence,
    customMetadata: args.metadata,
    relatedChunkIds,
    updatedAt: now().toISOString(),
  });

  const contentChanged = typeof args.content === 'string';
  const chunkText = contentChanged ? args.content! : existing.chunkText;
  const [embedding] = contentChanged ? await embed([chunkText]) : [await reuseEmbedding(repository, args.memoryId)];

  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Failed to resolve embedding for memory update.');
  }

  const checksum = createHash('sha256').update(chunkText).digest('hex');

  const record: EmbeddingRecord = {
    chunkId: args.memoryId,
    promptKey: existing.promptKey,
    chunkText,
    rawSource: chunkText,
    granularity: existing.granularity ?? 'runtime',
    embedding,
    metadata: updatedMetadata,
    checksum,
    memoryType: existing.memoryType,
  };

  await repository.upsertEmbeddings([record]);

  if (relatedChunkIds !== undefined) {
    await linkRepository.deleteLinksForSource(args.memoryId);
    if (relatedChunkIds.length > 0) {
      await linkRepository.upsertLinks(
        relatedChunkIds.map((targetChunkId) => ({
          sourceChunkId: args.memoryId,
          targetChunkId,
          linkType: LINK_TYPE_DEFAULT,
          strength: 0.6,
          metadata: {
            updatedBy: args.actor.id,
            updatedAt: updatedMetadata.updatedAt,
          },
        })),
      );
    }
  }

  return {
    memoryId: args.memoryId,
    memoryType: existing.memoryType,
    promptKey: existing.promptKey,
    status: 'updated',
    version: updatedMetadata.version,
    contentChanged,
    updatedAt: updatedMetadata.updatedAt,
  };
}

export async function deleteMemory(
  args: MemoryDeleteArgs,
  dependencies: MemoryToolDependencies = {},
): Promise<MemoryDeleteOutput> {
  const repository: MemoryRepositoryAdapter =
    dependencies.repository ?? (new PromptEmbeddingsRepository() as MemoryRepositoryAdapter);
  const linkRepository: MemoryLinkRepositoryAdapter =
    dependencies.linkRepository ?? (new MemoryLinkRepository() as MemoryLinkRepositoryAdapter);
  const now = dependencies.now ?? (() => new Date());

  const existing = await loadExistingChunk(repository, args.memoryId);
  enforceDeletePermissions(args, existing);

  const embedding = await reuseEmbedding(repository, args.memoryId);
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Failed to resolve embedding while deleting memory.');
  }

  const deletedAt = now().toISOString();
  const existingMetadata = { ...(existing.metadata ?? {}) } as MemoryMetadata;
  const metadata: MemoryMetadata = {
    ...existingMetadata,
    status: 'inactive',
    deletedAt,
    deletedBy: args.actor.id,
    deletedReason: args.reason ?? null,
    history: appendHistory(existingMetadata, {
      action: 'deleted',
      timestamp: deletedAt,
      actorId: args.actor.id,
      reason: args.reason ?? null,
    }),
  };

  const record: EmbeddingRecord = {
    chunkId: args.memoryId,
    promptKey: existing.promptKey,
    chunkText: existing.chunkText,
    rawSource: existing.rawSource,
    granularity: existing.granularity ?? 'runtime',
    embedding,
    metadata,
    checksum: existing.checksum,
    memoryType: existing.memoryType,
  };

  await repository.upsertEmbeddings([record]);
  await linkRepository.deleteLinksForChunk(args.memoryId);

  return {
    memoryId: args.memoryId,
    status: 'inactive',
    deletedAt,
  };
}

export const MEMORY_ADD_TOOL_NAME = 'memory_add';
export const MEMORY_UPDATE_TOOL_NAME = 'memory_update';
export const MEMORY_DELETE_TOOL_NAME = 'memory_delete';

export function registerMemoryTools(
  server: McpServer,
  dependencies: MemoryToolDependencies = {},
): void {
  server.registerTool(
    MEMORY_ADD_TOOL_NAME,
    {
      title: 'Add runtime memory chunk',
      description: [
        'Adds a new memory chunk to the adaptive memory store, generating embeddings and metadata automatically.',
        'Includes moderation and permission checks before persisting the memory.',
        '',
        '## When to Use memory_add',
        'Create runtime memories for:',
        '- Decisions made during execution',
        '- User preferences/patterns discovered',
        '- Workflow outcomes worth remembering',
        '- Cross-session learnings',
        '',
        'Do NOT use for:',
        '- Conversation turns (use conversation_store instead)',
        '- Temporary data (session-scoped)',
        '- Duplicate information (check first with prompt_search)',
        '',
        '## Memory Type Selection',
        'persona: About a persona\'s behavior, style, capabilities',
        'project: Project-specific decisions, outcomes, patterns',
        'semantic: General knowledge, best practices, guidelines',
        'episodic: User interactions, preferences (requires sessionId)',
        'procedural: Step-by-step processes, workflows',
        '',
        '## Best Practices',
        '1. Always include descriptive title (except episodic)',
        '2. Add 3-5 relevant tags for discoverability',
        '3. Link related memories via relatedChunkIds',
        '4. Set appropriate confidence (0.5-0.9 for agent-created)',
        '5. Use visibility: "team" for shared, "private" for user-specific',
        '',
        '## Actor Types',
        'agent: AI agent creating memory (most common for you)',
        'user: Direct user input',
        'system: System-generated data',
        'integration: External workflow/API data',
        'operator: Human admin/reviewer',
      ].join('\n'),
      annotations: { category: 'memory' },
    },
    async (rawArgs: unknown) => {
      let args: MemoryAddArgs;
      try {
        const extracted = extractToolArgs(rawArgs, {
          allowedKeys: MEMORY_ADD_ARG_KEYS,
        });
        args = memoryAddArgsSchema.parse(extracted);
      } catch (error) {
        return formatValidationError(error, MEMORY_ADD_TOOL_NAME);
      }

      try {
        const output = await addMemory(args, dependencies);
        return formatSuccessResponse(
          [
            `✅ Added ${args.memoryType} memory chunk ${output.memoryId}.`,
            `Prompt key: ${output.promptKey}`,
            `Moderation: ${output.moderationStatus}`,
          ],
          output as Record<string, unknown>,
        );
      } catch (error) {
        return formatExecutionError(error, 'Failed to add memory chunk');
      }
    },
  );

  server.registerTool(
    MEMORY_UPDATE_TOOL_NAME,
    {
      title: 'Update runtime memory chunk',
      description: [
        'Updates an existing memory chunk, re-embedding content when modified and recording version history.',
      ].join('\n'),
      annotations: { category: 'memory' },
    },
    async (rawArgs: unknown) => {
      let args: MemoryUpdateArgs;
      try {
        const extracted = extractToolArgs(rawArgs, {
          allowedKeys: MEMORY_UPDATE_ARG_KEYS,
        });
        args = memoryUpdateArgsSchema.parse(extracted);
      } catch (error) {
        return formatValidationError(error, MEMORY_UPDATE_TOOL_NAME);
      }

      try {
        const output = await updateMemory(args, dependencies);
        return formatSuccessResponse(
          [
            `✅ Updated memory ${output.memoryId} to version ${output.version}.`,
            `Content changed: ${output.contentChanged ? 'yes' : 'no'}`,
          ],
          output as Record<string, unknown>,
        );
      } catch (error) {
        return formatExecutionError(error, 'Failed to update memory chunk');
      }
    },
  );

  server.registerTool(
    MEMORY_DELETE_TOOL_NAME,
    {
      title: 'Deactivate runtime memory chunk',
      description: [
        'Soft-deletes a memory chunk, marking it inactive and removing associated links while preserving audit history.',
      ].join('\n'),
      annotations: { category: 'memory' },
    },
    async (rawArgs: unknown) => {
      let args: MemoryDeleteArgs;
      try {
        const extracted = extractToolArgs(rawArgs, {
          allowedKeys: MEMORY_DELETE_ARG_KEYS,
        });
        args = memoryDeleteArgsSchema.parse(extracted);
      } catch (error) {
        return formatValidationError(error, MEMORY_DELETE_TOOL_NAME);
      }

      try {
        const output = await deleteMemory(args, dependencies);
        return formatSuccessResponse(
          [
            `✅ Marked memory ${output.memoryId} as inactive.`,
            `Deleted at: ${output.deletedAt}`,
          ],
          output as Record<string, unknown>,
        );
      } catch (error) {
        return formatExecutionError(error, 'Failed to delete memory chunk');
      }
    },
  );
}

function formatValidationError(error: unknown, toolName: string): CallToolResult {
  const message =
    error instanceof z.ZodError
      ? error.errors.map((err) => `${err.path.join('.') || 'root'}: ${err.message}`).join('; ')
      : error instanceof Error
        ? error.message
        : 'Unknown validation error.';

  return {
    content: [
      {
        type: 'text' as const,
        text: [`❌ ${toolName} validation failed: ${message}`].join('\n'),
      },
    ],
    isError: true,
  };
}

function formatExecutionError(error: unknown, prefix: string): CallToolResult {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return {
    content: [
      {
        type: 'text' as const,
        text: [`❌ ${prefix}: ${message}`].join('\n'),
      },
    ],
    isError: true,
  };
}

function formatSuccessResponse(
  lines: string[],
  structured: Record<string, unknown>,
): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: lines.join('\n'),
      },
    ],
    structuredContent: structured,
  };
}

interface MetadataOptions {
  args: MemoryAddArgs;
  actor: MemoryAddArgs['actor'];
  tags: string[] | undefined;
  createdAt: string;
  version: number;
  moderation: ModerationDecision;
  allowFlagged: boolean;
}

function buildBaseMetadata(options: MetadataOptions): MemoryMetadata {
  const { args, actor, tags, createdAt, version, moderation, allowFlagged } = options;
  const visibility = args.visibility ?? (actor.type === 'user' ? 'private' : 'team');
  const source = args.source ?? deriveSourceFromActor(actor.type);
  const sensitivity = deriveSensitivity(args.memoryType);
  const confidence = args.confidence ?? defaultConfidence(actor.type);

  const metadata: MemoryMetadata = {
    title: args.title ?? null,
    summary: args.summary ?? null,
    tags,
    source,
    visibility,
    createdBy: actor.id,
    createdAt,
    updatedAt: createdAt,
    updatedBy: actor.id,
    version,
    status: 'active',
    confidence,
    actorType: actor.type,
    sensitivity,
    history: [],
    moderation: {
      status: 'accepted',
      categories: [],
    },
  };

  if (args.sessionId) {
    metadata.sessionId = args.sessionId;
  }

  if (moderation.flagged) {
    metadata.moderation = {
      status: allowFlagged ? 'pending_review' : 'rejected',
      categories: moderation.categories,
    };
  }

  return metadata;
}

interface UpdateMetadataOptions {
  existing: PromptChunk;
  actor: MemoryUpdateArgs['actor'];
  tags?: string[];
  summary?: string;
  title?: string;
  visibility?: MemoryUpdateArgs['visibility'];
  confidence?: number;
  customMetadata?: Record<string, unknown>;
  relatedChunkIds?: string[] | undefined;
  updatedAt: string;
}

function buildUpdatedMetadata(options: UpdateMetadataOptions): MemoryMetadata {
  const existingMetadata = {
    ...(options.existing.metadata ?? {}),
  } as MemoryMetadata;

  if (!Array.isArray(existingMetadata.history)) {
    existingMetadata.history = [];
  }

  if (
    !existingMetadata.moderation ||
    typeof existingMetadata.moderation !== 'object' ||
    typeof existingMetadata.moderation.status !== 'string' ||
    !Array.isArray(existingMetadata.moderation.categories)
  ) {
    existingMetadata.moderation = {
      status: 'accepted',
      categories: [],
    };
  }
  const previousVersion = typeof existingMetadata.version === 'number' ? existingMetadata.version : 1;

  const changes: string[] = [];

  if (options.title !== undefined && options.title !== existingMetadata.title) {
    existingMetadata.title = options.title;
    changes.push('title');
  }

  if (options.summary !== undefined && options.summary !== existingMetadata.summary) {
    existingMetadata.summary = options.summary;
    changes.push('summary');
  }

  if (options.tags !== undefined) {
    existingMetadata.tags = options.tags;
    changes.push('tags');
  }

  if (options.visibility !== undefined && options.visibility !== existingMetadata.visibility) {
    existingMetadata.visibility = options.visibility;
    changes.push('visibility');
  }

  if (options.confidence !== undefined && options.confidence !== existingMetadata.confidence) {
    existingMetadata.confidence = options.confidence;
    changes.push('confidence');
  }

  if (options.relatedChunkIds !== undefined) {
    existingMetadata.relatedChunkIds = options.relatedChunkIds;
    changes.push('relatedChunkIds');
  }

  if (options.customMetadata) {
    existingMetadata.custom = {
      ...(existingMetadata.custom ?? {}),
      ...options.customMetadata,
    };
    changes.push('metadata');
  }

  const version = previousVersion + 1;

  existingMetadata.updatedAt = options.updatedAt;
  existingMetadata.updatedBy = options.actor.id;
  existingMetadata.version = version;
  existingMetadata.history = appendHistory(existingMetadata, {
    action: 'updated',
    timestamp: options.updatedAt,
    actorId: options.actor.id,
    changes,
  });

  return existingMetadata;
}

function appendHistory(metadata: MemoryMetadata | undefined, entry: MemoryHistoryEntry) {
  const history = Array.isArray(metadata?.history) ? [...metadata.history] : [];
  history.push(entry);
  return history.slice(-20);
}

function sanitiseTags(tags?: string[]): string[] | undefined {
  if (!tags) {
    return undefined;
  }
  const cleaned = tags
    .map((tag) => normaliseSlug(tag))
    .filter((value): value is string => Boolean(value));
  return cleaned.length > 0 ? cleaned : [];
}

function derivePromptKey(memoryType: MemoryType, title: string | undefined, chunkId: string): string {
  const slug = normaliseSlugOptional(title);
  const suffix = slug ?? chunkId.slice(0, 12);
  return `runtime::${memoryType}::${suffix}`;
}

function deriveSourceFromActor(actorType: (typeof ACTOR_TYPES)[number]): (typeof SOURCE_VALUES)[number] {
  switch (actorType) {
    case 'system':
      return 'system';
    case 'user':
      return 'user';
    case 'integration':
      return 'workflow';
    case 'operator':
    case 'agent':
    default:
      return 'agent';
  }
}

function deriveSensitivity(memoryType: MemoryType): 'low' | 'medium' | 'high' {
  switch (memoryType) {
    case 'persona':
    case 'procedural':
    case 'episodic':
      return 'high';
    case 'project':
      return 'medium';
    default:
      return 'low';
  }
}

function defaultConfidence(actorType: (typeof ACTOR_TYPES)[number]): number {
  if (actorType === 'system' || actorType === 'operator') {
    return 0.9;
  }
  if (actorType === 'agent') {
    return 0.6;
  }
  if (actorType === 'integration') {
    return 0.7;
  }
  return 0.5;
}

function enforceAddPermissions(args: MemoryAddArgs): void {
  const { actor, memoryType } = args;
  switch (actor.type) {
    case 'system':
    case 'operator':
      return;
    case 'agent':
      if (memoryType === 'episodic') {
        throw new Error('Agents are not permitted to add episodic memories.');
      }
      return;
    case 'integration':
      if (memoryType !== 'project' && memoryType !== 'semantic') {
        throw new Error('Integrations may only add project or semantic memories.');
      }
      return;
    case 'user':
      if (memoryType !== 'episodic') {
        throw new Error('Users may only add episodic memories.');
      }
      return;
    default:
      throw new Error(`Unsupported actor type "${actor.type}".`);
  }
}

function enforceUpdatePermissions(args: MemoryUpdateArgs, existing: PromptChunk): void {
  const { actor } = args;
  const metadata = existing.metadata ?? {};
  const createdBy = metadata.createdBy as string | undefined;

  switch (actor.type) {
    case 'system':
    case 'operator':
      return;
    case 'agent':
      if (existing.memoryType === 'episodic') {
        throw new Error('Agents cannot update episodic memories.');
      }
      if (createdBy && createdBy !== actor.id) {
        throw new Error('Agents may only update memories they created.');
      }
      return;
    case 'integration':
      if (existing.memoryType !== 'project' && existing.memoryType !== 'semantic') {
        throw new Error('Integrations may only update project or semantic memories.');
      }
      if (createdBy && createdBy !== actor.id) {
        throw new Error('Integrations may only update memories they created.');
      }
      return;
    case 'user':
      if (existing.memoryType !== 'episodic') {
        throw new Error('Users may only update their own episodic memories.');
      }
      if (createdBy && createdBy !== actor.id) {
        throw new Error('Users may only update memories they created.');
      }
      return;
    default:
      throw new Error(`Unsupported actor type "${actor.type}".`);
  }
}

function enforceDeletePermissions(args: MemoryDeleteArgs, existing: PromptChunk): void {
  const { actor } = args;
  switch (actor.type) {
    case 'system':
    case 'operator':
      return;
    case 'user':
      if (existing.memoryType === 'episodic') {
        const createdBy = existing.metadata?.createdBy as string | undefined;
        if (createdBy && createdBy === actor.id) {
          return;
        }
      }
      throw new Error('Users may not delete this memory.');
    default:
      throw new Error(`${actor.type} actors may not delete memories.`);
  }
}

function canOverrideModeration(actorType: (typeof ACTOR_TYPES)[number]): boolean {
  return actorType === 'system' || actorType === 'operator';
}

async function loadExistingChunk(
  repository: MemoryRepositoryAdapter,
  chunkId: string,
): Promise<PromptChunk> {
  const [chunk] = await repository.getChunksByIds([chunkId]);
  if (!chunk) {
    throw new Error(`Memory chunk ${chunkId} not found.`);
  }
  return chunk;
}

async function reuseEmbedding(
  repository: MemoryRepositoryAdapter,
  chunkId: string,
): Promise<number[]> {
  const result = await repository.getChunkEmbedding(chunkId);
  if (!result) {
    throw new Error(`Embedding for chunk ${chunkId} not found.`);
  }
  return result.embedding;
}

export const inputSchemas = {
  add: memoryAddArgsSchema,
  update: memoryUpdateArgsSchema,
  delete: memoryDeleteArgsSchema,
} as const;

export const outputSchemas = {
  add: addOutputSchema,
  update: updateOutputSchema,
  delete: deleteOutputSchema,
} as const;
