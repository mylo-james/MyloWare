import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  PromptEmbeddingsRepository,
  type PromptSummary,
  type ListPromptsParameters,
} from '../../db/repository';

const promptTypeEnum = z.enum(['persona', 'project', 'combination']);

export const listPromptsInputSchema = z.object({
  type: promptTypeEnum.optional(),
  persona: z.string().trim().min(1).optional(),
  project: z.string().trim().min(1).optional(),
});

const promptSummarySchema = z.object({
  filePath: z.string(),
  type: promptTypeEnum,
  persona: z.array(z.string()),
  project: z.array(z.string()),
  chunkCount: z.number().int().nonnegative(),
});

export const listPromptsOutputSchema = z.object({
  prompts: z.array(promptSummarySchema),
  total: z.number().int().nonnegative(),
});

type ListPromptsInput = z.infer<typeof listPromptsInputSchema>;
type ListPromptsOutput = z.infer<typeof listPromptsOutputSchema>;

export interface ListPromptsToolDependencies {
  repository?: PromptEmbeddingsRepository;
}

export function registerListPromptsTool(
  server: McpServer,
  dependencies: ListPromptsToolDependencies = {},
): void {
  const repository = dependencies.repository ?? new PromptEmbeddingsRepository();

  const toolNames = ['prompts_list'];
  const baseConfig = {
    title: 'List prompts',
    description: 'List prompt files with persona/project/type metadata.',
    inputSchema: listPromptsInputSchema.shape,
    outputSchema: listPromptsOutputSchema.shape,
    annotations: {
      category: 'prompts',
    },
  } as const;

  const handler = async (rawArgs: unknown) => {
      let args: ListPromptsInput;

      try {
        args = listPromptsInputSchema.parse(rawArgs ?? {});
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Invalid parameters for prompts_list';
        return {
          content: [
            {
              type: 'text' as const,
              text: `prompts_list validation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const summaries = await repository.listPrompts(normaliseFilters(args));
        const prompts = summaries
          .map((summary) => toPromptSummary(summary))
          .filter((summary) => summary !== null);

        const structured: ListPromptsOutput = {
          prompts,
          total: prompts.length,
        };

        const summaryText = buildSummaryText(args, structured.total);

        if (structured.total === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: summaryText,
              },
            ],
            structuredContent: structured,
          };
        }

        const lines = prompts
          .slice(0, 10)
          .map((prompt) => formatPromptLine(prompt))
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: summaryText,
            },
            {
              type: 'text' as const,
              text: `First ${Math.min(prompts.length, 10)} result(s):\n${lines}`,
            },
          ],
          structuredContent: structured,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error during prompts_list';
        console.error('prompts_list failed', error);

        return {
          content: [
            {
              type: 'text' as const,
              text: `prompts_list failed: ${message}`,
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

function normaliseFilters(args: ListPromptsInput): ListPromptsParameters {
  return {
    type: args.type,
    persona: args.persona?.toLowerCase(),
    project: args.project?.toLowerCase(),
  };
}

function toPromptSummary(summary: PromptSummary) {
  const metadata = summary.metadata ?? {};
  const type = typeof metadata.type === 'string' ? metadata.type.toLowerCase() : null;
  const persona = Array.isArray(metadata.persona)
    ? metadata.persona.map((value: unknown) => String(value))
    : [];
  const project = Array.isArray(metadata.project)
    ? metadata.project.map((value: unknown) => String(value))
    : [];

  if (!type || !promptTypeEnum.safeParse(type).success) {
    return null;
  }

  return {
    filePath: summary.filePath,
    type: type as z.infer<typeof promptTypeEnum>,
    persona,
    project,
    chunkCount: summary.chunkCount,
  };
}

function formatPromptLine(prompt: ListPromptsOutput['prompts'][number]): string {
  const personaText = prompt.persona.length ? `persona=${prompt.persona.join(', ')}` : 'persona=-';
  const projectText = prompt.project.length ? `project=${prompt.project.join(', ')}` : 'project=-';

  return `${prompt.filePath} [type=${prompt.type}; ${personaText}; ${projectText}; chunks=${prompt.chunkCount}]`;
}

function buildSummaryText(args: ListPromptsInput, total: number): string {
  const filters: string[] = [];

  if (args.type) {
    filters.push(`type="${args.type}"`);
  }

  if (args.persona) {
    filters.push(`persona="${args.persona}"`);
  }

  if (args.project) {
    filters.push(`project="${args.project}"`);
  }

  const filterText = filters.length ? ` with ${filters.join(' and ')}` : '';
  return total === 0
    ? `No prompts found${filterText}.`
    : `Found ${total} prompt(s)${filterText}.`;
}
