import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../../config';
import { OperationsRepository, type Run } from '../../db/operations';

const inputSchema = z.object({
  runId: z.string().trim().min(1, 'runId is required'),
});

const outputSchema = z.object({
  run: z
    .object({
      id: z.string(),
      projectId: z.string(),
      personaId: z.string().nullable(),
      chatId: z.string().nullable(),
      status: z.string(),
      result: z.string().nullable(),
      input: z.unknown(),
      metadata: z.unknown(),
      startedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
      createdAt: z.string().nullable(),
      updatedAt: z.string().nullable(),
    })
    .nullable(),
});

type GetRunInput = z.infer<typeof inputSchema>;
type GetRunOutput = z.infer<typeof outputSchema>;

export interface GetRunToolDependencies {
  repository?: OperationsRepository;
}

export function registerGetRunTool(
  server: McpServer,
  dependencies: GetRunToolDependencies = {},
): void {
  let repository = dependencies.repository;

  const toolName = 'runs_get';

  server.registerTool(
    toolName,
    {
      title: 'Get run details',
      description: 'Fetch a run record by ID from the operations database.',
      inputSchema: inputSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: {
        category: 'operations',
      },
    },
    async (rawArgs) => {
      if (!config.operationsDatabaseUrl) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'runs_get failed: OPERATIONS_DATABASE_URL is not configured on the server.',
            },
          ],
          isError: true,
        };
      }

      let args: GetRunInput;

      try {
        args = inputSchema.parse(rawArgs ?? {});
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to parse runs_get arguments';
        return {
          content: [
            {
              type: 'text' as const,
              text: `runs_get validation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        if (!repository) {
          repository = new OperationsRepository();
        }

        const run = await repository.getRunById(args.runId);
        const structured: GetRunOutput = {
          run: run ? serializeRun(run) : null,
        };

        if (!run) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No run found with id "${args.runId}".`,
              },
            ],
            structuredContent: structured,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Run ${run.id} | status=${run.status} | result=${
                run.result ?? '(none)'
              }`,
            },
          ],
          structuredContent: structured,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error querying run.';
        console.error('runs_get failed', error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `runs_get failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  console.info('[MCP] Tool registered:', toolName);
}

function serializeRun(run: Run) {
  return {
    id: run.id,
    projectId: run.projectId,
    personaId: run.personaId ?? null,
    chatId: run.chatId ?? null,
    status: run.status,
    result: run.result ?? null,
    input: run.input ?? null,
    metadata: run.metadata ?? null,
    startedAt: toIsoString(run.startedAt),
    completedAt: toIsoString(run.completedAt),
    createdAt: toIsoString(run.createdAt),
    updatedAt: toIsoString(run.updatedAt),
  };
}

function toIsoString(value: Run['createdAt']): string | null {
  if (!value) {
    return null;
  }

  const asDate = typeof value === 'string' ? new Date(value) : value;
  const timestamp = asDate instanceof Date ? asDate : new Date(asDate);

  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}
