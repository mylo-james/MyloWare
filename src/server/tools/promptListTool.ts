import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import {
  PromptEmbeddingsRepository,
  type PromptLookupFilters,
  type PromptSummary,
} from '../../db/repository';
import { normaliseSlugOptional } from '../../utils/slug';
import { extractToolArgs } from './argUtils';

const PROMPT_LIST_ARG_KEYS = ['persona', 'project', 'type'] as const;

const promptListArgsSchema = z.object({
  persona: z.string().trim().optional(),
  project: z.string().trim().optional(),
  type: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || ['persona', 'project', 'combination'].includes(value.toLowerCase()),
      {
        message: 'type must be one of persona, project, or combination',
      },
    ),
});

const inputSchema = promptListArgsSchema;

const outputSchema = z.object({
  prompts: z.array(
    z.object({
      promptKey: z.string(),
      metadata: z.record(z.string(), z.unknown()),
      chunkCount: z.number(),
      updatedAt: z.string().nullable(),
    }),
  ),
  appliedFilters: z.object({
    persona: z.string().nullable(),
    project: z.string().nullable(),
    type: z.string().nullable(),
  }),
});

type PromptListInput = z.infer<typeof inputSchema>;
type PromptListOutput = z.infer<typeof outputSchema>;

export interface PromptListToolDependencies {
  repository?: PromptEmbeddingsRepository;
}

export function registerPromptListTool(
  server: McpServer,
  dependencies: PromptListToolDependencies = {},
): void {
  let repository = dependencies.repository;
  const toolName = 'prompt_list';

  server.registerTool(
    toolName,
    {
      title: 'List available prompts',
      description: [
        'Build a bird\'s-eye map of the prompt library with rich metadata in one call.',
        'Filter by persona, project, or combination type to see exactly what content exists and when it was last updated.',
        'Perfect for loading every project slug before a conversation or auditing coverage across personas.',
        '',
        '## When to Use prompt_list',
        'Use for:',
        '- Discovery: What prompts are available?',
        '- Validation: Does a persona/project exist?',
        '- Debugging: Why did prompt_get fail?',
        '',
        'Returns summary list (not full content) - use prompt_get to load full prompt.',
        '',
        '## Filters',
        'persona: Filter by persona (e.g., "screenwriter")',
        'project: Filter by project (e.g., "aismr")',
        'memoryType: Filter by type (persona, project, semantic, etc.)',
        '',
        'Combine filters to narrow results.',
      ].join('\n'),
      inputSchema: promptListArgsSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: {
        category: 'prompts',
      },
    },
    async (rawArgs: unknown) => {
      let args: PromptListInput;

      try {
        const extracted = extractToolArgs(rawArgs, {
          allowedKeys: PROMPT_LIST_ARG_KEYS,
        });
        args = inputSchema.parse(extracted);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to parse prompt_list arguments.';
        return {
          content: [
            {
              type: 'text' as const,
              text: `prompt_list validation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        if (!repository) {
          repository = new PromptEmbeddingsRepository();
        }

        const result = await listPrompts(repository, args);
        const responseText =
          result.prompts.length === 0
            ? 'No prompts match the supplied filters.'
            : `Found ${result.prompts.length} prompt${
                result.prompts.length === 1 ? '' : 's'
              }. Example: ${result.prompts[0].promptKey}`;

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
          error instanceof Error ? error.message : 'Unexpected error listing prompts.';
        console.error('prompt_list failed', error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `prompt_list failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  console.info('[MCP] Tool registered:', toolName);
}

export async function listPrompts(
  repository: PromptEmbeddingsRepository,
  args: PromptListInput,
): Promise<PromptListOutput> {
  const filters = buildFilters(args);
  const prompts = await repository.listPrompts(filters);

  return {
    prompts: prompts.map(serializeSummary),
    appliedFilters: {
      persona: filters.persona ?? null,
      project: filters.project ?? null,
      type: filters.type ?? null,
    },
  };
}

function buildFilters(args: PromptListInput): PromptLookupFilters {
  const filters: PromptLookupFilters = {};

  const persona = normaliseSlugOptional(args.persona);
  if (persona) {
    filters.persona = persona;
  }

  const project = normaliseSlugOptional(args.project);
  if (project) {
    filters.project = project;
  }

  const type = normaliseSlugOptional(args.type);
  if (type) {
    filters.type = type;
  }

  return filters;
}

function serializeSummary(summary: PromptSummary) {
  return {
    promptKey: summary.promptKey,
    metadata: (summary.metadata ?? {}) as Record<string, unknown>,
    chunkCount: summary.chunkCount,
    updatedAt: summary.updatedAt,
  };
}
