import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { EpisodicMemoryRepository } from '../../db/episodicRepository';
import { extractToolArgs } from './argUtils';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const CONVERSATION_LATEST_ARG_KEYS = ['sessionId', 'limit', 'order'] as const;

const argsSchema = z
  .object({
    sessionId: z.string().uuid('sessionId must be a valid UUID'),
    limit: z
      .number()
      .int()
      .min(1, 'limit must be at least 1')
      .max(MAX_LIMIT, `limit must not exceed ${MAX_LIMIT}`)
      .optional(),
    order: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

const turnSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  userId: z.string().nullable(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  turnIndex: z.number().int().min(0),
  content: z.string(),
  summary: z.record(z.string(), z.unknown()).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const outputSchema = z.object({
  turns: z.array(turnSchema),
  sessionId: z.string(),
  fetched: z.number().int(),
  limit: z.number().int(),
  order: z.enum(['asc', 'desc']),
});

type ConversationLatestArgs = z.infer<typeof argsSchema>;
type ConversationLatestOutput = z.infer<typeof outputSchema>;

export interface ConversationLatestToolDependencies {
  repository?: EpisodicMemoryRepository;
}

export function registerConversationLatestTool(
  server: McpServer,
  dependencies: ConversationLatestToolDependencies = {},
): void {
  let repository = dependencies.repository;
  const toolName = 'conversation_latest';

  server.registerTool(
    toolName,
    {
      title: 'Fetch recent conversation turns',
      description: [
        'Pull the most recent conversation turns for a session without doing semantic search.',
        'Perfect when you just need the latest context window before making a decision.',
        'Defaults to 10 newest turns (descending order).',
        '',
        '## When to Use conversation_latest',
        'Use when:',
        '- You need recent context (last N turns)',
        '- No semantic search required (just chronological order)',
        '- Fast retrieval needed (no embedding search overhead)',
        '',
        'Do NOT use when:',
        '- You need semantic relevance (use conversation_remember instead)',
        '- Searching for specific topics across history',
        '',
        '## Parameter Guidelines',
        'sessionId: REQUIRED - conversation identifier',
        'limit: Number of recent turns (default 10, max 50)',
        '',
        'Returns turns in descending chronological order (newest first).',
      ].join('\n'),
      inputSchema: argsSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: {
        category: 'memory',
      },
    },
    async (rawArgs: unknown) => {
      let args: ConversationLatestArgs;

      try {
        const extracted = extractToolArgs(rawArgs, {
          allowedKeys: CONVERSATION_LATEST_ARG_KEYS,
        });
        args = argsSchema.parse(extracted);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to parse conversation_latest arguments.';
        return {
          content: [
            {
              type: 'text' as const,
              text: `conversation_latest validation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        if (!repository) {
          repository = new EpisodicMemoryRepository();
        }

        const limit = args.limit ?? DEFAULT_LIMIT;
        const order = args.order ?? 'desc';

        const turns = await repository.getSessionHistory(args.sessionId, {
          limit,
          order,
        });

        const response: ConversationLatestOutput = {
          turns,
          sessionId: args.sessionId,
          fetched: turns.length,
          limit,
          order,
        };

        const summaryLines = [
          `Fetched ${turns.length} turn${turns.length === 1 ? '' : 's'} for session ${args.sessionId}.`,
          turns[0] ? `Newest turn #${turns[0].turnIndex} (${turns[0].role}).` : 'No turns found for this session.',
        ];

        return {
          content: [
            {
              type: 'text' as const,
              text: summaryLines.join('\n'),
            },
          ],
          structuredContent: response,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error fetching conversation turns.';
        console.error('conversation_latest failed', error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `conversation_latest failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  console.info('[MCP] Tool registered:', toolName);
}
