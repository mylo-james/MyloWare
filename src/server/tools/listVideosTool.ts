import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../../config';
import {
  OperationsRepository,
  type ListVideosOptions,
  type Video,
} from '../../db/operations';

const VIDEO_STATUS_VALUES = [
  'idea_gen',
  'script_gen',
  'video_gen',
  'upload',
  'complete',
  'failed',
] as const;

const inputSchema = z.object({
  projectId: z.string().trim().min(1, 'projectId is required'),
  status: z
    .array(z.enum(VIDEO_STATUS_VALUES))
    .nonempty()
    .max(VIDEO_STATUS_VALUES.length)
    .optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const videoSchema = z.object({
  id: z.string(),
  idea: z.string(),
  userIdea: z.string().nullable(),
  vibe: z.string().nullable(),
  status: z.enum(VIDEO_STATUS_VALUES),
  prompt: z.string().nullable(),
  videoLink: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const outputSchema = z.object({
  projectId: z.string(),
  total: z.number().int().nonnegative(),
  videos: z.array(videoSchema),
});

type ListVideosInput = z.infer<typeof inputSchema>;
type ListVideosOutput = z.infer<typeof outputSchema>;

export interface ListVideosToolDependencies {
  repository?: OperationsRepository;
}

export function registerListVideosTool(
  server: McpServer,
  dependencies: ListVideosToolDependencies = {},
): void {
  let repository = dependencies.repository;

  const toolName = 'videos_list';

  server.registerTool(
    toolName,
    {
      title: 'List videos by project',
      description:
        'Return videos for a project filtered by status. Useful for uniqueness checks and workflow auditing.',
      inputSchema: inputSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: {
        category: 'operations',
      },
    },
    async (rawArgs) => {
      if (!config.operationsDatabaseUrl) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'videos_list failed: OPERATIONS_DATABASE_URL is not configured on the server.',
            },
          ],
          isError: true,
        };
      }

      let args: ListVideosInput;

      try {
        args = inputSchema.parse(rawArgs ?? {});
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to parse videos_list arguments';
        return {
          content: [
            {
              type: 'text' as const,
              text: `videos_list validation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        if (!repository) {
          repository = new OperationsRepository();
        }

        const repo = repository;

        const options: ListVideosOptions = {
          status: args.status,
          limit: args.limit ?? 200,
        };

        const rows = await repo.listVideosByProject(args.projectId, options);
        const videos = rows.map((row) => serializeVideo(row));

        const structured: ListVideosOutput = {
          projectId: args.projectId,
          total: videos.length,
          videos,
        };

        if (!videos.length) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No videos found for project "${args.projectId}" with the requested filters.`,
              },
            ],
            structuredContent: structured,
          };
        }

        const summaryLines = videos
          .slice(0, 10)
          .map((video) => formatVideoLine(video))
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${videos.length} video(s) for project "${args.projectId}".`,
            },
            {
              type: 'text' as const,
              text: `First ${Math.min(videos.length, 10)} result(s):\n${summaryLines}`,
            },
          ],
          structuredContent: structured,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error querying videos.';
        console.error('videos_list failed', error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `videos_list failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  console.info('[MCP] Tool registered:', toolName);
}

function serializeVideo(video: Video) {
  return {
    id: video.id,
    idea: video.idea,
    userIdea: video.userIdea ?? null,
    vibe: video.vibe ?? null,
    status: video.status,
    prompt: video.prompt ?? null,
    videoLink: video.videoLink ?? null,
    errorMessage: video.errorMessage ?? null,
    startedAt: toIsoString(video.startedAt),
    completedAt: toIsoString(video.completedAt),
    createdAt: toIsoString(video.createdAt),
    updatedAt: toIsoString(video.updatedAt),
  };
}

function toIsoString(value: Video['createdAt']): string | null {
  if (!value) {
    return null;
  }

  const asDate = typeof value === 'string' ? new Date(value) : value;
  const timestamp = asDate instanceof Date ? asDate : new Date(asDate);

  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function formatVideoLine(video: z.infer<typeof videoSchema>): string {
  const vibeText = video.vibe ? `vibe="${video.vibe}"` : 'vibe=-';
  const statusText = `status=${video.status}`;
  const ideaText = `idea="${video.idea}"`;
  return `${video.id}: ${ideaText}; ${statusText}; ${vibeText}`;
}
