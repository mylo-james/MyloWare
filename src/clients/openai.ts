import OpenAI from 'openai';
import { config } from '../config/index.js';

export type OpenAIClient = Pick<OpenAI, 'embeddings' | 'chat'>;

let client: OpenAIClient | null = null;

function createTestClient(): OpenAIClient {
  const vectorDimensions = 1536;
  const buildEmbedding = (value: unknown, index: number): number[] => {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    const embedding = new Array(vectorDimensions).fill(0);
    embedding[0] = Math.min(str.length + index, 1024);
    embedding[1] = index;
    return embedding;
  };

  return {
    embeddings: {
      create: async ({ input }: { input: string | string[] }) => {
        const inputs = Array.isArray(input) ? input : [input];
        return {
          data: inputs.map((value, idx) => ({
            embedding: buildEmbedding(value, idx),
            index: idx,
            object: 'embedding' as const,
          })),
          model: 'text-embedding-3-small',
          object: 'list' as const,
          usage: {
            prompt_tokens: 0,
            total_tokens: 0,
          },
        } as Awaited<ReturnType<OpenAI['embeddings']['create']>>;
      },
    },
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: 'Mock summary',
              },
            },
          ],
        }),
      },
    },
  } as unknown as OpenAIClient;
}

export function getOpenAIClient(): OpenAIClient {
  if (client) {
    return client;
  }

  if (process.env.NODE_ENV === 'test') {
    client = createTestClient();
  } else {
    client = new OpenAI({
      apiKey: config.openai.apiKey,
    }) as OpenAIClient;
  }

  return client;
}

export function setOpenAIClient(customClient: OpenAIClient | null): void {
  client = customClient;
}
