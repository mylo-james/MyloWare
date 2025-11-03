import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { OperationsRepository } from '../../db/operations/repository';
import { extractToolArgs } from './argUtils';

const VIDEO_QUERY_ARG_KEYS = ['idea', 'projectId', 'fuzzyMatch'] as const;

const videoQueryArgsSchema = z.object({
  idea: z.string().trim().min(1, 'idea must not be empty'),
  projectId: z.string().trim().min(1, 'projectId must not be empty (use UUID, not slug)'),
  fuzzyMatch: z.boolean().optional(),
});

type VideoQueryInput = z.infer<typeof videoQueryArgsSchema>;

interface VideoQueryResult {
  exists: boolean;
  matchedVideos: Array<{
    id: string;
    idea: string;
    vibe: string | null;
    status: string;
    createdAt: string | null;
    runId: string;
  }>;
  confidence: 'exact' | 'fuzzy' | 'none';
}

const outputSchema = z.object({
  exists: z.boolean(),
  matchedVideos: z.array(
    z.object({
      id: z.string(),
      idea: z.string(),
      vibe: z.string().nullable(),
      status: z.string(),
      createdAt: z.string().nullable(),
      runId: z.string(),
    }),
  ),
  confidence: z.enum(['exact', 'fuzzy', 'none']),
});

export interface VideoQueryToolDependencies {
  repository?: OperationsRepository;
}

async function queryVideos(
  repository: OperationsRepository,
  args: VideoQueryInput,
): Promise<VideoQueryResult> {
  // Query all videos by project - projectId can be UUID or slug
  // The repository will handle the query, and we filter by idea client-side
  const allVideos = await repository.listVideosByProject(args.projectId, { limit: 1000 });

  const normalizedIdea = args.idea.toLowerCase().trim();
  
  // First try exact match (case-insensitive)
  const exactMatches = allVideos.filter(
    (video) => video.idea.toLowerCase().trim() === normalizedIdea,
  );

  if (exactMatches.length > 0) {
    return {
      exists: true,
      matchedVideos: exactMatches.map((video) => ({
        id: video.id,
        idea: video.idea,
        vibe: video.vibe,
        status: video.status,
        createdAt: video.createdAt,
        runId: video.runId,
      })),
      confidence: 'exact',
    };
  }

  // If fuzzy matching enabled, try partial matches
  if (args.fuzzyMatch) {
    const fuzzyMatches = allVideos.filter((video) => {
      const videoIdea = video.idea.toLowerCase().trim();
      // Check if idea contains the query or vice versa
      return (
        videoIdea.includes(normalizedIdea) ||
        normalizedIdea.includes(videoIdea) ||
        // Word-level matching: check if either word matches
        normalizedIdea.split(' ').some((word) => videoIdea.includes(word)) ||
        videoIdea.split(' ').some((word) => normalizedIdea.includes(word))
      );
    });

    if (fuzzyMatches.length > 0) {
      return {
        exists: true,
        matchedVideos: fuzzyMatches.map((video) => ({
          id: video.id,
          idea: video.idea,
          vibe: video.vibe,
          status: video.status,
          createdAt: video.createdAt,
          runId: video.runId,
        })),
        confidence: 'fuzzy',
      };
    }
  }

  return {
    exists: false,
    matchedVideos: [],
    confidence: 'none',
  };
}

export function registerVideoQueryTool(
  server: McpServer,
  dependencies: VideoQueryToolDependencies = {},
): void {
  let repository = dependencies.repository;
  const toolName = 'video_query';

  server.registerTool(
    toolName,
    {
      title: 'Query videos by idea',
      description: [
        'Check if a 2-word idea already exists in the videos table for a given project.',
        'Returns existing videos with matching idea, vibe, status, and creation date.',
        'Supports exact matching and optional fuzzy matching for similar ideas.',
        '',
        '## Usage',
        'Query for existing videos to check uniqueness before generating new ideas:',
        '- Exact match: Check if exact idea title exists',
        '- Fuzzy match: Find similar ideas (same words, partial matches)',
        '',
        '## IMPORTANT: projectId Format',
        'projectId must be a UUID (e.g., "550e8400-e29b-41d4-a716-446655440000"), NOT a slug like "aismr".',
        'The videos table stores project_id as UUID. You must obtain the UUID from the workflow context.',
        '',
        '## Examples',
        '- Check exact: {idea: "velvet puppy", projectId: "550e8400-e29b-41d4-a716-446655440000", fuzzyMatch: false}',
        '- Check fuzzy: {idea: "velvet puppy", projectId: "550e8400-e29b-41d4-a716-446655440000", fuzzyMatch: true}',
      ].join('\n'),
      inputSchema: videoQueryArgsSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: {
        category: 'videos',
      },
    },
    async (rawArgs: unknown) => {
      let args: VideoQueryInput;

      try {
        const extracted = extractToolArgs(rawArgs, {
          allowedKeys: VIDEO_QUERY_ARG_KEYS,
        });
        args = videoQueryArgsSchema.parse(extracted);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to parse video_query arguments.';

        const suggestions = [
          'Ensure idea is a non-empty string (2-word title)',
          'Ensure projectId is a UUID (NOT a slug like "aismr") - get it from workflow context',
          'fuzzyMatch must be true or false if provided',
        ];

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `❌ video_query validation failed: ${message}`,
                '',
                '💡 Common fixes:',
                ...suggestions.map((s) => `  • ${s}`),
                '',
                'Try simplifying your request or check the parameter values.',
              ].join('\n'),
            },
          ],
          isError: true,
        };
      }

      try {
        if (!repository) {
          try {
            repository = new OperationsRepository();
          } catch (initError) {
            const initMessage = initError instanceof Error ? initError.message : 'Unknown error';
            console.error('Failed to initialize OperationsRepository', initError);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: [
                    `❌ video_query failed to initialize database: ${initMessage}`,
                    '',
                    '💡 This is a system issue, not your fault:',
                    '  • The operations database connection could not be established',
                    '  • The system administrator needs to check the database service',
                    '  • You can try again in a moment, or proceed without uniqueness checking',
                    '',
                    'Consider using other tools or continuing without video table lookup.',
                  ].join('\n'),
                },
              ],
              isError: true,
            };
          }
        }

        const result = await queryVideos(repository, args);

        const summary = result.exists
          ? `Found ${result.matchedVideos.length} existing video(s) with ${result.confidence} match for "${args.idea}"`
          : `No existing videos found for "${args.idea}"`;

        return {
          content: [
            {
              type: 'text' as const,
              text: summary,
            },
          ],
          structuredContent: {
            exists: result.exists,
            matchedVideos: result.matchedVideos,
            confidence: result.confidence,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unexpected error querying videos table.';

        console.error('video_query tool error', error);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `❌ video_query failed: ${message}`,
                '',
                '💡 Possible causes:',
                '  • Database connection issue',
                '  • Invalid projectId format (must be UUID, not slug like "aismr")',
                '  • Permission error accessing videos table',
                '',
                'If you passed a slug like "aismr", you need to pass the project UUID instead.',
                'Get the project UUID from the workflow context (runData.project_id).',
                '',
                'Try again with correct projectId or proceed without uniqueness checking.',
              ].join('\n'),
            },
          ],
          isError: true,
        };
      }
    },
  );
}

