import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { embedTexts } from '../../vector/embedTexts';
import {
  PromptEmbeddingsRepository,
  type SearchParameters,
  type SearchResult,
} from '../../db/repository';

const inputSchema = z
  .object({
    query: z.string().trim().min(1, 'query must not be empty'),
    persona: z.string().trim().optional(),
    project: z.string().trim().optional(),
    limit: z.number().int().positive().max(50).optional(),
    minSimilarity: z.number().min(0).max(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.query) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'query is required',
        fatal: true,
      });
    }
  });

const outputSchema = z.object({
  matches: z.array(
    z.object({
      chunkId: z.string(),
      promptKey: z.string(),
      similarity: z.number(),
      metadata: z.record(z.string(), z.unknown()),
      preview: z.string(),
    }),
  ),
  appliedFilters: z.object({
    persona: z.string().nullable(),
    project: z.string().nullable(),
    limit: z.number(),
    minSimilarity: z.number(),
  }),
});

type PromptSearchInput = z.infer<typeof inputSchema>;
type PromptSearchOutput = z.infer<typeof outputSchema>;

export interface PromptSearchToolDependencies {
  repository?: PromptEmbeddingsRepository;
  embed?: typeof embedTexts;
}

export async function searchPrompts(
  repository: PromptEmbeddingsRepository,
  embed: typeof embedTexts,
  args: PromptSearchInput,
): Promise<PromptSearchOutput> {
  const searchParams = buildSearchParameters(args);
  const [embedding] = await embed([args.query]);
  const matches = await repository.search({
    ...searchParams,
    embedding,
  });

  const filteredMatches = matches.filter((match) => match.similarity >= searchParams.minSimilarity);

  return {
    matches: filteredMatches.map(serializeMatch),
    appliedFilters: {
      persona: searchParams.persona ?? null,
      project: searchParams.project ?? null,
      limit: searchParams.limit,
      minSimilarity: searchParams.minSimilarity,
    },
  };
}

export function registerPromptSearchTool(
  server: McpServer,
  dependencies: PromptSearchToolDependencies = {},
): void {
  let repository = dependencies.repository;
  const embed = dependencies.embed ?? embedTexts;
  const toolName = 'prompt_search';

  server.registerTool(
    toolName,
    {
      title: 'Search prompt corpus semantically',
      description:
        'Performs semantic search across prompts with optional persona/project filters. Returns ranked chunks with similarity scores.',
      inputSchema: inputSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: {
        category: 'prompts',
      },
    },
    async (rawArgs) => {
      let args: PromptSearchInput;

      try {
        args = inputSchema.parse(rawArgs ?? {});
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to parse prompt_search arguments.';
        return {
          content: [
            {
              type: 'text' as const,
              text: `prompt_search validation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        if (!repository) {
          repository = new PromptEmbeddingsRepository();
        }

        const result = await searchPrompts(repository, embed, args);

        const responseText =
          result.matches.length === 0
            ? `No matches found for "${args.query}".`
            : `Found ${result.matches.length} match${
                result.matches.length === 1 ? '' : 'es'
              } for "${args.query}". Top hit: ${result.matches[0].promptKey} (${result.matches[0].similarity.toFixed(
                3,
              )}).`;

        return {
          content: [
            {
              type: 'text' as const,
              text: responseText,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error during semantic search.';
        console.error('prompt_search failed', error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `prompt_search failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  console.info('[MCP] Tool registered:', toolName);
}

function buildSearchParameters(args: PromptSearchInput): Omit<SearchParameters, 'embedding'> {
  const limit = clamp(args.limit ?? 10, 1, 50);
  const minSimilarity = clamp(args.minSimilarity ?? 0.3, 0, 1);

  return {
    limit,
    minSimilarity,
    persona: normalise(args.persona),
    project: normalise(args.project),
  };
}

function serializeMatch(match: SearchResult) {
  return {
    chunkId: match.chunkId,
    promptKey: match.promptKey,
    similarity: Number(match.similarity),
    metadata: match.metadata ?? {},
    preview: buildPreview(match.chunkText),
  };
}

function buildPreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177)}...`;
}

function normalise(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
