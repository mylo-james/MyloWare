import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  PromptEmbeddingsRepository,
  type FilterChunksParameters,
  type FilteredChunk,
} from '../../db/repository';

const promptTypeEnum = z.enum(['persona', 'project', 'combination']);
const granularityEnum = z.enum(['document', 'chunk']);

export const filterPromptsInputSchema = z.object({
  type: promptTypeEnum.optional(),
  persona: z.string().trim().min(1).optional(),
  project: z.string().trim().min(1).optional(),
  granularity: granularityEnum.optional(),
  limit: z.number().int().positive().max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const filteredChunkSchema = z.object({
  chunkId: z.string(),
  filePath: z.string(),
  granularity: granularityEnum,
  text: z.string(),
  rawMarkdown: z.string(),
  metadata: z.record(z.unknown()),
  checksum: z.string(),
});

export const filterPromptsOutputSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  chunks: z.array(filteredChunkSchema),
});

type FilterPromptsInput = z.infer<typeof filterPromptsInputSchema>;
type FilterPromptsOutput = z.infer<typeof filterPromptsOutputSchema>;

export interface FilterPromptsToolDependencies {
  repository?: PromptEmbeddingsRepository;
}

export function registerFilterPromptsTool(
  server: McpServer,
  dependencies: FilterPromptsToolDependencies = {},
): void {
  const repository = dependencies.repository ?? new PromptEmbeddingsRepository();

  const toolNames = ['prompts_filter'];
  const baseConfig = {
    title: 'Filter prompt chunks',
    description:
      'Filter prompt chunks by metadata without semantic search, with optional pagination.',
    inputSchema: filterPromptsInputSchema.shape,
    outputSchema: filterPromptsOutputSchema.shape,
    annotations: {
      category: 'prompts',
    },
  } as const;

  const handler = async (rawArgs: unknown) => {
      let args: FilterPromptsInput;

      try {
        args = filterPromptsInputSchema.parse(rawArgs ?? {});
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Invalid parameters for prompts_filter';

        return {
          content: [
            {
              type: 'text' as const,
              text: `prompts_filter validation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const { total, chunks } = await repository.filterChunks(normaliseFilters(args));

        const formattedChunks = chunks.map((chunk) => toFilteredChunk(chunk));

        const structured: FilterPromptsOutput = {
          total,
          limit: args.limit,
          offset: args.offset,
          chunks: formattedChunks,
        };

        const summaryText = buildSummaryText(args, total);
        const previewText = formattedChunks.length
          ? buildPreviewText(formattedChunks)
          : 'No chunks matched the provided filters.';

        return {
          content: [
            { type: 'text' as const, text: summaryText },
            { type: 'text' as const, text: previewText },
          ],
          structuredContent: structured,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error during prompts_filter';
        console.error('prompts_filter failed', error);

        return {
          content: [
            {
              type: 'text' as const,
              text: `prompts_filter failed: ${message}`,
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

function normaliseFilters(args: FilterPromptsInput): FilterChunksParameters {
  return {
    type: args.type,
    persona: args.persona?.toLowerCase(),
    project: args.project?.toLowerCase(),
    granularity: args.granularity,
    limit: args.limit,
    offset: args.offset,
  };
}

function toFilteredChunk(chunk: FilteredChunk) {
  return {
    chunkId: chunk.chunkId,
    filePath: chunk.filePath,
    granularity: (chunk.granularity === 'document' ? 'document' : 'chunk') as 'document' | 'chunk',
    text: chunk.chunkText,
    rawMarkdown: chunk.rawMarkdown,
    metadata: (chunk.metadata ?? {}) as Record<string, unknown>,
    checksum: chunk.checksum,
  };
}

function buildSummaryText(args: FilterPromptsInput, total: number): string {
  const filters: string[] = [];

  if (args.type) filters.push(`type="${args.type}"`);
  if (args.persona) filters.push(`persona="${args.persona}"`);
  if (args.project) filters.push(`project="${args.project}"`);
  if (args.granularity) filters.push(`granularity="${args.granularity}"`);

  const filterText = filters.length ? ` with ${filters.join(' and ')}` : '';
  const paginationText =
    total > 0
      ? `Total ${total} chunk(s); offset=${args.offset}; limit=${args.limit}`
      : 'No matching chunks found';

  return `${paginationText}${filterText}.`;
}

function buildPreviewText(chunks: ReturnType<typeof toFilteredChunk>[]): string {
  const lines = chunks.slice(0, 10).map((chunk) => {
    const snippet = createSnippet(chunk.text);
    return `${chunk.filePath} [${chunk.granularity}] ${snippet}`;
  });

  return `Sample results:\n${lines.join('\n')}`;
}

function createSnippet(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 140) {
    return normalized;
  }
  return `${normalized.slice(0, 139).trimEnd()}…`;
}
