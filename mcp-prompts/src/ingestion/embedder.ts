import { performance } from 'node:perf_hooks';
import OpenAI from 'openai';

const DEFAULT_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

let openAiClient: OpenAI | undefined;

export interface EmbedTextOptions {
  batchSize?: number;
  retries?: number;
  retryDelayMs?: number;
}

export async function embedTexts(
  texts: string[],
  options: EmbedTextOptions = {},
): Promise<number[][]> {
  if (!texts.length) {
    return [];
  }

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const client = getOpenAiClient();

  const results: number[][] = [];
  const overallStart = performance.now();

  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = texts.slice(index, index + batchSize);
    const batchStart = performance.now();

    const response = await runWithRetry(
      () =>
        client.embeddings.create({
          model: DEFAULT_MODEL,
          input: batch,
        }),
      { retries, retryDelayMs },
    );

    for (const item of response.data) {
      results.push(item.embedding);
    }

    const batchDuration = performance.now() - batchStart;
    console.info(
      `Embedding batch processed: size=${batch.length} duration=${batchDuration.toFixed(1)}ms`,
    );
  }

  const overallDuration = performance.now() - overallStart;
  console.info(
    `Embedding complete: total=${texts.length} vectors=${results.length} duration=${overallDuration.toFixed(1)}ms`,
  );

  return results;
}

function getOpenAiClient(): OpenAI {
  if (openAiClient) {
    return openAiClient;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set.');
  }

  openAiClient = new OpenAI({ apiKey });
  return openAiClient;
}

interface RetryOptions {
  retries: number;
  retryDelayMs: number;
}

async function runWithRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt > options.retries) {
        throw error;
      }

      await delay(options.retryDelayMs * attempt);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
