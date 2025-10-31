import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PromptEmbeddingsRepository, SearchResult } from '../db/repository';
import {
  getMemoryRouterMetrics,
  orchestrateMemorySearch,
  resetMemoryRouterMetrics,
  routeQuery,
} from './memoryRouter';

function createSearchResult(
  memoryType: SearchResult['memoryType'],
  similarity: number,
  chunkId = 'chunk',
) {
  return {
    chunkId,
    promptKey: `${memoryType}-prompt.md`,
    chunkText: `content-${memoryType}`,
    rawSource: `source-${memoryType}`,
    metadata: {},
    similarity,
    ageDays: null,
    temporalDecayApplied: false,
    memoryType,
  } satisfies SearchResult;
}

describe('memoryRouter', () => {
  beforeEach(() => {
    resetMemoryRouterMetrics();
  });

  describe('routeQuery', () => {
    it('prioritises persona memory for persona lookup queries', () => {
      const routes = routeQuery('Who am I as the screenwriter persona?', 'persona_lookup');

      expect(routes[0]).toBe('persona');
      expect(routes).toContain('semantic');
    });

    it('prioritises project memory for project lookup queries', () => {
      const routes = routeQuery('Need details about the AISMR project roadmap', 'project_lookup');

      expect(routes[0]).toBe('project');
      expect(routes).toContain('semantic');
      expect(routes).toContain('persona');
    });

    it('includes episodic memory when the query references prior conversations', () => {
      const routes = routeQuery('What did we discuss yesterday about AISMR?', 'general_knowledge');

      expect(routes[0]).toBe('episodic');
      expect(routes).toContain('semantic');
    });

    it('falls back to semantic, project, and persona when no heuristics apply', () => {
      const routes = routeQuery('Share insights on collaboration guidelines', 'general_knowledge');

      expect(routes).toEqual(['semantic', 'project', 'persona']);
    });
  });

  describe('orchestrateMemorySearch', () => {
    it('routes queries, executes searches per memory type, and records metrics', async () => {
      const searchMock = vi.fn(
        async (
          params: Parameters<PromptEmbeddingsRepository['search']>[0],
        ): Promise<Awaited<ReturnType<PromptEmbeddingsRepository['search']>>> => {
          const memoryType = params.memoryTypes?.[0] ?? 'semantic';
          const similarity = memoryType === 'persona' ? 0.9 : 0.6;
          return [createSearchResult(memoryType, similarity, `${memoryType}-1`)];
        },
      );

      const repository = { search: searchMock } as unknown as PromptEmbeddingsRepository;
      const embed = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
      const classify = vi.fn().mockResolvedValue({
        intent: 'persona_lookup',
        extractedPersona: 'screenwriter',
        extractedProject: 'aismr',
        confidence: 0.82,
      });

      const result = await orchestrateMemorySearch('Who am I as the screenwriter persona?', {
        repository,
        embed,
        classify,
        limitPerType: 2,
        minSimilarity: 0.1,
      });

      expect(classify).toHaveBeenCalledWith('Who am I as the screenwriter persona?');
      expect(embed).toHaveBeenCalledWith(['Who am I as the screenwriter persona?']);
      expect(searchMock).toHaveBeenCalled();

      const personaCalls = searchMock.mock.calls.filter(
        ([params]) => params.memoryTypes?.[0] === 'persona',
      );
      expect(personaCalls).toHaveLength(1);
      expect(personaCalls[0][0].persona).toBe('screenwriter');
      expect(personaCalls[0][0].project).toBe('aismr');

      expect(result.routes[0]).toBe('persona');
      expect(result.filters).toEqual({ persona: 'screenwriter', project: 'aismr' });
      expect(result.components[0].hits[0].chunkId).toBe('persona-1');
      expect(result.combined[0].chunkId).toBe('persona-1');
      expect(result.notes.some((note) => note.includes('persona'))).toBe(true);
      expect(result.components.length).toBeGreaterThan(1);

      const metrics = getMemoryRouterMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.routesPerType.persona).toBeGreaterThan(0);
      expect(metrics.lastLatencyMs).not.toBeNull();
    });

    it('throws when provided an empty query', async () => {
      await expect(() =>
        orchestrateMemorySearch('', {
          repository: { search: vi.fn() } as unknown as PromptEmbeddingsRepository,
          embed: vi.fn(),
          classify: vi.fn(),
        }),
      ).rejects.toThrow('Query must not be empty.');
    });
  });
});
