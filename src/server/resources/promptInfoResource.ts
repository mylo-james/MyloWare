import { config } from '../../config';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import packageJson from '../../../package.json';
import {
  PromptEmbeddingsRepository,
  type PromptStatistics,
} from '../../db/repository';
import { buildJsonResourceResponse } from './utils';

const VECTOR_DIMENSIONS = 1536;

export interface PromptInfoResourceDependencies {
  repository?: PromptEmbeddingsRepository;
  now?: () => Date;
}

export function registerPromptInfoResource(
  server: McpServer,
  dependencies: PromptInfoResourceDependencies = {},
): void {
  const repository = dependencies.repository ?? new PromptEmbeddingsRepository();
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
      const stats = await repository.getPromptStatistics();
      const payload = buildPayload(stats, now());
      return buildJsonResourceResponse(uri, payload);
    },
  );

  console.info('[MCP] Resource registered: prompt://info');
}

function buildPayload(stats: PromptStatistics, generatedAt: Date) {
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
    dataset: {
      source: 'database',
      table: 'prompt_embeddings',
      metadataKeys: ['project', 'persona', 'type'],
    },
    database: {
      table: 'prompt_embeddings',
      vectorDimensions: VECTOR_DIMENSIONS,
      connectionUrlDefined: Boolean(config.DATABASE_URL),
    },
  };
}
