import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import type { N8nClient } from '@/integrations/n8n/client.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { config } from '@/config/index.js';

const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-iggy-riley',
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

describe('Story 2.2 – Iggy → Riley handoff', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('stores unique modifiers and hands off Riley with trace-scoped memory', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const memoryStore = getTool('memory_store');
    const memorySearch = getTool('memory_search');
    const handoffToAgent = getTool('handoff_to_agent');

    // Bootstrap trace via Casey flow
    const prepareResult = await tracePrepare.handler(
      {
        instructions: 'Make an AISMR video about candles',
        sessionId: 'telegram:story-2-2',
        source: 'telegram',
      },
      'req-story2-2-prepare-casey'
    );
    const baseTrace = prepareResult.structuredContent as {
      traceId: string;
    };

    await traceUpdate.handler(
      { traceId: baseTrace.traceId, projectId: 'aismr' },
      'req-story2-2-update-project'
    );

    await handoffToAgent.handler(
      {
        traceId: baseTrace.traceId,
        toAgent: 'iggy',
        instructions: 'Generate 12 AISMR modifiers about candles. Check uniqueness before storing.',
        metadata: { fromAgent: 'casey' },
      },
      'req-story2-2-handoff-casey'
    );

    // Iggy context should emphasize memory search and uniqueness
    const iggyContextResult = await tracePrepare.handler(
      {
        traceId: baseTrace.traceId,
      },
      'req-story2-2-prepare-iggy'
    );
    const iggyContext = iggyContextResult.structuredContent as {
      trace: { currentOwner: string };
      systemPrompt: string;
    };
    expect(iggyContext.trace.currentOwner).toBe('iggy');
    expect(iggyContext.systemPrompt).toMatch(/memory_search/i);
    expect(iggyContext.systemPrompt).toMatch(/12 fresh modifiers/i);

    // Iggy stores modifiers
    const modifiers = Array.from({ length: 12 }, (_, idx) => `Modifier ${idx + 1}: surreal candle concept`);
    await memoryStore.handler(
      {
        content: modifiers.join(' | '),
        memoryType: 'episodic',
        persona: ['iggy'],
        project: ['aismr'],
        tags: ['modifiers', 'aismr'],
        traceId: baseTrace.traceId,
      },
      'req-story2-2-memory-store'
    );

    // Verify modifiers retrievable via trace-scoped memory_search
    const searchResult = await memorySearch.handler(
      {
        traceId: baseTrace.traceId,
        query: 'Modifier',
        persona: 'iggy',
        memoryTypes: ['episodic'],
      },
      'req-story2-2-memory-search'
    );

    const searchPayload = searchResult.structuredContent as {
      memories: Array<{ content: string }>;
    };
    expect(searchPayload.memories.length).toBeGreaterThan(0);
    expect(searchPayload.memories[0].content).toContain('Modifier 1');

    // Iggy hands off to Riley
    const briefing =
      'Convert the 12 modifiers into AISMR screenplays. Guardrails: 8-second clips, whisper at 3s, no more than 2 hands.';
    await handoffToAgent.handler(
      {
        traceId: baseTrace.traceId,
        toAgent: 'riley',
        instructions: briefing,
        metadata: { fromAgent: 'iggy' },
      },
      'req-story2-2-handoff-iggy'
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(2); // Casey→Iggy and Iggy→Riley handoffs
    const [, rileyPayload] = invokeWebhookMock.mock.calls;
    const [webhookUrl, payload] = rileyPayload;
    const expectedBase = config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    expect(webhookUrl).toBe(`${expectedBase}/webhook/myloware/ingest`);
    expect((payload as Record<string, unknown>).instructions).toBe(briefing);

    // Riley context should instruct loading modifiers via memory_search
    const rileyContextResult = await tracePrepare.handler(
      {
        traceId: baseTrace.traceId,
      },
      'req-story2-2-prepare-riley'
    );

    const rileyContext = rileyContextResult.structuredContent as {
      trace: { currentOwner: string };
      systemPrompt: string;
    };

    expect(rileyContext.trace.currentOwner).toBe('riley');
    expect(rileyContext.systemPrompt).toMatch(/memory_search/);
    expect(rileyContext.systemPrompt).toMatch(/12 screenplays/);

    // Memory persisted with traceId metadata
    const storedMemories = await db
      .select()
      .from(memories)
      .where(sql`${memories.metadata}->>'traceId' = ${baseTrace.traceId}`);
    expect(storedMemories.length).toBeGreaterThan(0);
    expect(storedMemories[0].persona).toContain('iggy');

    const persistedTrace = await traceRepo.findByTraceId(baseTrace.traceId);
    expect(persistedTrace?.currentOwner).toBe('riley');
    expect(persistedTrace?.workflowStep).toBe(2);
  });
});

