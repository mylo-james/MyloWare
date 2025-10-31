import { beforeEach, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import {
  QUERY_CLASSIFIER_MAX_INPUT_LENGTH,
  classifyQueryIntent,
  clearQueryClassifierCache,
  getQueryClassifierMetrics,
} from './queryClassifier';

beforeEach(() => {
  clearQueryClassifierCache();
});

describe('classifyQueryIntent', () => {
  it('classifies persona lookup queries', async () => {
    const client = createMockClient({
      intent: 'persona_lookup',
      extractedPersona: 'screenwriter',
      confidence: 0.91,
    });

    const result = await classifyQueryIntent('What does the Screenwriter persona do?', {
      client: client as unknown as OpenAI,
    });

    expect(result).toEqual({
      intent: 'persona_lookup',
      extractedPersona: 'screenwriter',
      extractedProject: undefined,
      confidence: 0.91,
    });
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('classifies project lookup queries', async () => {
    const client = createMockClient({
      intent: 'project_lookup',
      extractedProject: 'aismr',
      confidence: 0.87,
    });

    const result = await classifyQueryIntent('Tell me about the AISMR project', {
      client: client as unknown as OpenAI,
    });

    expect(result).toMatchObject({
      intent: 'project_lookup',
      extractedProject: 'aismr',
      confidence: 0.87,
    });
  });

  it('classifies combination queries', async () => {
    const client = createMockClient({
      intent: 'combination_lookup',
      extractedPersona: 'screenwriter',
      extractedProject: 'aismr',
      confidence: 0.93,
    });

    const result = await classifyQueryIntent('How should screenwriter work with AISMR?', {
      client: client as unknown as OpenAI,
    });

    expect(result).toMatchObject({
      intent: 'combination_lookup',
      extractedPersona: 'screenwriter',
      extractedProject: 'aismr',
    });
  });

  it('handles general knowledge queries', async () => {
    const client = createMockClient({
      intent: 'general_knowledge',
      confidence: 0.42,
    });

    const result = await classifyQueryIntent('What are the best practices for video generation?', {
      client: client as unknown as OpenAI,
    });

    expect(result.intent).toBe('general_knowledge');
    expect(result.confidence).toBeCloseTo(0.42, 5);
  });

  it('returns fallback for empty queries without calling OpenAI', async () => {
    const client = createMockClient({
      intent: 'persona_lookup',
      extractedPersona: 'ignored',
      confidence: 0.9,
    });

    const result = await classifyQueryIntent('   ', { client: client as unknown as OpenAI });

    expect(result.intent).toBe('general_knowledge');
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('truncates very long queries before sending to the API', async () => {
    const client = createMockClient({
      intent: 'general_knowledge',
      confidence: 0.3,
    });

    const longQuery = 'feature '.repeat(QUERY_CLASSIFIER_MAX_INPUT_LENGTH);
    await classifyQueryIntent(longQuery, { client: client as unknown as OpenAI });

    const callArgs = client.chat.completions.create.mock.calls[0]?.[0];
    const userMessage = callArgs?.messages?.at(-1)?.content ?? '';
    const truncated = longQuery.slice(0, QUERY_CLASSIFIER_MAX_INPUT_LENGTH);

    expect(typeof userMessage).toBe('string');
    expect(userMessage.includes(truncated)).toBe(true);
    expect(userMessage.includes(truncated + ' feature')).toBe(false);
  });

  it('uses cache and exposes metrics', async () => {
    const client = createMockClient({
      intent: 'persona_lookup',
      extractedPersona: 'screenwriter',
      confidence: 0.9,
    });

    await classifyQueryIntent('Describe the screenwriter persona', {
      client: client as unknown as OpenAI,
    });
    await classifyQueryIntent('Describe the screenwriter persona', {
      client: client as unknown as OpenAI,
    });

    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
    const metrics = getQueryClassifierMetrics();
    expect(metrics.misses).toBe(1);
    expect(metrics.hits).toBe(1);
  });
});

function createMockClient(payload: Record<string, unknown>) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(payload),
              },
            },
          ],
        }),
      },
    },
  } as unknown as {
    chat: {
      completions: {
        create: ReturnType<typeof vi.fn>;
      };
    };
  };
}
