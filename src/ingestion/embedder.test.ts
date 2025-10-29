import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const create = vi.fn(async ({ input }: { input: string[] }) => ({
    data: input.map(() => ({ embedding: Array.from({ length: 1536 }, (_, idx) => idx) })),
  }));

  class MockOpenAI {
    embeddings = {
      create,
    };
  }

  return { create, MockOpenAI };
});

vi.mock('openai', () => ({
  default: mocks.MockOpenAI,
}));

import { embedTexts } from './embedder';

describe('embedTexts', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    mocks.create.mockClear();
    consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    consoleSpy?.mockRestore();
  });

  afterAll(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('returns empty array when no texts are provided', async () => {
    const result = await embedTexts([]);
    expect(result).toEqual([]);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates embeddings using OpenAI batches', async () => {
    const texts = ['hello world', 'semantic embeddings'];
    const embeddings = await embedTexts(texts, { batchSize: 1 });

    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(embeddings).toHaveLength(2);
    expect(embeddings[0]).toHaveLength(1536);
  });
});
