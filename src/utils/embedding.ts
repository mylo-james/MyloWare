import { withRetry } from './retry.js';
import { getOpenAIClient } from '../clients/openai.js';

export async function embedText(text: string): Promise<number[]> {
  return withRetry(
    async () => {
      const openai = getOpenAIClient();
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return response.data[0].embedding;
    },
    {
      maxRetries: 3,
      retryable: (error: unknown) => {
        if (error instanceof Error) {
          // Retry on rate limit or network errors
          return (
            error.message.includes('rate_limit') ||
            error.message.includes('rate limit') ||
            error.message.includes('network') ||
            error.message.includes('timeout')
          );
        }
        return false;
      },
    }
  );
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  return withRetry(
    async () => {
      const openai = getOpenAIClient();
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts,
      });
      return response.data.map((d) => d.embedding);
    },
    {
      maxRetries: 3,
      retryable: (error: unknown) => {
        if (error instanceof Error) {
          return (
            error.message.includes('rate_limit') ||
            error.message.includes('rate limit') ||
            error.message.includes('network') ||
            error.message.includes('timeout')
          );
        }
        return false;
      },
    }
  );
}
