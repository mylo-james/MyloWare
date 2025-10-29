import { describe, expect, it, vi } from 'vitest';
import type { PromptEmbeddingsRepository, PromptSummary } from '../../db/repository';
import { listPrompts } from './promptListTool';

describe('listPrompts', () => {
  it('returns prompts with normalized filters', async () => {
    const repository = {
      listPrompts: vi.fn().mockResolvedValue([
        createSummary({ promptKey: 'demo::persona', chunkCount: 3 }),
        createSummary({ promptKey: 'demo::project', chunkCount: 2 }),
      ]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const result = await listPrompts(repository as PromptEmbeddingsRepository, {
      persona: ' Reviewer ',
      project: 'Demo',
      type: 'Persona',
    });

    expect(repository.listPrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: 'reviewer',
        project: 'demo',
        type: 'persona',
      }),
    );

    expect(result.prompts).toHaveLength(2);
    expect(result.appliedFilters).toEqual({
      persona: 'reviewer',
      project: 'demo',
      type: 'persona',
    });
  });

  it('handles empty results gracefully', async () => {
    const repository = {
      listPrompts: vi.fn().mockResolvedValue([]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const result = await listPrompts(repository as PromptEmbeddingsRepository, {});

    expect(result.prompts).toHaveLength(0);
    expect(result.appliedFilters).toEqual({
      persona: null,
      project: null,
      type: null,
    });
  });
});

function createSummary(
  overrides: Partial<PromptSummary> = {},
  metadata: PromptSummary['metadata'] = {},
): PromptSummary {
  return {
    promptKey: overrides.promptKey ?? 'demo::persona',
    chunkCount: overrides.chunkCount ?? 1,
    updatedAt: overrides.updatedAt ?? '2025-01-01T00:00:00.000Z',
    metadata,
  };
}
