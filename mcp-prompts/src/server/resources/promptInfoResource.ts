import path from 'node:path';
import { config } from '../../config';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import packageJson from '../../../package.json';
import {
  PromptEmbeddingsRepository,
  type PromptStatistics,
} from '../../db/repository';
import { buildJsonResourceResponse, getDirectoryUsage } from './utils';

const DEFAULT_PROMPTS_DIR = path.resolve(process.cwd(), 'prompts');
const VECTOR_DIMENSIONS = 1536;

export interface PromptInfoResourceDependencies {
  repository?: PromptEmbeddingsRepository;
  promptsDir?: string;
  now?: () => Date;
}

export function registerPromptInfoResource(
  server: McpServer,
  dependencies: PromptInfoResourceDependencies = {},
): void {
  const repository = dependencies.repository ?? new PromptEmbeddingsRepository();
  const promptsDir = dependencies.promptsDir ?? DEFAULT_PROMPTS_DIR;
  const now = dependencies.now ?? (() => new Date());

  server.registerResource(
    'prompt-info',
    'prompt://info',
    {
      title: 'Prompt corpus information',
      description: 'Summary statistics for available prompts, embeddings, and configuration.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const [stats, usage] = await Promise.all([
        repository.getPromptStatistics(),
        getDirectoryUsage(promptsDir),
      ]);

      const payload = buildPayload(stats, usage, promptsDir, now());
      return buildJsonResourceResponse(uri, payload);
    },
  );

  console.info('[MCP] Resource registered: prompt://info');
}

function buildPayload(
  stats: PromptStatistics,
  usage: Awaited<ReturnType<typeof getDirectoryUsage>>,
  promptsDir: string,
  generatedAt: Date,
) {
  const averageChunksPerPrompt =
    stats.promptCount > 0 ? Number((stats.chunkCount / stats.promptCount).toFixed(2)) : 0;

  return {
    server: {
      name: packageJson.name,
      version: packageJson.version,
      environment: config.NODE_ENV,
      generatedAt: generatedAt.toISOString(),
    },
    prompts: {
      totalPrompts: stats.promptCount,
      totalChunks: stats.chunkCount,
      averageChunksPerPrompt,
      lastUpdatedAt: stats.lastUpdatedAt?.toISOString() ?? null,
    },
    embeddings: {
      model: config.OPENAI_EMBEDDING_MODEL,
      provider: 'openai',
      vectorDimensions: VECTOR_DIMENSIONS,
    },
    storage: {
      directory: promptsDir,
      exists: usage.exists,
      fileCount: usage.fileCount,
      directoryCount: usage.directoryCount,
      totalBytes: usage.totalBytes,
      totalMegabytes: Number((usage.totalBytes / (1024 * 1024)).toFixed(3)),
    },
    tools: ['prompts_search', 'prompts_get', 'prompts_list', 'prompts_filter'],
    database: {
      table: 'prompt_embeddings',
      vectorDimensions: VECTOR_DIMENSIONS,
      connectionUrlDefined: Boolean(config.DATABASE_URL),
    },
  };
}
