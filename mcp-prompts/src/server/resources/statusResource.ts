import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import packageJson from '../../../package.json';
import { config } from '../../config';
import {
  PromptEmbeddingsRepository,
  type DatabaseCheckResult,
  type PromptStatistics,
} from '../../db/repository';
import { buildJsonResourceResponse, getDirectoryUsage } from './utils';

const DEFAULT_PROMPTS_DIR = path.resolve(process.cwd(), 'prompts');

export interface StatusResourceDependencies {
  repository?: PromptEmbeddingsRepository;
  promptsDir?: string;
  now?: () => Date;
}

export function registerStatusResource(
  server: McpServer,
  dependencies: StatusResourceDependencies = {},
): void {
  const repository = dependencies.repository ?? new PromptEmbeddingsRepository();
  const promptsDir = dependencies.promptsDir ?? DEFAULT_PROMPTS_DIR;
  const now = dependencies.now ?? (() => new Date());

  server.registerResource(
    'status-health',
    'status://health',
    {
      title: 'MCP server health status',
      description: 'Runtime health information including database connectivity and storage usage.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const [dbStatus, statsResult, usage] = await Promise.all([
        repository.checkConnection(),
        safeGetPromptStatistics(repository),
        getDirectoryUsage(promptsDir),
      ]);

      const payload = buildStatusPayload(dbStatus, statsResult, usage, promptsDir, now());
      return buildJsonResourceResponse(uri, payload);
    },
  );

  console.info('[MCP] Resource registered: status://health');
}

async function safeGetPromptStatistics(repository: PromptEmbeddingsRepository) {
  try {
    const stats = await repository.getPromptStatistics();
    return { status: 'ok' as const, stats };
  } catch (error) {
    return {
      status: 'error' as const,
      error: error instanceof Error ? error.message : 'Unknown statistics error',
    };
  }
}

function buildStatusPayload(
  dbStatus: DatabaseCheckResult,
  statsResult:
    | { status: 'ok'; stats: PromptStatistics }
    | { status: 'error'; error: string },
  usage: Awaited<ReturnType<typeof getDirectoryUsage>>,
  promptsDir: string,
  generatedAt: Date,
) {
  const embeddingStatus = evaluateEmbeddingStatus();
  const overallStatus = deriveOverallStatus(dbStatus.status, embeddingStatus.status, statsResult);

  const promptsSummary =
    statsResult.status === 'ok'
      ? {
          totalPrompts: statsResult.stats.promptCount,
          totalChunks: statsResult.stats.chunkCount,
          lastUpdatedAt: statsResult.stats.lastUpdatedAt?.toISOString() ?? null,
        }
      : {
          totalPrompts: 0,
          totalChunks: 0,
          lastUpdatedAt: null,
          error: statsResult.error,
        };

  return {
    status: overallStatus,
    generatedAt: generatedAt.toISOString(),
    server: {
      name: packageJson.name,
      version: packageJson.version,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      environment: config.NODE_ENV,
    },
    checks: {
      database: dbStatus,
      embeddings: embeddingStatus,
      promptsDirectory: {
        status: usage.exists ? 'ok' : 'missing',
        directory: promptsDir,
        fileCount: usage.fileCount,
        totalBytes: usage.totalBytes,
        totalMegabytes: Number((usage.totalBytes / (1024 * 1024)).toFixed(3)),
      },
    },
    prompts: promptsSummary,
  };
}

function evaluateEmbeddingStatus() {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';

  if (!apiKey) {
    return {
      status: 'error' as const,
      error: 'OPENAI_API_KEY is not set.',
      model,
    };
  }

  return {
    status: 'ok' as const,
    model,
  };
}

function deriveOverallStatus(
  dbStatus: DatabaseCheckResult['status'],
  embeddingStatus: 'ok' | 'error',
  statsResult:
    | { status: 'ok'; stats: PromptStatistics }
    | { status: 'error'; error: string },
) {
  if (dbStatus !== 'ok' || embeddingStatus !== 'ok' || statsResult.status !== 'ok') {
    return 'degraded';
  }

  return 'ok';
}
