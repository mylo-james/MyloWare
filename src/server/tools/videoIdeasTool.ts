import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { OperationsRepository, videoStatusEnum } from '../../db/operations';
import type { Video, VideoStatus } from '../../db/operations';

const TOOL_NAME = 'video_ideas_snapshot';

const limitSchema = z
  .preprocess((value) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  }, z.number().int().min(1).max(500))
  .optional();

const statusValueSchema = z.enum(videoStatusEnum.enumValues);
const statusSchema = z.array(statusValueSchema).optional();

const baseArgsSchema = z.object({
  projectId: z
    .string()
    .trim()
    .uuid('projectId must be a UUID (e.g., 550e8400-e29b-41d4-a716-446655440000)')
    .optional()
    .describe('Project UUID to filter videos'),
  runId: z
    .string()
    .trim()
    .uuid('runId must be a UUID (e.g., 550e8400-e29b-41d4-a716-446655440000)')
    .optional()
    .describe('Workflow run UUID to filter videos'),
  status: statusSchema.describe('Filter by video status (array of: idea_gen, script_gen, video_gen, upload, complete, failed)'),
  limit: limitSchema.describe('Maximum number of videos to return (1-500, default: 200)'),
  includeMetadata: z.boolean().optional().describe('Include full metadata in response (default: false)'),
});

type VideoIdeasArgs = z.infer<typeof baseArgsSchema>;

type StatusInput = z.infer<typeof statusSchema>;

export interface VideoIdeasToolDependencies {
  repository?: OperationsRepository;
}

export interface VideoIdeasSnapshotEntry {
  id: string;
  idea: string;
  userIdea: string | null;
  vibe: string | null;
  status: VideoStatus;
  projectId: string;
  runId: string;
  createdAt: string | null;
  metadata?: Record<string, unknown>;
}

export interface VideoIdeasSnapshot {
  count: number;
  projectId: string | null;
  runId: string | null;
  statusFilter: VideoStatus[];
  limit: number;
  includeMetadata: boolean;
  videos: VideoIdeasSnapshotEntry[];
}

const outputSchema = z.object({
  count: z.number(),
  projectId: z.string().nullable(),
  runId: z.string().nullable(),
  statusFilter: z.array(statusValueSchema),
  limit: z.number(),
  includeMetadata: z.boolean(),
  videos: z.array(
    z.object({
      id: z.string(),
      idea: z.string(),
      userIdea: z.string().nullable(),
      vibe: z.string().nullable(),
      status: statusValueSchema,
      projectId: z.string(),
      runId: z.string(),
      createdAt: z.string().nullable(),
      metadata: z.record(z.any()).optional(),
    }),
  ),
});

function normalizeStatus(input?: StatusInput): VideoStatus[] | undefined {
  if (!input || input.length === 0) {
    return undefined;
  }

  return input as VideoStatus[];
}

function serializeVideos(rows: Video[], includeMetadata: boolean): VideoIdeasSnapshotEntry[] {
  return rows.map((video) => {
    const entry: VideoIdeasSnapshotEntry = {
      id: video.id,
      idea: video.idea,
      userIdea: video.userIdea ?? null,
      vibe: video.vibe ?? null,
      status: video.status,
      projectId: video.projectId,
      runId: video.runId,
      createdAt: video.createdAt ?? null,
    };

    if (includeMetadata) {
      entry.metadata = (video.metadata ?? {}) as Record<string, unknown>;
    }

    return entry;
  });
}

