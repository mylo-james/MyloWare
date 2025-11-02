import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { registerAdaptiveSearchTool, runAdaptiveSearch } from './adaptiveSearchTool';
import type { AdaptiveSearchResult } from '../../vector/retrievalOrchestrator';

describe('runAdaptiveSearch', () => {
  it('returns orchestrator output mapped to tool schema', async () => {
    const orchestratorResult: AdaptiveSearchResult = {
      decision: {
        decision: 'yes',
        confidence: 0.82,
        rationale: 'Additional retrieval recommended.',
        safetyOverride: false,
        metrics: {
          knowledgeSufficiency: 0.4,
          freshnessRisk: 0.7,
          ambiguity: 0.5,
        },
      },
      retrieved: true,
      finalUtility: 0.78,
      totalDurationMs: 1450,
      iterations: [
        {
          iteration: 1,
          query: 'aismr update',
          searchMode: 'vector',
          utility: 0.55,
          durationMs: 520,
          notes: ['Utility below threshold.'],
          results: [],
        },
        {
          iteration: 2,
          query: 'aismr update overview',
          searchMode: 'vector',
          utility: 0.78,
          durationMs: 640,
          notes: ['Utility 0.78 met threshold 0.75.'],
          results: [
            {
              chunkId: 'chunk-2',
              promptKey: 'aismr/updates.md',
              chunkText: 'Latest AISMR updates.',
              rawSource: 'Latest AISMR updates.',
              metadata: { project: ['aismr'] },
              similarity: 0.88,
              ageDays: null,
              temporalDecayApplied: false,
              memoryType: 'project',
            },
          ],
        },
      ],
      results: [
        {
          chunkId: 'chunk-2',
          promptKey: 'aismr/updates.md',
          chunkText: 'Latest AISMR updates.',
          rawSource: 'Latest AISMR updates.',
          metadata: { project: ['aismr'] },
          similarity: 0.88,
          ageDays: null,
          temporalDecayApplied: false,
          memoryType: 'project',
          foundAtIteration: 2,
          searchMode: 'vector',
          aggregatedScore: 0.88,
          route: ['aismr update overview'],
          hop: 0,
        },
      ],
    };

    const orchestrator = vi.fn().mockResolvedValue(orchestratorResult);
    const output = await runAdaptiveSearch(
      {
        query: 'aismr update',
      },
      {
        orchestrator,
      },
    );

    expect(output.decision.decision).toBe('yes');
    expect(output.results).toHaveLength(1);
    expect(output.results[0]?.preview).toContain('Latest AISMR updates');
    expect(output.iterations).toHaveLength(2);
    expect(output.iterations[0]?.resultCount).toBe(0);
    expect(output.iterations[1]?.resultCount).toBe(1);
    expect(output.results[0]?.aggregatedScore).toBeCloseTo(0.88, 5);
    expect(output.results[0]?.route).toEqual(['aismr update overview']);
    expect(output.results[0]?.hop).toBe(0);
  });

  it('includes multi-hop iterations and results when present', async () => {
    const orchestratorResult: AdaptiveSearchResult = {
      decision: {
        decision: 'yes',
        confidence: 0.7,
        rationale: 'Needs additional references.',
        safetyOverride: false,
        metrics: {
          knowledgeSufficiency: 0.3,
          freshnessRisk: 0.4,
          ambiguity: 0.5,
        },
      },
      retrieved: true,
      finalUtility: 0.6,
      totalDurationMs: 2200,
      iterations: [
        {
          iteration: 1,
          query: 'screenwriter workflow',
          searchMode: 'hybrid',
          utility: 0.4,
          durationMs: 700,
          notes: ['Utility 0.40 below threshold 0.70.'],
          results: [],
        },
        {
          iteration: 2,
          query: 'screenwriter workflow overview',
          searchMode: 'multi-hop',
          utility: 0.6,
          durationMs: 800,
          notes: ['Multi-hop hop 1 derived from reference expansion.'],
          results: [
            {
              chunkId: 'workflow-step-3',
              promptKey: 'screenwriter/workflow.md',
              chunkText: 'Workflow step 3 details.',
              rawSource: 'Workflow step 3 details.',
              metadata: { workflow: ['screenwriter-step-3'] },
              similarity: 0.65,
              ageDays: null,
              temporalDecayApplied: false,
              memoryType: 'procedural',
            },
          ],
        },
      ],
      results: [
        {
          chunkId: 'workflow-step-3',
          promptKey: 'screenwriter/workflow.md',
          chunkText: 'Workflow step 3 details.',
          rawSource: 'Workflow step 3 details.',
          metadata: { workflow: ['screenwriter-step-3'] },
          similarity: 0.65,
          ageDays: null,
          temporalDecayApplied: false,
          memoryType: 'procedural',
          foundAtIteration: 2,
          searchMode: 'multi-hop',
          aggregatedScore: 0.325,
          route: ['screenwriter workflow', 'workflow step screenwriter-step-3'],
          hop: 1,
        },
      ],
    };

    const orchestrator = vi.fn().mockResolvedValue(orchestratorResult);
    const output = await runAdaptiveSearch(
      {
        query: 'screenwriter workflow',
        enableMultiHop: true,
        maxHops: 2,
      },
      {
        orchestrator,
      },
    );

    expect(output.iterations[1]?.searchMode).toBe('multi-hop');
    expect(output.results[0]?.searchMode).toBe('multi-hop');
    expect(output.results[0]?.hop).toBe(1);
    expect(output.results[0]?.route).toContain('workflow step screenwriter-step-3');
  });
});

