import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import {
  PromptEmbeddingsRepository,
  type PromptChunk,
  type PromptLookupFilters,
  type PromptSummary,
} from '../../db/repository';
import { normaliseSlug } from '../../utils/slug';

const promptGetArgsSchema = z.object({
  project_name: z.string().trim().min(1, 'project_name must not be empty').optional(),
  persona_name: z.string().trim().min(1, 'persona_name must not be empty').optional(),
});

const inputSchema = promptGetArgsSchema.superRefine((value, ctx) => {
  if (!value.project_name && !value.persona_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide at least project_name or persona_name.',
      fatal: true,
    });
  }
});

const promptPayloadSchema = z.object({
  promptKey: z.string(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  updatedAt: z.string().nullable(),
});

const candidateSchema = z.object({
  promptKey: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  updatedAt: z.string().nullable(),
});

const outputSchema = z.object({
  prompt: promptPayloadSchema.nullable(),
  resolution: z.object({
    project: z.string().nullable(),
    persona: z.string().nullable(),
    strategy: z.enum(['exact', 'persona_only', 'project_only']).nullable(),
    analyzedMatches: z.number(),
  }),
  candidates: z.array(candidateSchema),
});

type PromptGetInput = z.infer<typeof inputSchema>;
type PromptGetOutput = z.infer<typeof outputSchema>;

export interface PromptGetToolDependencies {
  repository?: PromptEmbeddingsRepository;
}

export function registerPromptGetTool(
  server: McpServer,
  dependencies: PromptGetToolDependencies = {},
): void {
  let repository = dependencies.repository;
  const toolName = 'prompt_get';

  server.registerTool(
    toolName,
    {
      title: 'Resolve prompt by project/persona metadata',
      description: [
        'Fetch the canonical prompt document—complete with markdown content and metadata—for a given persona or project.',
        'Pass persona_name, project_name, or both to disambiguate overlapping prompts, and receive resolution diagnostics along the way.',
        'Ideal for loading an AI Agent persona’s system prompt before answering a user.',
      ].join('\n'),
      inputSchema: promptGetArgsSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: {
        category: 'prompts',
      },
    },
    async (rawArgs: unknown) => {
      let args: PromptGetInput;

      try {
        args = inputSchema.parse(rawArgs ?? {});
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to parse prompt_get arguments.';
        return {
          content: [
            {
              type: 'text' as const,
              text: `prompt_get validation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        if (!repository) {
          repository = new PromptEmbeddingsRepository();
        }

        const result = await resolvePrompt(repository, args);

        if (!result.prompt) {
          return {
            content: [
              {
                type: 'text' as const,
                text: result.message,
              },
            ],
            structuredContent: {
              prompt: null,
              resolution: result.resolution,
              candidates: result.candidates,
            } satisfies PromptGetOutput,
            isError: true,
          };
        }

        const responseText = [
          `Prompt resolved: ${result.prompt.promptKey}`,
          formatMetadataEntry(result.prompt.metadata, 'project'),
          formatMetadataEntry(result.prompt.metadata, 'persona'),
          '',
          result.prompt.content,
        ]
          .filter(Boolean)
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: responseText,
            },
          ],
          structuredContent: {
            prompt: result.prompt,
            resolution: result.resolution,
            candidates: result.candidates,
          } satisfies PromptGetOutput,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error resolving prompt.';
        console.error('prompt_get failed', error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `prompt_get failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  console.info('[MCP] Tool registered:', toolName);
}

interface ResolutionSuccess {
  prompt: PromptGetOutput['prompt'];
  message: string;
  resolution: PromptGetOutput['resolution'];
  candidates: PromptGetOutput['candidates'];
}

interface ResolutionFailure {
  prompt: null;
  message: string;
  resolution: PromptGetOutput['resolution'];
  candidates: PromptGetOutput['candidates'];
}

async function resolvePrompt(
  repository: PromptEmbeddingsRepository,
  args: PromptGetInput,
): Promise<ResolutionSuccess | ResolutionFailure> {
  const project = normaliseSlug(args.project_name);
  const persona = normaliseSlug(args.persona_name);

  const filters: PromptLookupFilters = {};
  if (project) {
    filters.project = project;
  }
  if (persona) {
    filters.persona = persona;
  }

  const candidates = await repository.listPrompts(filters);

  if (project && persona) {
    const matches = candidates.filter((candidate) =>
      matchesProjectAndPersona(candidate, project, persona),
    );
    if (matches.length === 0) {
      return buildFailure(
        `No prompt found for project "${project}" with persona "${persona}".`,
        candidates,
        project,
        persona,
        'exact',
      );
    }

    if (matches.length > 1) {
      return buildFailure(
        `Multiple prompts match project "${project}" and persona "${persona}". Specify additional metadata to disambiguate.`,
        matches,
        project,
        persona,
        'exact',
      );
    }

    const prompt = await buildPromptPayload(repository, matches[0]);
    if (!prompt) {
      return buildFailure(
        `Prompt "${matches[0].promptKey}" is missing document content.`,
        matches,
        project,
        persona,
        'exact',
      );
    }

    return {
      prompt,
      message: `Prompt resolved for project "${project}" and persona "${persona}".`,
      resolution: buildResolution(project, persona, 'exact', candidates.length),
      candidates: toCandidateSummaries(candidates),
    };
  }

  if (persona) {
    const personaOnly = candidates.filter(
      (candidate) => matchesPersona(candidate, persona) && !hasProjectMetadata(candidate.metadata),
    );

    if (personaOnly.length === 0) {
      return buildFailure(
        `No persona-only prompt found for persona "${persona}". Provide project_name to target a project-specific prompt.`,
        candidates,
        null,
        persona,
        'persona_only',
      );
    }

    if (personaOnly.length > 1) {
      return buildFailure(
        `Multiple persona-only prompts found for persona "${persona}". Provide project_name to disambiguate.`,
        personaOnly,
        null,
        persona,
        'persona_only',
      );
    }

    const prompt = await buildPromptPayload(repository, personaOnly[0]);
    if (!prompt) {
      return buildFailure(
        `Prompt "${personaOnly[0].promptKey}" is missing document content.`,
        personaOnly,
        null,
        persona,
        'persona_only',
      );
    }

    return {
      prompt,
      message: `Prompt resolved for persona "${persona}".`,
      resolution: buildResolution(null, persona, 'persona_only', candidates.length),
      candidates: toCandidateSummaries(candidates),
    };
  }

  if (project) {
    const projectOnly = candidates.filter(
      (candidate) => matchesProject(candidate, project) && !hasPersonaMetadata(candidate.metadata),
    );

    if (projectOnly.length === 0) {
      return buildFailure(
        `No project-only prompt found for project "${project}". Provide persona_name to target a persona-specific prompt.`,
        candidates,
        project,
        null,
        'project_only',
      );
    }

    if (projectOnly.length > 1) {
      return buildFailure(
        `Multiple project-only prompts found for project "${project}". Provide persona_name to disambiguate.`,
        projectOnly,
        project,
        null,
        'project_only',
      );
    }

    const prompt = await buildPromptPayload(repository, projectOnly[0]);
    if (!prompt) {
      return buildFailure(
        `Prompt "${projectOnly[0].promptKey}" is missing document content.`,
        projectOnly,
        project,
        null,
        'project_only',
      );
    }

    return {
      prompt,
      message: `Prompt resolved for project "${project}".`,
      resolution: buildResolution(project, null, 'project_only', candidates.length),
      candidates: toCandidateSummaries(candidates),
    };
  }

  // This branch should be unreachable because validation prevents empty input.
  return buildFailure(
    'Unable to resolve prompt: no valid selector provided.',
    candidates,
    project,
    persona,
    null,
  );
}

async function buildPromptPayload(repository: PromptEmbeddingsRepository, summary: PromptSummary) {
  const chunks = await repository.getChunksByPromptKey(summary.promptKey);
  const documentChunk = selectDocumentChunk(chunks);
  const content = documentChunk?.rawSource ?? joinChunkTexts(chunks);

  if (!content) {
    return null;
  }

  return {
    promptKey: summary.promptKey,
    content,
    metadata: (summary.metadata ?? {}) as Record<string, unknown>,
    updatedAt: summary.updatedAt,
  };
}

function selectDocumentChunk(chunks: PromptChunk[]): PromptChunk | undefined {
  return chunks.find((chunk) => chunk.granularity === 'document');
}

function joinChunkTexts(chunks: PromptChunk[]): string | null {
  if (!chunks.length) {
    return null;
  }

  const parts = chunks
    .filter((chunk) => Boolean(chunk.chunkText))
    .sort((a, b) => a.chunkId.localeCompare(b.chunkId))
    .map((chunk) => chunk.chunkText);

  return parts.length > 0 ? parts.join('\n') : null;
}

function matchesProjectAndPersona(candidate: PromptSummary, project: string, persona: string) {
  return matchesProject(candidate, project) && matchesPersona(candidate, persona);
}

function matchesProject(candidate: PromptSummary, project: string) {
  return getMetadataArray(candidate.metadata, 'project').includes(project);
}

function matchesPersona(candidate: PromptSummary, persona: string) {
  return getMetadataArray(candidate.metadata, 'persona').includes(persona);
}

function hasProjectMetadata(metadata: PromptSummary['metadata']) {
  return getMetadataArray(metadata, 'project').length > 0;
}

function hasPersonaMetadata(metadata: PromptSummary['metadata']) {
  return getMetadataArray(metadata, 'persona').length > 0;
}

function formatMetadataEntry(
  metadata: Record<string, unknown>,
  key: 'project' | 'persona',
): string | null {
  const values = getMetadataArray(metadata, key);
  if (values.length === 0) {
    return null;
  }

  return `${key}=${values.join(',')}`;
}

function getMetadataArray(
  metadata: Record<string, unknown> | undefined,
  key: 'project' | 'persona',
): string[] {
  if (!metadata) {
    return [];
  }

  const value = metadata[key];

  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.toLowerCase() : null))
      .filter((item): item is string => Boolean(item));
  }

  if (typeof value === 'string') {
    return [value.toLowerCase()];
  }

  return [];
}

function buildFailure(
  message: string,
  candidates: PromptSummary[],
  project: string | null,
  persona: string | null,
  strategy: PromptGetOutput['resolution']['strategy'],
): ResolutionFailure {
  return {
    prompt: null,
    message,
    resolution: buildResolution(project, persona, strategy, candidates.length),
    candidates: toCandidateSummaries(candidates),
  };
}

function buildResolution(
  project: string | null,
  persona: string | null,
  strategy: PromptGetOutput['resolution']['strategy'],
  analyzedMatches: number,
): PromptGetOutput['resolution'] {
  return {
    project,
    persona,
    strategy,
    analyzedMatches,
  };
}

function toCandidateSummaries(candidates: PromptSummary[]): PromptGetOutput['candidates'] {
  return candidates.map((candidate) => ({
    promptKey: candidate.promptKey,
    metadata: (candidate.metadata ?? {}) as Record<string, unknown>,
    updatedAt: candidate.updatedAt,
  }));
}

export { resolvePrompt };
