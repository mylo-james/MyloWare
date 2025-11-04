import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import {
  PromptEmbeddingsRepository,
  type PromptChunk,
  type PromptLookupFilters,
  type PromptSummary,
} from '../../db/repository';
import { normaliseSlug } from '../../utils/slug';
import { extractToolArgs } from './argUtils';

const PROMPT_GET_ARG_KEYS = ['project_name', 'persona_name', 'tags', 'tag'] as const;

// n8n-compatible: accept string (will be split on comma) or array
const promptGetArgsSchema = z.object({
  project_name: z.string().trim().optional(),
  persona_name: z.string().trim().optional(),
  tags: z.string().trim().optional(), // Comma-separated tags or single tag
  tag: z.string().trim().optional(),  // Legacy: comma-separated tags or single tag
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
    tags: z.array(z.string()).nullable(),
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
        'Ideal for loading an AI Agent persona\'s system prompt before answering a user.',
        '',
        '## When to Use prompt_get',
        'Use ONLY when you know exact identifiers:',
        '- persona_name AND project_name for combinations',
        '- persona_name OR project_name for individual prompts',
        '',
        'This is EXACT MATCH lookup - if identifiers uncertain, use prompt_search instead.',
        '',
        '## Common Patterns',
        '1. Load combination: {persona_name: "screenwriter", project_name: "aismr"}',
        '2. Load persona: {persona_name: "ideagenerator"}',
        '3. Load project: {project_name: "aismr"}',
        '',
        '## If prompt_get fails:',
        '1. Use prompt_list to see available prompts',
        '2. Use prompt_search to find by description/content',
        '3. Retry prompt_get with correct identifier',
        '',
        '## Resolution Strategy',
        'The tool resolves prompts in this priority order:',
        '1. BOTH parameters → COMBINATION prompt (complete workflow with persona + project)',
        '2. persona only → GENERIC persona (persona behavior without project-specific workflow)',
        '3. project only → PROJECT specs (project configuration without persona behavior)',
        '',
        'For task execution with project context, ALWAYS provide both parameters to get the complete workflow.',
        '',
        '## Examples',
        '- Complete workflow: persona_name="ideagenerator", project_name="aismr" → loads ideagenerator-aismr.json',
        '- Generic persona: persona_name="chat" → loads persona-chat.json',
        '- Project only: project_name="aismr" → loads project-aismr.json (specs only)',
      ].join('\n'),
      inputSchema: promptGetArgsSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: {
        category: 'prompts',
      },
    },
    async (rawArgs: unknown) => {
      let args: PromptGetInput;
      let normalizedTags: string[] | undefined;

      try {
        const extracted = extractToolArgs(rawArgs, {
          allowedKeys: PROMPT_GET_ARG_KEYS,
        });
        
        // Normalize tags: handle string (comma-separated), array, or undefined
        const rawTags = extracted.tags;
        const rawTag = extracted.tag;
        
        if (rawTags || rawTag) {
          const tagList: string[] = [];
          
          if (rawTags) {
            if (typeof rawTags === 'string') {
              tagList.push(...rawTags.split(',').map(t => t.trim()).filter(Boolean));
            } else if (Array.isArray(rawTags)) {
              tagList.push(...rawTags.map(t => String(t).trim()).filter(Boolean));
            }
          }
          
          if (rawTag) {
            if (typeof rawTag === 'string') {
              tagList.push(...rawTag.split(',').map(t => t.trim()).filter(Boolean));
            } else if (Array.isArray(rawTag)) {
              tagList.push(...rawTag.map(t => String(t).trim()).filter(Boolean));
            }
          }
          
          normalizedTags = tagList.length > 0 ? tagList : undefined;
        }
        
        // Parse with normalized data for schema validation
        const parseInput = {
          project_name: extracted.project_name,
          persona_name: extracted.persona_name,
          tags: extracted.tags,
          tag: extracted.tag,
        };
        
        args = inputSchema.parse(parseInput);
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

        // Convert MCP args (strings) to internal format (arrays)
        const resolveArgs: ResolvePromptArgs = {
          project_name: args.project_name,
          persona_name: args.persona_name,
          tags: normalizedTags,
        };

        const result = await resolvePrompt(repository, resolveArgs);

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

// Internal function accepts array for direct usage
interface ResolvePromptArgs {
  project_name?: string;
  persona_name?: string;
  tags?: string[];
}

async function resolvePrompt(
  repository: PromptEmbeddingsRepository,
  args: ResolvePromptArgs,
): Promise<ResolutionSuccess | ResolutionFailure> {
  const project = normaliseSlug(args.project_name);
  const persona = normaliseSlug(args.persona_name);
  const tags = args.tags ?? [];

  const filters: PromptLookupFilters = {};
  if (project) {
    filters.project = project;
  }
  if (persona) {
    filters.persona = persona;
  }
  if (tags.length > 0) {
    filters.tags = tags;
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
        tags,
      );
    }

    if (matches.length > 1) {
      return buildFailure(
        `Multiple prompts match project "${project}" and persona "${persona}". Specify additional metadata such as tags to disambiguate.`,
        matches,
        project,
        persona,
        'exact',
        tags,
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
        tags,
      );
    }

    return {
      prompt,
      message: `Prompt resolved for project "${project}" and persona "${persona}".`,
      resolution: buildResolution(project, persona, 'exact', candidates.length, tags),
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
        tags,
      );
    }

    if (personaOnly.length > 1) {
      return buildFailure(
        `Multiple persona-only prompts found for persona "${persona}". Provide project_name to disambiguate.`,
        personaOnly,
        null,
        persona,
        'persona_only',
        tags,
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
        tags,
      );
    }

    return {
      prompt,
      message: `Prompt resolved for persona "${persona}".`,
      resolution: buildResolution(null, persona, 'persona_only', candidates.length, tags),
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
        tags,
      );
    }

    if (projectOnly.length > 1) {
      return buildFailure(
        `Multiple project-only prompts found for project "${project}". Provide persona_name to disambiguate.`,
        projectOnly,
        project,
        null,
        'project_only',
        tags,
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
        tags,
      );
    }

    return {
      prompt,
      message: `Prompt resolved for project "${project}".`,
      resolution: buildResolution(project, null, 'project_only', candidates.length, tags),
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
    tags,
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

// Helper: normalize string/array tags to slug array (removed, no longer used)

function buildFailure(
  message: string,
  candidates: PromptSummary[],
  project: string | null,
  persona: string | null,
  strategy: PromptGetOutput['resolution']['strategy'],
  tags: string[] | undefined,
): ResolutionFailure {
  return {
    prompt: null,
    message,
    resolution: buildResolution(project, persona, strategy, candidates.length, tags),
    candidates: toCandidateSummaries(candidates),
  };
}

function buildResolution(
  project: string | null,
  persona: string | null,
  strategy: PromptGetOutput['resolution']['strategy'],
  analyzedMatches: number,
  tags: string[] | undefined,
): PromptGetOutput['resolution'] {
  return {
    project,
    persona,
    strategy,
    analyzedMatches,
    tags: tags && tags.length > 0 ? tags : null,
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
