import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import type { N8nClient } from '@/integrations/n8n/client.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { config } from '@/config/index.js';

const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-veo-alex',
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

describe('Story 2.4 – Veo → Alex handoff', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('hands off completed video batch to Alex with compilation workflow guidance', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const memoryStore = getTool('memory_store');
    const handoffToAgent = getTool('handoff_to_agent');
    const memorySearch = getTool('memory_search');

    const sessionId = 'telegram:story-2-4';
    const prepareResult = await tracePrepare.handler(
      { instructions: 'Make an AISMR video about candles', sessionId, source: 'telegram' },
      'req-story2-4-prepare-casey'
    );
    const { traceId } = prepareResult.structuredContent as { traceId: string };

    await traceUpdate.handler(
      { traceId, projectId: 'aismr' },
      'req-story2-4-update-project'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'iggy',
        instructions: 'Generate 12 AISMR modifiers for candles.',
        metadata: { fromAgent: 'casey' },
      },
      'req-story2-4-casey'
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
      'req-story2-4-modifiers'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'riley',
        instructions: 'Draft 12 AISMR scripts; validate timing and guardrails.',
        metadata: { fromAgent: 'iggy' },
      },
      'req-story2-4-iggy'
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
      'req-story2-4-scripts'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'veo',
        instructions: 'Generate 12 AISMR videos from the screenplays. Track jobs and store URLs.',
        metadata: { fromAgent: 'riley' },
      },
      'req-story2-4-riley'
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
      'req-story2-4-videos'
    );

    const briefing =
      'Edit the 12 AISMR clips into the final compilation. Track edit jobs and deliver the final URL.';
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'alex',
        instructions: briefing,
        metadata: { fromAgent: 'veo' },
      },
      'req-story2-4-veo'
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(4);
    const [, , , alexCall] = invokeWebhookMock.mock.calls;
    const [webhookUrl, payload] = alexCall;
    const expectedBase = config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    expect(webhookUrl).toBe(`${expectedBase}/webhook/myloware/ingest`);
    expect((payload as Record<string, unknown>).instructions).toBe(briefing);

    const alexContextResult = await tracePrepare.handler(
      { traceId },
      'req-story2-4-prepare-alex'
    );
    const alexContext = alexContextResult.structuredContent as {
      trace: { currentOwner: string };
      systemPrompt: string;
    };
    expect(alexContext.trace.currentOwner).toBe('alex');
    expect(alexContext.systemPrompt).toMatch(/memory_search/);
    expect(alexContext.systemPrompt).toMatch(/workflow_trigger/);
    expect(alexContext.systemPrompt).toMatch(/jobs/);

    const searchResult = await memorySearch.handler(
      { traceId, persona: 'veo', query: 'video' },
      'req-story2-4-search-videos'
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

