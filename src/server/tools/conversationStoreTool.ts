import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { EpisodicMemoryRepository } from '../../db/episodicRepository';
import type { StoreConversationTurnResult } from '../../db/episodicRepository';
import type { ConversationRole } from '../../db/schema';

const ROLE_VALUES = ['user', 'assistant', 'system', 'tool'] as [ConversationRole, ...ConversationRole[]];

const isoDateSchema = z
  .string()
  .datetime({ offset: true, message: 'Expected ISO 8601 timestamp with offset' });

const conversationStoreArgsSchema = z
  .object({
    sessionId: z.string().uuid('sessionId must be a UUID').optional(),
    role: z.enum(ROLE_VALUES),
    content: z.string().trim().min(1, 'content must not be empty'),
    userId: z.string().trim().min(1, 'userId must not be empty').optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    summary: z.record(z.string(), z.unknown()).optional(),
    embeddingText: z.string().trim().min(1, 'embeddingText must not be empty').optional(),
    occurredAt: isoDateSchema.optional(),
    tags: z
      .array(z.string().trim().min(1, 'tags must not be empty'))
      .max(20, 'tags must not exceed 20 items')
      .optional(),
  })
  .strict();

const outputSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string(),
  chunkId: z.string(),
  promptKey: z.string(),
  isNewSession: z.boolean(),
  storedAt: isoDateSchema,
});

type ConversationStoreArgs = z.infer<typeof conversationStoreArgsSchema>;
type ConversationStoreOutput = z.infer<typeof outputSchema>;

export interface ConversationStoreToolDependencies {
  repository?: EpisodicMemoryRepository;
}

const SOURCE_METADATA_KEY = 'source';
const SOURCE_METADATA_VALUE = 'conversation.store';
const TAGS_METADATA_KEY = 'tags';

export interface ConversationStoreOptions {
  generateSessionId?: () => string;
}

export async function storeConversationTurn(
  repository: EpisodicMemoryRepository,
  input: ConversationStoreArgs,
  options: ConversationStoreOptions = {},
): Promise<StoreConversationTurnResult> {
  const sessionIdGenerator = options.generateSessionId ?? randomUUID;
  const sessionId = input.sessionId ?? sessionIdGenerator();
  const metadata = normalizeMetadata(input.metadata, input.tags);

  if (!metadata[SOURCE_METADATA_KEY]) {
    metadata[SOURCE_METADATA_KEY] = SOURCE_METADATA_VALUE;
  }

  if (input.occurredAt && !metadata.occurred_at) {
    metadata.occurred_at = input.occurredAt;
  }

  return repository.storeConversationTurn({
    sessionId,
    role: input.role,
    content: input.content.trim(),
    userId: input.userId ?? null,
    summary: input.summary ?? null,
    metadata,
    embeddingText: input.embeddingText?.trim(),
  });
}

export function registerConversationStoreTool(
  server: McpServer,
  dependencies: ConversationStoreToolDependencies = {},
): void {
  let repository = dependencies.repository;
  const toolNames = ['conversation_store'] as const;

  const definition = {
    title: 'Store episodic conversation turn',
    description: [
      'Persists a conversation turn into episodic memory with embeddings and metadata.',
      'Returns identifiers that can be reused for subsequent operations.',
    ].join('\n'),
    inputSchema: conversationStoreArgsSchema.shape,
    outputSchema: outputSchema.shape,
    annotations: {
      category: 'memory',
    },
  };

  for (const toolName of toolNames) {
    server.registerTool(toolName, definition, async (rawArgs: unknown) => {
      let args: ConversationStoreArgs;

      try {
        args = conversationStoreArgsSchema.parse(rawArgs ?? {});
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to parse conversation_store input.';

        const tips = [
          'sessionId must be a UUID (or omit to create a new session)',
          'role must be one of: user, assistant, system, tool',
          'content must be a non-empty string',
          'embeddingText, if provided, must be a non-empty string',
          'occurredAt must be an ISO 8601 timestamp with timezone offset',
        ];

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `❌ conversation_store validation failed: ${message}`,
                '',
                '💡 Common fixes:',
                ...tips.map((tip) => `  • ${tip}`),
              ].join('\n'),
            },
          ],
          isError: true,
        };
      }

      try {
        if (!repository) {
          repository = new EpisodicMemoryRepository();
        }

        const result = await storeConversationTurn(repository, args);

        const storedAt = toIsoTimestamp(result.turn.updatedAt ?? result.turn.createdAt);

        const response: ConversationStoreOutput = {
          sessionId: result.turn.sessionId,
          turnId: result.turn.id,
          chunkId: result.chunkId,
          promptKey: result.promptKey,
          isNewSession: result.isNewSession,
          storedAt,
        };

        const summaryLines = [
          `✅ Stored ${args.role} turn in session ${response.sessionId}.`,
          `Turn #${result.turn.turnIndex} → chunk ${response.chunkId}.`,
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
          error instanceof Error ? error.message : 'Unexpected error storing conversation turn.';

        console.error('conversation_store failed', error);

        const guidance = [
          `❌ Failed to store conversation turn: ${message}`,
          '',
          '💡 Suggested actions:',
          '  • Retry with shorter content if the payload is large',
          '  • Verify the sessionId is valid and consistent per conversation',
          '  • Confirm the episodic memory database is reachable',
        ];

        return {
          content: [
            {
              type: 'text' as const,
              text: guidance.join('\n'),
            },
          ],
          isError: true,
        };
      }
    });
  }

  console.info('[MCP] Tool registered:', toolNames.join(', '));
}

function normalizeMetadata(
  metadata: Record<string, unknown> | undefined,
  tags: string[] | undefined,
): Record<string, unknown> {
  const normalized = metadata ? { ...metadata } : {};

  if (tags && tags.length > 0) {
    normalized[TAGS_METADATA_KEY] = [...new Set(tags)];
  }

  return normalized;
}

function toIsoTimestamp(value?: string | null): string {
  if (value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return new Date().toISOString();
}
