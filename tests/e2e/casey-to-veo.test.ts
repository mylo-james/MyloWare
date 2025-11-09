import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import type { N8nClient } from '@/integrations/n8n/client.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { config } from '@/config/index.js';

const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-casey-veo',
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

describe('E2E: Casey → Iggy → Riley → Veo (Story 2.3)', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('delivers screenplays to Veo and ensures workflow tools are referenced', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const memoryStore = getTool('memory_store');
    const handoffToAgent = getTool('handoff_to_agent');
    const memorySearch = getTool('memory_search');

    const sessionId = 'telegram:e2e-story-2-3';
    const userMessage = 'Make an AISMR video about candles';

    const prepareResult = await tracePrepare.handler(
      { instructions: userMessage, sessionId, source: 'telegram' },
      'req-e2e-c2v-prepare'
    );
    const { traceId } = prepareResult.structuredContent as { traceId: string };

    await traceUpdate.handler(
      { traceId, projectId: 'aismr' },
      'req-e2e-c2v-update'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'iggy',
        instructions: 'Generate 12 AISMR modifiers for candles.',
        metadata: { fromAgent: 'casey' },
      },
      'req-e2e-c2v-casey'
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
      'req-e2e-c2v-modifiers'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'riley',
        instructions: 'Draft 12 AISMR scripts; validate timing and guardrails.',
        metadata: { fromAgent: 'iggy' },
      },
      'req-e2e-c2v-iggy'
    );

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
      'req-e2e-c2v-scripts'
    );

    const briefing =
      'Generate 12 AISMR videos from the stored scripts. Track jobs and store URLs before handing off.';
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'veo',
        instructions: briefing,
        metadata: { fromAgent: 'riley' },
      },
      'req-e2e-c2v-riley'
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(3);
    const [, , veoCall] = invokeWebhookMock.mock.calls;
    const [webhookUrl, payload] = veoCall;
    const expectedBase = config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    expect(webhookUrl).toBe(`${expectedBase}/webhook/myloware/ingest`);
    expect((payload as Record<string, unknown>).sessionId).toBe(sessionId);

    const veoContextResult = await tracePrepare.handler(
      { traceId },
      'req-e2e-c2v-veo-context'
    );
    const veoContext = veoContextResult.structuredContent as {
      trace: { currentOwner: string };
      systemPrompt: string;
    };
    expect(veoContext.trace.currentOwner).toBe('veo');
    expect(veoContext.systemPrompt).toMatch(/workflow_trigger/);
    expect(veoContext.systemPrompt).toMatch(/jobs/);

    const screenplaySearch = await memorySearch.handler(
      { traceId, persona: 'riley', query: 'Script' },
      'req-e2e-c2v-search'
    );
    const screenplayPayload = screenplaySearch.structuredContent as { memories: Array<{ content: string }> };
    expect(screenplayPayload.memories.length).toBeGreaterThan(0);

    const storedMemories = await db
      .select()
      .from(memories)
      .where(sql`${memories.metadata}->>'traceId' = ${traceId}`);
    expect(storedMemories.some((m) => m.persona.includes('riley'))).toBe(true);

    const trace = await traceRepo.findByTraceId(traceId);
    expect(trace?.currentOwner).toBe('veo');
    expect(trace?.workflowStep).toBe(3);
  });
});

