import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { EpisodicMemoryRepository } from '../../db/episodicRepository';
import type { ConversationTurnRecord, ConversationSearchResult } from '../../db/episodicRepository';
import { extractToolArgs } from './argUtils';

const FORMAT_VALUES = ['chat', 'narrative', 'bullets'] as const;
type ContextFormat = (typeof FORMAT_VALUES)[number];

const isoDateSchema = z
  .string()
  .datetime({ offset: true, message: 'Expected ISO 8601 timestamp with offset' });

const timeRangeSchema = z
  .object({
    start: isoDateSchema.optional(),
    end: isoDateSchema.optional(),
  })
  .refine(
    (range) => {
      if (!range.start || !range.end) {
        return true;
      }
      return new Date(range.start) <= new Date(range.end);
    },
    { message: 'timeRange.start must be earlier than or equal to timeRange.end' },
  );

const CONVERSATION_MEMORY_ARG_KEYS = [
  'query',
  'sessionId',
  'userId',
  'limit',
  'minSimilarity',
  'timeRange',
  'format',
] as const;

const conversationRememberArgsSchema = z.object({
  query: z.string().trim().min(1, 'query must not be empty'),
  sessionId: z.string().uuid('sessionId must be a UUID').optional(),
  userId: z.string().trim().min(1, 'userId must not be empty').optional(),
  limit: z.number().int().positive().max(50).optional(),
  minSimilarity: z.number().min(0).max(1).optional(),
  timeRange: timeRangeSchema.optional(),
  format: z.enum(FORMAT_VALUES).optional(),
});

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
  similarity: z.number(),
  chunkId: z.string(),
  promptKey: z.string(),
});

const filtersSchema = z.object({
  query: z.string(),
  sessionId: z.string().nullable(),
  userId: z.string().nullable(),
  limit: z.number(),
  minSimilarity: z.number(),
  format: z.enum(FORMAT_VALUES),
  timeRange: z
    .object({
      start: z.string().nullable(),
      end: z.string().nullable(),
    })
    .nullable(),
});

const outputSchema = z.object({
  turns: z.array(turnSchema),
  context: z.string(),
  appliedFilters: filtersSchema,
});

type ConversationMemoryInput = z.infer<typeof conversationRememberArgsSchema>;
type ConversationMemoryOutput = z.infer<typeof outputSchema>;