describe('registerAdaptiveSearchTool', () => {
  it('registers the tool and validates arguments', async () => {
    const server = createMockServer();
    const orchestrator = vi.fn().mockResolvedValue({
      decision: {
        decision: 'no',
        confidence: 0.9,
        rationale: 'Existing context sufficient.',
        safetyOverride: false,
        metrics: {
          knowledgeSufficiency: 0.85,
          freshnessRisk: 0.2,
          ambiguity: 0.3,
        },
      },
      retrieved: false,
      finalUtility: 0,
      totalDurationMs: 12,
      iterations: [],
      results: [],
    } satisfies AdaptiveSearchResult);

    registerAdaptiveSearchTool(server as unknown as McpServer, { orchestrator });

    expect(server.registerTool).toHaveBeenCalledTimes(1);
    const handler = server.registerTool.mock.calls[0][2];

    const success = await handler({
      query: 'Who maintains AISMR prompts?',
      maxIterations: 2,
      enableMultiHop: true,
      maxHops: 1,
    });

    expect(orchestrator).toHaveBeenCalledTimes(1);
    expect(success.content[0]?.type).toBe('text');
    expect(success.structuredContent).toMatchObject({
      decision: expect.objectContaining({
        decision: 'no',
      }),
      retrieved: false,
    });

    const failure = await handler({ query: '' });
    expect(failure.content[0]?.text).toContain('prompts_search_adaptive failed');
  });

  it('returns timeout error when orchestrator exceeds deadline', async () => {
    vi.useFakeTimers();
    const server = createMockServer();
    const orchestrator = vi.fn().mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      }),
    );

    registerAdaptiveSearchTool(server as unknown as McpServer, {
      orchestrator,
      timeoutMs: 20,
    });

    const handler = server.registerTool.mock.calls[0][2];
    const promise = handler({ query: 'slow query' });

    vi.advanceTimersByTime(25);
    const failure = await promise;
    vi.useRealTimers();

    expect(failure.content[0]?.text).toContain('timed out');
  });

  it('recovers gracefully when orchestrator throws', async () => {
    const server = createMockServer();
    const orchestrator = vi.fn().mockRejectedValue(new Error('orchestrator failure'));

    registerAdaptiveSearchTool(server as unknown as McpServer, { orchestrator });
    const handler = server.registerTool.mock.calls[0][2];
    const failure = await handler({ query: 'cause error' });

    expect(failure.content[0]?.text).toContain('orchestrator failure');
  });

  it('extracts arguments from request envelopes', async () => {
    const server = createMockServer();
    const orchestrator = vi.fn().mockResolvedValue({
      decision: {
        decision: 'yes',
        confidence: 0.6,
        rationale: 'Proceed with results.',
        safetyOverride: false,
        metrics: {
          knowledgeSufficiency: 0.5,
          freshnessRisk: 0.3,
          ambiguity: 0.4,
        },
      },
      retrieved: true,
      finalUtility: 0.6,
      totalDurationMs: 12,
      iterations: [
        {
          iteration: 1,
          query: 'enveloped query',
          searchMode: 'vector',
          utility: 0.6,
          durationMs: 12,
          notes: [],
          results: [],
        },
      ],
      results: [],
    } satisfies AdaptiveSearchResult);

    registerAdaptiveSearchTool(server as unknown as McpServer, { orchestrator });
    const handler = server.registerTool.mock.calls[0][2];

    const envelope = {
      sessionId: 'session-1',
      requestInfo: {
        input: {
          query: 'enveloped query',
        },
      },
      signal: new AbortController().signal,
    };

    const result = await handler(envelope);

    expect(orchestrator).toHaveBeenCalledWith(
      'enveloped query',
      expect.any(Object),
      expect.any(Object),
    );
    expect(result.content[0]?.text).toContain('Adaptive search completed');
  });
});

function createMockServer() {
  return {
    registerTool: vi.fn(),
  };
}