export async function fetchVideoIdeasSnapshot(
  repository: OperationsRepository,
  args: VideoIdeasArgs,
): Promise<VideoIdeasSnapshot> {
  const statusFilter = normalizeStatus(args.status);
  const limit = args.limit ?? 200;
  const includeMetadata = Boolean(args.includeMetadata);

  let videos: Video[] = [];

  if (args.runId) {
    videos = await repository.listVideosByRun(args.runId, {
      status: statusFilter,
      limit,
    });
  } else if (args.projectId) {
    videos = await repository.listVideosByProject(args.projectId, {
      status: statusFilter,
      limit,
    });
  } else {
    throw new Error('Either projectId or runId must be provided.');
  }

  return {
    count: videos.length,
    projectId: args.projectId ?? null,
    runId: args.runId ?? null,
    statusFilter: statusFilter ?? [],
    limit,
    includeMetadata,
    videos: serializeVideos(videos, includeMetadata),
  };
}

export function registerVideoIdeasTool(
  server: McpServer,
  dependencies: VideoIdeasToolDependencies = {},
): void {
  let repository = dependencies.repository;

  server.registerTool(
    TOOL_NAME,
    {
      title: 'Load existing video ideas to avoid duplicates',
      description: [
        'Retrieves a snapshot of existing video ideas from the database. Supports filtering by project ID or run ID, and optional status filtering. Returns a list of video ideas with their ID, idea title, user idea, vibe, status, project ID, run ID, creation timestamp, and optional metadata. Default limit is 200 ideas.',
        '',
        '## When to Use video_ideas_snapshot',
        'Use for:',
        '- Building exclusion lists before generating new ideas',
        '- Reviewing recent idea generation runs',
        '- Auditing idea status across a project',
        '',
        'Do NOT use for:',
        '- Semantic search (use prompt_search instead)',
        '- Finding similar concepts (use prompt_search with expandGraph)',
        '',
        '## Parameter Guidelines',
        'projectId: Filter by project (e.g., "aismr")',
        'runId: Filter by specific workflow run',
        'status: Filter by idea status (optional)',
        'limit: Max results (default 200)',
        '',
        'Returns chronological list (newest first) - use for quick lookups, not semantic matching.',
      ].join('\n'),
      inputSchema: baseArgsSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: {
        category: 'videos',
      },
    },
    async (args: any) => {
      // args is already validated by SDK and has type: VideoIdeasArgs
      const typedArgs = args as VideoIdeasArgs;
      
      // Validate that at least one scope is provided
      if (!typedArgs.projectId && !typedArgs.runId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: '❌ Provide projectId or runId to scope the video lookup.',
            },
          ],
          isError: true,
        };
      }
      
      try {
        if (!repository) {
          repository = new OperationsRepository();
        }
      } catch (initError) {
        const message = initError instanceof Error ? initError.message : 'Unknown database error';
        console.error(
          'Failed to initialize OperationsRepository for video_ideas_snapshot',
          initError,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `❌ video_ideas_snapshot failed to initialize database: ${message}`,
                '',
                'This is a system issue. Try again later or continue with limited context.',
              ].join('\n'),
            },
          ],
          isError: true,
        };
      }

      try {
        const snapshot = await fetchVideoIdeasSnapshot(repository, args as VideoIdeasArgs);
        const statusSummary =
          snapshot.statusFilter.length > 0 ? snapshot.statusFilter.join(', ') : 'all statuses';
        const scopeSummary = snapshot.runId
          ? `run ${snapshot.runId}`
          : `project ${snapshot.projectId}`;
        const summary = `Loaded ${snapshot.count} video ideas (${statusSummary}) for ${scopeSummary} (limit ${snapshot.limit}).`;

        return {
          content: [
            {
              type: 'text' as const,
              text: summary,
            },
          ],
          structuredContent: snapshot as unknown as Record<string, unknown>,
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unexpected error fetching video ideas snapshot.';
        console.error('video_ideas_snapshot tool error', error);
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `❌ video_ideas_snapshot failed: ${message}`,
                '',
                'Possible causes:',
                '  • Database connection issue',
                '  • Invalid project/run reference',
                '  • Query exceeded resource limits',
              ].join('\n'),
            },
          ],
          isError: true,
        };
      }
    },
  );

  console.info('[MCP] Tool registered:', TOOL_NAME);
}
