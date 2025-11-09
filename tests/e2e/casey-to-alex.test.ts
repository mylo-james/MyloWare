import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import type { N8nClient } from '@/integrations/n8n/client.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { config } from '@/config/index.js';

const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-casey-alex',
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

describe('E2E: Casey → ... → Alex (Story 2.4)', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('delivers Veo video batch to Alex and enforces edit workflow expectations', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const memoryStore = getTool('memory_store');
    const handoffToAgent = getTool('handoff_to_agent');
    const memorySearch = getTool('memory_search');

    const sessionId = 'telegram:e2e-story-2-4';
    const prepareResult = await tracePrepare.handler(
      { instructions: 'Make an AISMR video about candles', sessionId, source: 'telegram' },
      'req-e2e-c2a-prepare'
    );
    const { traceId } = prepareResult.structuredContent as { traceId: string };

    await traceUpdate.handler(
      { traceId, projectId: 'aismr' },
      'req-e2e-c2a-update'
    );

    // Casey → Iggy → Riley → Veo (reuse helper logic)
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'iggy',
        instructions: 'Generate 12 AISMR modifiers for candles.',
        metadata: { fromAgent: 'casey' },
      },
      'req-e2e-c2a-casey'
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
      'req-e2e-c2a-modifiers'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'riley',
        instructions: 'Draft 12 AISMR scripts; validate timing and guardrails.',
        metadata: { fromAgent: 'iggy' },
      },
      'req-e2e-c2a-iggy'
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
      'req-e2e-c2a-scripts'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'veo',
        instructions: 'Generate 12 AISMR videos from the screenplays. Track jobs and store URLs.',
        metadata: { fromAgent: 'riley' },
      },
      'req-e2e-c2a-riley'
    );

    const videoUrls = Array.from({ length: 12 }, (_, i) => `https://videos.example.com/video-${i + 1}.mp4`);
    await memoryStore.handler(
      {
        content: JSON.stringify(videoUrls),
        memoryType: 'episodic',
        persona: ['veo'],
        project: ['aismr'],
        tags: ['videos'],
        traceId,
      },
      'req-e2e-c2a-videos'
    );

    const briefing =
      'Edit the AISMR compilation. Use edit_compilation workflow, track jobs, and provide the final URL.';
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'alex',
        instructions: briefing,
        metadata: { fromAgent: 'veo' },
      },
      'req-e2e-c2a-veo'
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(4);
    const [, , , alexCall] = invokeWebhookMock.mock.calls;
    const [webhookUrl, payload] = alexCall;
    const expectedBase = config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    expect(webhookUrl).toBe(`${expectedBase}/webhook/myloware/ingest`);
    expect((payload as Record<string, unknown>).sessionId).toBe(sessionId);

    const alexContextResult = await tracePrepare.handler(
      { traceId },
      'req-e2e-c2a-alex-context'
    );
    const alexContext = alexContextResult.structuredContent as {
      trace: { currentOwner: string };
      systemPrompt: string;
    };
    expect(alexContext.trace.currentOwner).toBe('alex');
    expect(alexContext.systemPrompt).toMatch(/workflow_trigger/);
    expect(alexContext.systemPrompt).toMatch(/jobs/);

    const searchResult = await memorySearch.handler(
      { traceId, persona: 'veo', query: 'video' },
      'req-e2e-c2a-search'
    );
    const searchPayload = searchResult.structuredContent as { memories: Array<{ content: string }> };
    expect(searchPayload.memories.length).toBeGreaterThan(0);

    const storedMemories = await db
      .select()
      .from(memories)
      .where(sql`${memories.metadata}->>'traceId' = ${traceId}`);
    expect(storedMemories.some((m) => m.persona.includes('veo'))).toBe(true);

    const trace = await traceRepo.findByTraceId(traceId);
    expect(trace?.currentOwner).toBe('alex');
    expect(trace?.workflowStep).toBe(4);
  });
});

