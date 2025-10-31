import { describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../db/repository';
import {
  extractReferences,
  resolveReference,
  type Reference,
} from './referenceExtractor';

describe('extractReferences', () => {
  it('extracts persona references from text and metadata', () => {
    const result = createResult({
      chunkText: 'The Screenwriter persona should collaborate with project teams.',
      metadata: {
        persona: ['screenwriter'],
        tags: ['workflow guidance'],
      },
    });

    const references = extractReferences(result);
    expect(references.some((ref) => ref.type === 'persona' && ref.normalized === 'screenwriter')).toBe(true);
  });

  it('extracts project references from text', () => {
    const result = createResult({
      chunkText: 'For project AISMR we recommend weekly standups.',
    });

    const references = extractReferences(result);
    expect(references.some((ref) => ref.type === 'project' && ref.normalized === 'aismr')).toBe(true);
  });

  it('extracts workflow references from text and tags', () => {
    const result = createResult({
      chunkText: 'See workflow step 3 for escalation procedures.',
      metadata: {
        tags: ['Workflow escalation'],
      },
    });

    const references = extractReferences(result);
    expect(references.some((ref) => ref.type === 'workflow')).toBe(true);
  });

  it('extracts link references', () => {
    const result = createResult({
      chunkText: 'Documentation can be found at https://docs.example.com/guide.',
    });

    const references = extractReferences(result);
    expect(references.some((ref) => ref.type === 'link')).toBe(true);
  });

  it('deduplicates similar references keeping highest confidence', () => {
    const result = createResult({
      chunkText: 'Screenwriter persona collaborates with the Screenwriter persona.',
      metadata: {
        persona: ['screenwriter'],
      },
    });

    const references = extractReferences(result);
    const personaRefs = references.filter((ref) => ref.type === 'persona');
    expect(personaRefs).toHaveLength(1);
  });
});

describe('resolveReference', () => {
  it('resolves persona references via semantic search', async () => {
    const reference: Reference = {
      type: 'persona',
      raw: 'Screenwriter persona',
      normalized: 'screenwriter',
      sourceChunkId: 'chunk-1',
      sourcePromptKey: 'persona.md',
      confidence: 0.8,
    };

    const repository = createRepositoryStub({
      search: vi.fn().mockResolvedValue([createResult()]),
      keywordSearch: vi.fn(),
    });

    const embed = vi.fn().mockResolvedValue([[0.1, 0.2]]);

    const resolved = await resolveReference(reference, repository, embed);
    expect(resolved.results).toHaveLength(1);
    expect(repository.search).toHaveBeenCalledTimes(1);
  });

  it('resolves workflow references using keyword search', async () => {
    const reference: Reference = {
      type: 'workflow',
      raw: 'workflow step 3',
      normalized: '3',
      sourceChunkId: 'chunk-1',
      sourcePromptKey: 'workflow.md',
      confidence: 0.7,
    };

    const repository = createRepositoryStub({
      search: vi.fn(),
      keywordSearch: vi.fn().mockResolvedValue([createResult({ chunkId: 'workflow-3' })]),
    });

    const embed = vi.fn();

    const resolved = await resolveReference(reference, repository, embed);
    expect(resolved.results[0]?.chunkId).toBe('workflow-3');
    expect(repository.keywordSearch).toHaveBeenCalledWith('workflow step 3', {}, { limit: 10 });
  });
});

function createResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: overrides.chunkId ?? 'chunk-1',
    promptKey: overrides.promptKey ?? 'demo.md',
    chunkText: overrides.chunkText ?? 'Sample chunk text.',
    rawSource: overrides.rawSource ?? 'Sample raw source.',
    metadata: overrides.metadata ?? {},
    similarity: overrides.similarity ?? 0.7,
    ageDays: overrides.ageDays ?? null,
    temporalDecayApplied: overrides.temporalDecayApplied ?? false,
    memoryType: overrides.memoryType ?? 'semantic',
  } as SearchResult;
}

function createRepositoryStub(methods: {
  search: (...args: any[]) => Promise<SearchResult[]>;
  keywordSearch: (...args: any[]) => Promise<SearchResult[]>;
}) {
  return {
    search: methods.search,
    keywordSearch: methods.keywordSearch,
  } as unknown as {
    search: (params: unknown) => Promise<SearchResult[]>;
    keywordSearch: (query: string, filters?: Record<string, unknown>, options?: { limit?: number }) => Promise<SearchResult[]>;
  };
}

