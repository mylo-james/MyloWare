import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import type { SearchResult } from '../db/repository';
import type { MemoryType } from '../db/schema';
import { evaluateResultUtility, formulateRetrievalQuery, shouldRetrieve } from './retrievalDecisionAgent';

describe('shouldRetrieve', () => {
  it('parses LLM response and returns structured decision', async () => {
    const client = createDecisionClient({
      decision: 'yes',
      confidence: 0.84,
      rationale: 'Context lacks recent updates.',
      knowledgeSufficiency: 0.35,
      freshnessRisk: 0.78,
      ambiguity: 0.4,
    });

    const result = await shouldRetrieve(
      {
        query: 'What are the latest AISMR release notes?',
        summary: 'Existing notes cover releases up to July.',
      },
      { client: client as unknown as OpenAI },
    );

    expect(result.decision).toBe('yes');
    expect(result.confidence).toBeCloseTo(0.84, 5);
    expect(result.metrics.freshnessRisk).toBeGreaterThan(0.7);
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('applies safety override when context is safety critical', async () => {
    const client = createDecisionClient({
      decision: 'no',
      confidence: 0.55,
      rationale: 'Existing context appears sufficient.',
      knowledgeSufficiency: 0.8,
      freshnessRisk: 0.3,
      ambiguity: 0.2,
    });

    const result = await shouldRetrieve(
      {
        query: 'Confirm compliance requirements for today’s deployment.',
        summary: 'Last compliance review was two months ago.',
        safetyCritical: true,
      },
      { client: client as unknown as OpenAI },
    );

    expect(result.decision).toBe('yes');
    expect(result.safetyOverride).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('falls back to heuristics when the LLM call fails', async () => {
    const failingClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('network error')),
        },
      },
    } as unknown as OpenAI;

    const result = await shouldRetrieve(
      {
        query: 'Do we have any updates today?',
        missingInformation: ['Need confirmation about current schedule'],
      },
      { client: failingClient },
    );

    expect(result.decision).toBe('yes');
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.rationale.toLowerCase()).toContain('heuristic');
  });

  it('returns fallback when query is empty', async () => {
    const client = createDecisionClient({
      decision: 'yes',
      confidence: 0.9,
      rationale: 'Should never be used',
      knowledgeSufficiency: 0.3,
      freshnessRisk: 0.6,
      ambiguity: 0.4,
    });

    const result = await shouldRetrieve(
      {
        query: '   ',
      },
      { client: client as unknown as OpenAI },
    );

    expect(result.decision).toBe('maybe');
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });
});

describe('formulateRetrievalQuery', () => {
  it('uses LLM to craft a refined query', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: 'aismr release notes after july 2025 with change summaries',
                },
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    const query = await formulateRetrievalQuery(
      'What changed after the last AISMR release?',
      {
        summary: 'Current documentation ends on July 10, 2025.',
        missingInformation: ['Need August release details'],
        keywords: ['release notes', 'AISMR'],
        temporalFocus: 'recent',
      },
      { client },
    );

    expect(query).toContain('aismr');
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('falls back to heuristic formulation when useLLM is false', async () => {
    const query = await formulateRetrievalQuery(
      'Provide procedural checklist for AISMR idea validation',
      {
        intent: 'workflow_step',
        keywords: ['checklist', 'validation'],
        temporalFocus: 'any',
      },
      { useLLM: false },
    );

    expect(query).toContain('checklist');
    expect(query).toContain('intent:workflow_step');
  });
});

describe('evaluateResultUtility', () => {
  it('scores similarity, coverage, and diversity', () => {
    const results: SearchResult[] = [
      createResult('chunk-1', 'prompt-a', 0.82),
      createResult('chunk-2', 'prompt-b', 0.78),
      createResult('chunk-3', 'prompt-c', 0.75),
      createResult('chunk-4', 'prompt-d', 0.7),
    ];

    const utility = evaluateResultUtility(results, 'query about aisrm');

    expect(utility).toBeGreaterThan(0.6);
    expect(utility).toBeLessThanOrEqual(1);
  });

  it('returns zero for empty result sets', () => {
    expect(evaluateResultUtility([], 'anything')).toBe(0);
  });

  it('applies length penalty for long queries', () => {
    const results: SearchResult[] = [createResult('chunk-1', 'prompt-a', 0.4)];
    const shortQueryScore = evaluateResultUtility(results, 'short query');
    const longQueryScore = evaluateResultUtility(results, 'very long query '.repeat(20));

    expect(shortQueryScore).toBeGreaterThan(longQueryScore);
  });
});

function createDecisionClient(payload: Record<string, unknown>) {
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

function createResult(chunkId: string, promptKey: string, similarity: number): SearchResult {
  return {
    chunkId,
    promptKey,
    chunkText: 'Sample chunk text',
    rawSource: 'Sample source',
    metadata: {},
    similarity,
    ageDays: null,
    temporalDecayApplied: false,
    memoryType: 'semantic' as MemoryType,
  };
}
