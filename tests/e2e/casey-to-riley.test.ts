import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import type { N8nClient } from '@/integrations/n8n/client.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { config } from '@/config/index.js';

const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-casey-riley',
  status: 'success',
  data: {},
});

vi.mock('@/integrations/n8n/client.js', () => {
  return {
    N8nClient: vi.fn().mockImplementation(function () {
      return {
        invokeWebhook: invokeWebhookMock,
      } as Pick<N8nClient, 'invokeWebhook'>;
    }),
  };
});

const getTool = (name: string) => {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
};

describe('E2E: Casey → Iggy → Riley (Story 2.2)', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('delivers modifiers to Riley via memory passing within timing budget', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const memoryStore = getTool('memory_store');
    const handoffToAgent = getTool('handoff_to_agent');
    const memorySearch = getTool('memory_search');
    const startTime = Date.now();

    const sessionId = 'telegram:e2e-story-2-2';
    const userMessage = 'Make an AISMR video about candles';

    const prepareResult = await tracePrepare.handler(
      { instructions: userMessage, sessionId, source: 'telegram' },
      'req-e2e-c2r-prepare'
    );
    const initialContext = prepareResult.structuredContent as { traceId: string };

    await traceUpdate.handler(
      { traceId: initialContext.traceId, projectId: 'aismr' },
      'req-e2e-c2r-update'
    );

    await handoffToAgent.handler(
      {
        traceId: initialContext.traceId,
        toAgent: 'iggy',
        instructions: 'Generate 12 AISMR modifiers for candles. Keep them unique and compliant.',
        metadata: { fromAgent: 'casey' },
      },
      'req-e2e-c2r-casey-handoff'
    );

    const modifiers = Array.from({ length: 12 }, (_, idx) => `Modifier ${idx + 1}: Spec ${idx}`);
    await memoryStore.handler(
      {
        content: modifiers.join(' | '),
        memoryType: 'episodic',
        persona: ['iggy'],
        project: ['aismr'],
        tags: ['modifiers', 'aismr'],
        traceId: initialContext.traceId,
      },
      'req-e2e-c2r-memory'
    );

    await handoffToAgent.handler(
      {
        traceId: initialContext.traceId,
        toAgent: 'riley',
        instructions: 'Draft 12 AISMR scripts from the new modifiers. Validate timing and guardrails.',
        metadata: { fromAgent: 'iggy' },
      },
      'req-e2e-c2r-iggy-handoff'
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(2);
    const [, rileyCall] = invokeWebhookMock.mock.calls;
    const [webhookUrl, payload] = rileyCall;
    const expectedBase = config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    expect(webhookUrl).toBe(`${expectedBase}/webhook/myloware/ingest`);
    expect((payload as Record<string, unknown>).sessionId).toBe(sessionId);

    const rileyContextResult = await tracePrepare.handler(
      { traceId: initialContext.traceId },
      'req-e2e-c2r-riley-context'
    );
    const rileyContext = rileyContextResult.structuredContent as {
      trace: { currentOwner: string };
      systemPrompt: string;
    };
    expect(rileyContext.trace.currentOwner).toBe('riley');
    expect(rileyContext.systemPrompt).toMatch(/memory_search/);
    expect(rileyContext.systemPrompt).toMatch(/12 screenplays/);

    const searchResult = await memorySearch.handler(
      {
        traceId: initialContext.traceId,
        query: 'Modifier',
        persona: 'iggy',
      },
      'req-e2e-c2r-search'
    );
    const searchPayload = searchResult.structuredContent as { memories: Array<{ content: string }> };
    expect(searchPayload.memories.length).toBeGreaterThan(0);
    expect(searchPayload.memories[0].content).toContain('Modifier 1');

    const storedMemories = await db
      .select()
      .from(memories)
      .where(sql`${memories.metadata}->>'traceId' = ${initialContext.traceId}`);
    expect(storedMemories.some((m) => m.persona.includes('iggy'))).toBe(true);

    const trace = await traceRepo.findByTraceId(initialContext.traceId);
    expect(trace?.currentOwner).toBe('riley');
    expect(trace?.workflowStep).toBe(2);

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(30_000);
  });
});

