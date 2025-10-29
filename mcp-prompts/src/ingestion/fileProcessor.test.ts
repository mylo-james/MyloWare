import { describe, expect, it, vi } from 'vitest';
import type { PromptFileMetadata } from './walker';

const mocks = vi.hoisted(() => {
  const upsertEmbeddings = vi.fn(async () => 1);
  return { upsertEmbeddings };
});

const repositoryMocks = vi.hoisted(() => {
  const PromptEmbeddingsRepository = vi.fn(function MockPromptEmbeddingsRepository() {
    return {
      upsertEmbeddings: mocks.upsertEmbeddings,
    };
  });

  return { PromptEmbeddingsRepository };
});

vi.mock('../db/repository', () => ({
  PromptEmbeddingsRepository: repositoryMocks.PromptEmbeddingsRepository,
}));

vi.mock('./chunker', () => ({
  chunkPrompt: vi.fn(() => [
    {
      id: 'chunk-1',
      index: 0,
      granularity: 'chunk',
      text: 'hello world',
      raw: 'hello world',
      start: 0,
      end: 11,
      filePath: 'prompt.md',
    },
  ]),
}));

vi.mock('./embedder', () => ({
  embedTexts: vi.fn(async () => [[0.1, 0.2, 0.3]]),
}));

vi.mock('./metadata', () => ({
  parsePromptMetadata: vi.fn(() => ({
    type: 'persona',
    persona: ['tester'],
    project: [],
    filename: 'prompt.md',
  })),
}));

vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(async () => 'hello world'),
  },
}));

import { processPrompt } from './fileProcessor';

describe('processPrompt', () => {
  beforeEach(() => {
    mocks.upsertEmbeddings.mockClear();
    repositoryMocks.PromptEmbeddingsRepository.mockClear();
  });

  it('returns processed chunk information and saves embeddings', async () => {
    const file: PromptFileMetadata = {
      absolutePath: '/tmp/prompt.md',
      relativePath: 'prompt.md',
      size: 100,
      modifiedAt: new Date(),
      checksum: 'checksum',
    };

    const result = await processPrompt(file);

    expect(result.chunks).toHaveLength(1);
    expect(result.embeddingsSaved).toBe(1);
    expect(result.chunks[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(mocks.upsertEmbeddings).toHaveBeenCalledTimes(1);
  });
});
