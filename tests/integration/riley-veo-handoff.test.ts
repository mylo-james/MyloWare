import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import type { N8nClient } from '@/integrations/n8n/client.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { config } from '@/config/index.js';

const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-riley-veo',
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

describe('Story 2.3 – Riley → Veo handoff', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('hands off validated screenplays to Veo with job expectations', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const memoryStore = getTool('memory_store');
    const memorySearch = getTool('memory_search');
    const handoffToAgent = getTool('handoff_to_agent');

    // Bootstrap to Riley via prior steps
    const sessionId = 'telegram:story-2-3';
    const userMessage = 'Make an AISMR video about candles';

    const prepareResult = await tracePrepare.handler(
      { instructions: userMessage, sessionId, source: 'telegram' },
      'req-story2-3-prepare-casey'
    );
    const { traceId } = prepareResult.structuredContent as { traceId: string };

    await traceUpdate.handler(
      { traceId, projectId: 'aismr' },
      'req-story2-3-update-project'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'iggy',
        instructions: 'Generate 12 AISMR modifiers for candles.',
        metadata: { fromAgent: 'casey' },
      },
      'req-story2-3-handoff-casey'
    );

    await memoryStore.handler(
      {
        content: Array.from({ length: 12 }, (_, i) => `Modifier ${i + 1}`).join(' | '),
        memoryType: 'episodic',
        persona: ['iggy'],
        project: ['aismr'],
        tags: ['modifiers'],
        traceId,
      },
      'req-story2-3-store-modifiers'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'riley',
        instructions: 'Draft 12 AISMR scripts; validate timing and guardrails.',
        metadata: { fromAgent: 'iggy' },
      },
      'req-story2-3-handoff-iggy'
    );

    // Riley prompt should mention screenplays and validation
    const rileyContextResult = await tracePrepare.handler(
      { traceId },
      'req-story2-3-prepare-riley'
    );
    const rileyContext = rileyContextResult.structuredContent as {
      trace: { currentOwner: string };
      systemPrompt: string;
    };
    expect(rileyContext.trace.currentOwner).toBe('riley');
    expect(rileyContext.systemPrompt).toMatch(/12 screenplays/);

    // Riley stores screenplays and hands off to Veo
    const scripts = Array.from({ length: 12 }, (_, i) => ({
      modifier: `Modifier ${i + 1}`,
      screenplay: `INT. VOID - NIGHT - Script ${i + 1}`,
    }));
    await memoryStore.handler(
      {
        content: JSON.stringify(scripts),
        memoryType: 'episodic',
        persona: ['riley'],
        project: ['aismr'],
        tags: ['screenplays'],
        traceId,
      },
      'req-story2-3-store-scripts'
    );

    const briefing =
      'Generate 12 AISMR videos from the stored screenplays. Track jobs and hand off URLs to Alex.';
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'veo',
        instructions: briefing,
        metadata: { fromAgent: 'riley' },
      },
      'req-story2-3-handoff-riley'
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(3); // Casey→Iggy, Iggy→Riley, Riley→Veo
    const [, , veoCall] = invokeWebhookMock.mock.calls;
    const [webhookUrl, payload] = veoCall;
    const expectedBase = config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    expect(webhookUrl).toBe(`${expectedBase}/webhook/myloware/ingest`);
    expect((payload as Record<string, unknown>).instructions).toBe(briefing);

    // Veo context should reference memory_search, workflow_trigger, and jobs
    const veoContextResult = await tracePrepare.handler(
      { traceId },
      'req-story2-3-prepare-veo'
    );
    const veoContext = veoContextResult.structuredContent as {
      trace: { currentOwner: string };
      systemPrompt: string;
    };
    expect(veoContext.trace.currentOwner).toBe('veo');
    expect(veoContext.systemPrompt).toMatch(/memory_search/);
    expect(veoContext.systemPrompt).toMatch(/workflow_trigger/);
    expect(veoContext.systemPrompt).toMatch(/jobs/);

    // Ensure screenplays retrievable for Veo
    const screenplaySearch = await memorySearch.handler(
      { traceId, persona: 'riley', query: 'Script' },
      'req-story2-3-search-scripts'
    );
    const screenplayPayload = screenplaySearch.structuredContent as {
      memories: Array<{ content: string }>;
    };
    expect(screenplayPayload.memories.length).toBeGreaterThan(0);

    const trace = await traceRepo.findByTraceId(traceId);
    expect(trace?.currentOwner).toBe('veo');
    expect(trace?.workflowStep).toBe(3);

    const storedMemories = await db
      .select()
      .from(memories)
      .where(sql`${memories.metadata}->>'traceId' = ${traceId}`);
    expect(storedMemories.some((m) => m.persona.includes('riley'))).toBe(true);
  });
});

