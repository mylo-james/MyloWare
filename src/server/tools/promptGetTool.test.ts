import { describe, expect, it, vi } from 'vitest';
import type {
  PromptChunk,
  PromptEmbeddingsRepository,
  PromptSummary,
} from '../../db/repository';
import { resolvePrompt } from './promptGetTool';

function createSummary(
  overrides: Partial<PromptSummary> = {},
  metadata: PromptSummary['metadata'] = {},
): PromptSummary {
  return {
    promptKey: overrides.promptKey ?? 'demo::persona',
    metadata,
    chunkCount: overrides.chunkCount ?? 1,
    updatedAt: overrides.updatedAt ?? '2025-01-01T00:00:00.000Z',
  };
}

function createChunk(overrides: Partial<PromptChunk> = {}): PromptChunk {
  return {
    chunkId: overrides.chunkId ?? 'checksum-document-0',
    promptKey: overrides.promptKey ?? 'demo::persona',
    chunkText: overrides.chunkText ?? 'Prompt body',
    rawSource: overrides.rawSource ?? 'Prompt body',
    granularity: overrides.granularity ?? 'document',
    metadata: overrides.metadata ?? { project: ['demo'], persona: ['reviewer'] },
    checksum: overrides.checksum ?? 'checksum',
    updatedAt: overrides.updatedAt ?? '2025-01-01T00:00:00.000Z',
  };
}

describe('resolvePrompt', () => {
  it('returns an exact match when project and persona are provided', async () => {
    const repository = {
      listPrompts: vi.fn().mockResolvedValue([
        createSummary(
          {},
          {
            project: ['demo'],
            persona: ['reviewer'],
          },
        ),
      ]),
      getChunksByPromptKey: vi.fn().mockResolvedValue([createChunk()]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const result = await resolvePrompt(repository as unknown as PromptEmbeddingsRepository, {
      project_name: 'Demo',
      persona_name: 'Reviewer',
    });

    expect(result.prompt).not.toBeNull();
    expect(result.prompt?.content).toBe('Prompt body');
    expect(result.resolution.strategy).toBe('exact');
    expect(result.candidates).toHaveLength(1);
  });

  it('errors when persona-only lookup has multiple matches', async () => {
    const repository = {
      listPrompts: vi.fn().mockResolvedValue([
        createSummary(
          { promptKey: 'demo::reviewer' },
          { persona: ['reviewer'], project: ['demo'] },
        ),
        createSummary(
          { promptKey: 'alt::reviewer' },
          { persona: ['reviewer'], project: ['alt'] },
        ),
      ]),
      getChunksByPromptKey: vi.fn(),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const result = await resolvePrompt(repository as unknown as PromptEmbeddingsRepository, {
      persona_name: 'Reviewer',
    });

    expect(result.prompt).toBeNull();
    expect(result.message).toMatch(/Provide project_name/);
    expect(result.resolution.strategy).toBe('persona_only');
    expect(result.candidates).toHaveLength(2);
  });

  it('resolves persona-only prompt when available', async () => {
    const repository = {
      listPrompts: vi.fn().mockResolvedValue([
        createSummary(
          { promptKey: 'persona::reviewer' },
          { persona: ['reviewer'] },
        ),
      ]),
      getChunksByPromptKey: vi.fn().mockResolvedValue([
        createChunk({
          promptKey: 'persona::reviewer',
          metadata: { persona: ['reviewer'] },
        }),
      ]),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const result = await resolvePrompt(repository as unknown as PromptEmbeddingsRepository, {
      persona_name: 'reviewer',
    });

    expect(result.prompt).not.toBeNull();
    expect(result.prompt?.promptKey).toBe('persona::reviewer');
    expect(result.resolution.strategy).toBe('persona_only');
  });
});
