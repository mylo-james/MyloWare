import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PromptEmbeddingsRepository, type SearchResult } from '../../db/repository';
import { embedTexts } from '../../ingestion/embedder';

const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_SIMILARITY = 0.25;
const SUMMARY_PREVIEW_COUNT = 3;
const SNIPPET_LENGTH = 160;

const preprocessToString = (value: unknown) => {
  if (value === undefined || value === null) {
    return value;
  }

  return typeof value === 'string' ? value : String(value);
};

const requiredString = (description: string, message: string) =>
  z
    .preprocess(preprocessToString, z.string().trim().min(1, message))
    .describe(description);

const optionalString = (description: string) =>
  z
    .preprocess(preprocessToString, z.string().trim().min(1))
    .optional()
    .describe(description);

const optionalNumericString = (description: string) =>
  z
    .preprocess(preprocessToString, z.string().trim())
    .optional()
    .describe(description);

export const searchPromptsInputSchema = z.object({
  query: requiredString('Search text to embed and match against prompt chunks.', 'query is required'),
  persona: optionalString('Optional persona tag filter.'),
  project: optionalString('Optional project tag filter.'),
  limit: optionalNumericString('Maximum number of chunks to return (1-50, defaults to 5).'),
  minSimilarity: optionalNumericString('Minimum cosine similarity between 0 and 1 (defaults to 0.25).'),
});

export const searchPromptsOutputSchema = z.object({
  results: z.array(
    z.object({
      chunkId: z.string(),
      filePath: z.string(),
      text: z.string(),
      similarity: z.number(),
      metadata: z.record(z.unknown()),
    }),
  ),
  count: z.number().int().nonnegative(),
});

type RawSearchPromptsInput = z.infer<typeof searchPromptsInputSchema>;

interface SearchPromptsInput {
  query: string;
  persona?: string;
  project?: string;
  limit: number;
  minSimilarity: number;
}

type SearchPromptsOutput = z.infer<typeof searchPromptsOutputSchema>;

export interface SearchPromptsToolDependencies {
  repository?: PromptEmbeddingsRepository;
  embed?: (texts: string[]) => Promise<number[][]>;
}

export function registerSearchPromptsTool(
  server: McpServer,
  dependencies: SearchPromptsToolDependencies = {},
): void {
  const repository = dependencies.repository ?? new PromptEmbeddingsRepository();
  const embed = dependencies.embed ?? ((texts: string[]) => embedTexts(texts));

  const toolNames = ['prompts_search'];
  const baseConfig = {
    title: 'Semantic prompt search',
    description: 'Search prompt embeddings with optional persona and project filters.',
    inputSchema: searchPromptsInputSchema.shape,
    outputSchema: searchPromptsOutputSchema.shape,
    annotations: {
      category: 'prompts',
    },
  } as const;

  const handler = async (rawArgs: unknown) => {
      let args: SearchPromptsInput;

      try {
        const parsed = searchPromptsInputSchema.parse(rawArgs ?? {});
        args = normaliseInput(parsed);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Invalid parameters for prompts_search';
        return {
          content: [
            {
              type: 'text' as const,
              text: `prompts_search validation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const [embedding] = await embed([args.query]);

        if (!embedding) {
          throw new Error('Embedding generation returned no vector for the query.');
        }

        const searchResults = await repository.search({
          embedding,
          limit: args.limit,
          minSimilarity: args.minSimilarity,
          persona: args.persona,
          project: args.project,
        });

        const formattedResults = formatResults(searchResults);
        const summary = buildSummary(args, formattedResults);
        const preview = buildPreview(formattedResults);

        const structured: SearchPromptsOutput = {
          results: formattedResults,
          count: formattedResults.length,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: summary,
            },
            ...(preview ? [{ type: 'text' as const, text: preview }] : []),
          ],
          structuredContent: structured,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error during prompts_search';

        console.error('prompts_search failed', error);

        return {
          content: [
            {
              type: 'text' as const,
              text: `prompts_search failed: ${message}`,
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

function formatResults(results: SearchResult[]): SearchPromptsOutput['results'] {
  return results.map((result) => ({
    chunkId: result.chunkId,
    filePath: result.filePath,
    text: result.chunkText,
    similarity: Number(result.similarity),
    metadata: (result.metadata ?? {}) as Record<string, unknown>,
  }));
}

function buildSummary(args: SearchPromptsInput, results: SearchPromptsOutput['results']): string {
  const filters: string[] = [];

  if (args.persona) {
    filters.push(`persona="${args.persona}"`);
  }

  if (args.project) {
    filters.push(`project="${args.project}"`);
  }

  const filterText = filters.length ? ` with ${filters.join(' and ')}` : '';
  const suffix = ` (limit=${args.limit}, minSimilarity=${args.minSimilarity.toFixed(2)})`;

  return results.length === 0
    ? `No prompt chunks matched "${args.query}"${filterText}${suffix}.`
    : `Found ${results.length} prompt chunk(s) matching "${args.query}"${filterText}${suffix}.`;
}

function buildPreview(results: SearchPromptsOutput['results']): string | null {
  if (results.length === 0) {
    return null;
  }

  const lines = results.slice(0, SUMMARY_PREVIEW_COUNT).map((result, index) => {
    const snippet = createSnippet(result.text);
    return `${index + 1}. ${result.filePath} (similarity ${result.similarity.toFixed(3)}): ${snippet}`;
  });

  return `Top matches:\n${lines.join('\n')}`;
}

function createSnippet(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (normalized.length <= SNIPPET_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…`;
}

function normaliseInput(raw: RawSearchPromptsInput): SearchPromptsInput {
  return {
    query: raw.query.trim(),
    persona: normaliseOptionalString(raw.persona),
    project: normaliseOptionalString(raw.project),
    limit: parseLimit(raw.limit),
    minSimilarity: parseMinSimilarity(raw.minSimilarity),
  };
}

function normaliseOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parseLimit(value?: string): number {
  if (!value || value.trim().length === 0) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number.parseInt(value.trim(), 10);

  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 50) {
    throw new Error('limit must be an integer between 1 and 50.');
  }

  return parsed;
}

function parseMinSimilarity(value?: string): number {
  if (!value || value.trim().length === 0) {
    return DEFAULT_MIN_SIMILARITY;
  }

  const parsed = Number.parseFloat(value.trim());

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('minSimilarity must be a number between 0 and 1.');
  }

  return parsed;
}
