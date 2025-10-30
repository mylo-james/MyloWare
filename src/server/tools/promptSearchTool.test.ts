import { describe, expect, it, vi } from 'vitest';
import type { PromptEmbeddingsRepository, SearchResult } from '../../db/repository';
import { searchPrompts } from './promptSearchTool';

describe('searchPrompts', () => {
  it('returns matches filtered by similarity and preserves metadata', async () => {
    const repository = {
      search: vi.fn().mockResolvedValue([
        createMatch({ similarity: 0.8, promptKey: 'demo::persona' }),
        createMatch({ similarity: 0.2, promptKey: 'ignored::low' }),
      ]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);

    const result = await searchPrompts(repository as unknown as PromptEmbeddingsRepository, embed, {
      query: 'demo persona',
      persona: 'persona',
      minSimilarity: 0.3,
    });

    expect(embed).toHaveBeenCalledWith(['demo persona']);
    expect(repository.search).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: 'persona',
        project: undefined,
        limit: 10,
        minSimilarity: 0.3,
      }),
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      promptKey: 'demo::persona',
      similarity: 0.8,
    });
    expect(result.appliedFilters.persona).toBe('persona');
  });

  it('defaults limit and minSimilarity when omitted', async () => {
    const repository = {
      search: vi.fn().mockResolvedValue([createMatch({ similarity: 0.5 })]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockResolvedValue([[0.1]]);

    const result = await searchPrompts(repository as unknown as PromptEmbeddingsRepository, embed, {
      query: 'demo',
    });

    expect(repository.search).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
        minSimilarity: 0.3,
      }),
    );
    expect(result.appliedFilters.limit).toBe(10);
    expect(result.appliedFilters.minSimilarity).toBe(0.3);
  });
});

function createMatch(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: overrides.chunkId ?? 'chunk-1',
    promptKey: overrides.promptKey ?? 'demo::persona',
    chunkText: overrides.chunkText ?? 'Prompt guidance text for testing.',
    rawSource: overrides.rawSource ?? 'Prompt guidance text for testing.',
    metadata: overrides.metadata ?? { persona: ['persona'] },
    similarity: overrides.similarity ?? 0.6,
  };
}
