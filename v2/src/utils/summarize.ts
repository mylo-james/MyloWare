import { cleanForAI } from './validation.js';
import { withRetry } from './retry.js';
import { getOpenAIClient } from '../clients/openai.js';

export async function summarizeContent(content: string): Promise<string> {
  return withRetry(
    async () => {
      const openai = getOpenAIClient();
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a summarizer. Create a concise 1-sentence summary. Output ONLY the summary, no other text.',
          },
          {
            role: 'user',
            content: `Summarize this in one sentence:\n\n${content}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 100,
      });

      const summary = response.choices[0].message.content?.trim() || '';
      return cleanForAI(summary);
    },
    {
      maxRetries: 3,
      shouldRetry: (error) => {
        return (
          error.message.includes('rate_limit') ||
          error.message.includes('rate limit') ||
          error.message.includes('network') ||
          error.message.includes('timeout')
        );
      },
    }
  );
}