export interface ConversationMemoryToolDependencies {
  repository?: EpisodicMemoryRepository;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_SIMILARITY = 0.25;
const MAX_PREVIEW_LENGTH = 220;
const MAX_APPROX_TOKENS = 600;

export async function rememberConversations(
  repository: EpisodicMemoryRepository,
  args: ConversationMemoryInput,
): Promise<ConversationMemoryOutput> {
  const limit = clamp(args.limit ?? DEFAULT_LIMIT, 1, 50);
  const minSimilarity = clampSimilarity(args.minSimilarity ?? DEFAULT_MIN_SIMILARITY);
  const format: ContextFormat = args.format ?? 'chat';
  const timeRange = args.timeRange
    ? {
        start: args.timeRange.start ? new Date(args.timeRange.start) : undefined,
        end: args.timeRange.end ? new Date(args.timeRange.end) : undefined,
      }
    : undefined;

  const results = await repository.searchConversationHistory(args.query, {
    limit,
    minSimilarity,
    sessionId: args.sessionId,
    userId: args.userId,
    from: timeRange?.start,
    to: timeRange?.end,
  });

  const sorted = sortConversationResults(results);
  const context = formatContext(sorted, format);

  const turns = sorted.map((result) => ({
    id: result.turn.id,
    sessionId: result.turn.sessionId,
    userId: result.turn.userId,
    role: result.turn.role,
    turnIndex: result.turn.turnIndex,
    content: result.turn.content,
    summary: result.turn.summary,
    metadata: result.turn.metadata,
    createdAt: result.turn.createdAt,
    updatedAt: result.turn.updatedAt,
    similarity: result.similarity,
    chunkId: result.chunkId,
    promptKey: result.promptKey,
  }));

  return {
    turns,
    context,
    appliedFilters: {
      query: args.query,
      sessionId: args.sessionId ?? null,
      userId: args.userId ?? null,
      limit,
      minSimilarity,
      format,
      timeRange: args.timeRange
        ? {
            start: args.timeRange.start ?? null,
            end: args.timeRange.end ?? null,
          }
        : null,
    },
  };
}

export function registerConversationMemoryTool(
  server: McpServer,
  dependencies: ConversationMemoryToolDependencies = {},
): void {
  let repository = dependencies.repository;
  const toolName = 'conversation_remember';

  server.registerTool(
    toolName,
    {
      title: 'Retrieve episodic conversation context',
      description: [
        'Instantly pull the most relevant past conversation turns using semantic search, session/user filters, and time ranges.',
        'Choose chat, narrative, or bullet formatting so you can drop the recall straight into a response plan.',
        'Perfect for grounding follow-up answers without manually paging through history.',
        '',
        '## Self-Referential Usage',
        'Query for your own past work and learn from experience:',
        '- "my recent generated ideas" → recall your past outputs and patterns',
        '- "user feedback on my work" → learn from user responses and corrections',
        '- "rejected concepts" → identify past failures to avoid repeating',
        '- "user preferences" → recall stated constraints and requirements',
        '- "past conversation context" → retrieve recent dialogue for continuity',
        '',
        '## When to Use conversation_remember',
        'Use for:',
        '- Recalling past interactions within a session',
        '- Finding user preferences/feedback',
        '- Retrieving prior outputs for exclusion/comparison',
        '- Understanding conversation context',
        '',
        'Do NOT use for:',
        '- Prompt/workflow definitions (use prompt_search)',
        '- General knowledge (use prompt_search)',
        '- Cross-session patterns (conversation is session-scoped)',
        '',
        '## Parameter Guidelines',
        'sessionId: REQUIRED - scope to specific conversation',
        'query: Semantic search query ("user feedback on captions", "rejected ideas")',
        'limit: Results to return (default 10, max 50)',
        'format:',
        '  - "chat": Timestamped turn-by-turn (best for dialogue)',
        '  - "narrative": Connected prose (best for summaries)',
        '  - "bullets": Quick list format (best for scanning)',
        '',
        '## Common Patterns',
        '1. Find exclusions: {query: "generated ideas", sessionId, limit: 20}',
        '2. Recall feedback: {query: "user feedback quality", sessionId, format: "bullets"}',
        '3. Check history: {query: "past discussion [topic]", sessionId, format: "narrative"}',
      ].join('\n'),
      inputSchema: conversationRememberArgsSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: {
        category: 'memory',
      },
    },
    async (rawArgs: unknown) => {
      let args: ConversationMemoryInput;

      try {
        const extracted = extractToolArgs(rawArgs, {
          allowedKeys: CONVERSATION_MEMORY_ARG_KEYS,
        });
        args = conversationRememberArgsSchema.parse(extracted);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to parse conversation_remember arguments.';

        const suggestions = [
          'Ensure query is a non-empty string',
          'If using sessionId, it must be a valid UUID',
          'If using userId, it must be a non-empty string',
          'limit must be between 1-50',
          'minSimilarity must be between 0-1',
          'timeRange dates must be ISO 8601 format with timezone',
          'format must be one of: chat, narrative, bullets',
        ];

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `❌ conversation_remember validation failed: ${message}`,
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
            repository = new EpisodicMemoryRepository();
          } catch (initError) {
            const initMessage = initError instanceof Error ? initError.message : 'Unknown error';
            console.error('Failed to initialize EpisodicMemoryRepository', initError);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: [
                    `❌ conversation_remember failed to initialize database: ${initMessage}`,
                    '',
                    '💡 This is a system issue, not your fault:',
                    '  • The database connection could not be established',
                    '  • The system administrator needs to check the database service',
                    '  • You can try again in a moment, or proceed without memory search',
                    '',
                    'Consider using other tools or continuing without conversation context.',
                  ].join('\n'),
                },
              ],
              isError: true,
            };
          }
        }

        const result = await rememberConversations(repository, args);
        if (result.turns.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No conversation turns found for "${args.query}".`,
              },
            ],
            structuredContent: result,
          };
        }

        const summary = buildResponseSummary(
          result.turns,
          result.context,
          result.appliedFilters.format,
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: summary,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unexpected error retrieving conversation memory.';

        console.error('conversation_remember failed', error);

        // Provide context about what was being searched
        const errorContext = [
          `❌ conversation_remember failed: ${message}`,
          '',
          '🔍 Search parameters attempted:',
          `  • Query: "${args.query}"`,
        ];

        if (args.sessionId) {
          errorContext.push(`  • Session ID: ${args.sessionId}`);
        }
        if (args.userId) {
          errorContext.push(`  • User ID: ${args.userId}`);
        }
        if (args.limit) {
          errorContext.push(`  • Limit: ${args.limit}`);
        }
        if (args.minSimilarity !== undefined) {
          errorContext.push(`  • Min Similarity: ${args.minSimilarity}`);
        }
        if (args.timeRange) {
          errorContext.push(`  • Time Range: ${JSON.stringify(args.timeRange)}`);
        }

        errorContext.push('');
        errorContext.push('💡 Possible solutions:');

        // Provide actionable suggestions based on error type
        if (message.includes('database') || message.includes('connection')) {
          errorContext.push('  • Database connection issue - system may be initializing');
          errorContext.push('  • Wait a moment and try again');
          errorContext.push('  • Check if the database service is running');
        } else if (message.includes('timeout')) {
          errorContext.push('  • Query took too long - try narrowing your search');
          errorContext.push('  • Add a sessionId or userId filter');
          errorContext.push('  • Reduce the limit or add a timeRange');
        } else if (message.includes('vector') || message.includes('embedding')) {
          errorContext.push('  • Embedding service may be unavailable');
          errorContext.push('  • Try a simpler query with common words');
          errorContext.push('  • Check if vector search is properly configured');
        } else {
          errorContext.push('  • Try broadening your search query');
          errorContext.push('  • Remove optional filters (sessionId, userId, timeRange)');
          errorContext.push('  • Lower the minSimilarity threshold');
          errorContext.push('  • Increase the limit to find more results');
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: errorContext.join('\n'),
            },
          ],
          isError: true,
        };
      }
    },
  );

  console.info('[MCP] Tool registered:', toolName);
}

function sortConversationResults(results: ConversationSearchResult[]): ConversationSearchResult[] {
  return [...results].sort((a, b) => {
    if (a.turn.sessionId === b.turn.sessionId) {
      return a.turn.turnIndex - b.turn.turnIndex;
    }
    return a.turn.sessionId.localeCompare(b.turn.sessionId);
  });
}

function formatContext(results: ConversationSearchResult[], format: ContextFormat): string {
  if (results.length === 0) {
    return '';
  }

  const segments: string[] = [];
  let tokensUsed = 0;

  for (const result of results) {
    let segment: string;
    switch (format) {
      case 'chat': {
        const timestamp = result.turn.createdAt ? ` [${result.turn.createdAt}]` : '';
        const content = truncate(result.turn.content, MAX_PREVIEW_LENGTH);
        segment = `${capitalize(result.turn.role)}${timestamp}: ${content}`;
        break;
      }
      case 'narrative': {
        const who = result.turn.role === 'assistant' ? 'The assistant' : 'The user';
        const summary = buildNarrativeSnippet(result.turn);
        segment = `${who} ${summary}`;
        break;
      }
      case 'bullets': {
        const preview = truncate(result.turn.content, MAX_PREVIEW_LENGTH);
        segment = `- (${result.turn.role}) ${preview}`;
        break;
      }
      default:
        segment = '';
    }

    const segmentTokens = approximateTokenCount(segment);
    if (tokensUsed + segmentTokens > MAX_APPROX_TOKENS) {
      segments.push('[…context truncated to respect token budget…]');
      break;
    }

    segments.push(segment);
    tokensUsed += segmentTokens;
  }

  if (format === 'narrative') {
    return segments.join(' ');
  }

  return segments.join('\n');
}

function buildResponseSummary(
  turns: Array<ConversationMemoryOutput['turns'][number]>,
  context: string,
  format: ContextFormat,
): string {
  const top = turns[0];
  const header = `Found ${turns.length} conversation turn${turns.length === 1 ? '' : 's'} (format: ${format}).`;
  const focus = top
    ? `Most recent turn: ${capitalize(top.role)} — ${truncate(top.content, 120)}`
    : 'No turns returned.';

  return [header, focus, '', context].filter((part) => part && part.length > 0).join('\n');
}

function buildNarrativeSnippet(turn: ConversationTurnRecord): string {
  if (turn.summary && typeof turn.summary === 'object' && 'headline' in turn.summary) {
    const headline = turn.summary.headline;
    if (typeof headline === 'string' && headline.trim().length > 0) {
      return `shared: ${headline.trim()}.`;
    }
  }

  const content = truncate(turn.content, 160);
  return `said "${content}".`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampSimilarity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MIN_SIMILARITY;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}

function approximateTokenCount(value: string): number {
  if (!value || value.trim().length === 0) {
    return 0;
  }
  return value.trim().split(/\s+/).length;
}
