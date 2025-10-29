import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PromptEmbeddingsRepository } from '../../db/repository';
import type { PromptEmbedding } from '../../db/schema';

export const getPromptInputSchema = z.object({
  filePath: z.string().trim().min(1, 'filePath is required'),
  includeMetadata: z.boolean().optional().default(false),
});

const chunkSchema = z.object({
  chunkId: z.string(),
  filePath: z.string(),
  granularity: z.enum(['document', 'chunk']),
  text: z.string(),
  rawMarkdown: z.string(),
  checksum: z.string(),
  order: z.number().int(),
  metadata: z.record(z.unknown()).optional(),
});

export const getPromptOutputSchema = z.object({
  filePath: z.string(),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
  chunks: z.array(chunkSchema),
});

type GetPromptInput = z.infer<typeof getPromptInputSchema>;
type GetPromptOutput = z.infer<typeof getPromptOutputSchema>;

export interface GetPromptToolDependencies {
  repository?: PromptEmbeddingsRepository;
}

export function registerGetPromptTool(
  server: McpServer,
  dependencies: GetPromptToolDependencies = {},
): void {
  const repository = dependencies.repository ?? new PromptEmbeddingsRepository();

  const toolNames = ['prompts_get'];
  const baseConfig = {
    title: 'Retrieve full prompt content',
    description: 'Load the complete prompt file by its path, optionally including metadata.',
    inputSchema: getPromptInputSchema.shape,
    outputSchema: getPromptOutputSchema.shape,
    annotations: {
      category: 'prompts',
    },
  } as const;

  const handler = async (rawArgs: unknown) => {
      let args: GetPromptInput;

      try {
        args = getPromptInputSchema.parse(rawArgs);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Invalid parameters for prompts_get';
        return {
          content: [
            {
              type: 'text' as const,
              text: `prompts_get validation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const records = await repository.getByFilePath(args.filePath);

        if (!records.length) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No prompt content found for "${args.filePath}".`,
              },
            ],
            isError: true,
          };
        }

        const orderedChunks = records
          .map((record) => toChunk(record, args.includeMetadata))
          .sort((a, b) => a.order - b.order);

        const documentChunk = orderedChunks.find((chunk) => chunk.granularity === 'document');
        const content =
          documentChunk?.rawMarkdown ??
          orderedChunks
            .filter((chunk) => chunk.granularity === 'chunk')
            .map((chunk) => chunk.rawMarkdown)
            .join('\n\n');

        const metadata =
          args.includeMetadata && (documentChunk?.metadata ?? orderedChunks[0]?.metadata)
            ? documentChunk?.metadata ?? orderedChunks[0]?.metadata
            : undefined;

        const structured: GetPromptOutput = {
          filePath: args.filePath,
          content,
          metadata,
          chunks: orderedChunks,
        };

        const summary = buildSummary(structured);

        return {
          content: [
            {
              type: 'text' as const,
              text: summary,
            },
            {
              type: 'text' as const,
              text: content,
            },
          ],
          structuredContent: structured,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error during prompts_get';

        console.error('prompts_get failed', error);

        return {
          content: [
            {
              type: 'text' as const,
              text: `prompts_get failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    };

  for (const name of toolNames) {
    server.registerTool(
      name,
      {
        ...baseConfig,
        annotations: { ...baseConfig.annotations },
      },
      handler,
    );
  }

  console.info('[MCP] Tool registered:', toolNames.join(', '));
}

function toChunk(record: PromptEmbedding, includeMetadata: boolean) {
  return {
    chunkId: record.chunkId,
    filePath: record.filePath,
    granularity: normaliseGranularity(record.granularity),
    text: record.chunkText,
    rawMarkdown: record.rawMarkdown,
    checksum: record.checksum,
    order: deriveChunkOrder(record),
    metadata: includeMetadata ? record.metadata ?? {} : undefined,
  };
}

function deriveChunkOrder(record: PromptEmbedding): number {
  if (record.granularity === 'document') {
    return -1;
  }

  const parts = record.chunkId.split('-');
  const maybeIndex = Number(parts[parts.length - 1]);

  return Number.isFinite(maybeIndex) ? maybeIndex : Number.MAX_SAFE_INTEGER;
}

function normaliseGranularity(granularity: string): 'document' | 'chunk' {
  return granularity === 'document' ? 'document' : 'chunk';
}

function buildSummary(result: GetPromptOutput): string {
  const chunkCount = result.chunks.length;
  const metadataSummary = result.metadata
    ? summariseMetadata(result.metadata as Record<string, unknown>)
    : null;

  return metadataSummary
    ? `Loaded prompt "${result.filePath}" with ${chunkCount} chunk(s). ${metadataSummary}`
    : `Loaded prompt "${result.filePath}" with ${chunkCount} chunk(s).`;
}

function summariseMetadata(metadata: Record<string, unknown>): string | null {
  const persona = Array.isArray(metadata.persona) ? metadata.persona.join(', ') : null;
  const project = Array.isArray(metadata.project) ? metadata.project.join(', ') : null;

  const parts = [
    persona ? `Persona: ${persona}` : null,
    project ? `Project: ${project}` : null,
  ].filter(Boolean);

  if (!parts.length) {
    return null;
  }

  return parts.join(' | ');
}
