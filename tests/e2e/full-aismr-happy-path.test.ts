import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import type { N8nClient } from '@/integrations/n8n/client.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { config } from '@/config/index.js';

const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-aismr-happy',
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

describe('Story 2.6 – Full AISMR happy path', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('executes the entire AISMR workflow within 30 seconds with complete trace history', async () => {
    const start = Date.now();
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const memoryStore = getTool('memory_store');
    const handoffToAgent = getTool('handoff_to_agent');

    // Casey kickoff
    const prepareResult = await tracePrepare.handler(
      { instructions: 'Make an AISMR video about candles', sessionId: 'telegram:e2e-happy', source: 'telegram' },
      'req-story2-6-prepare'
    );
    const { traceId } = prepareResult.structuredContent as { traceId: string };

    await traceUpdate.handler(
      { traceId, projectId: 'aismr' },
      'req-story2-6-update'
    );

    const stepAssertions = async (expectedOwner: string, expectedStep: number, expectedStatus = 'active') => {
      const trace = await traceRepo.findByTraceId(traceId);
      expect(trace?.currentOwner).toBe(expectedOwner);
      expect(trace?.workflowStep).toBe(expectedStep);
      expect(trace?.status).toBe(expectedStatus);
    };

    // Casey → Iggy
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'iggy',
        instructions: 'Generate 12 AISMR modifiers for candles.',
        metadata: { fromAgent: 'casey' },
      },
      'req-story2-6-casey'
    );
    await stepAssertions('iggy', 1);

    await memoryStore.handler(
      {
        content: Array.from({ length: 12 }, (_, i) => `Modifier ${i + 1}`).join(' | '),
        memoryType: 'episodic',
        persona: ['iggy'],
        project: ['aismr'],
        tags: ['modifiers'],
        traceId,
      },
      'req-story2-6-modifiers'
    );

    // Iggy → Riley
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'riley',
        instructions: 'Draft 12 AISMR scripts aligned to the modifiers.',
        metadata: { fromAgent: 'iggy' },
      },
      'req-story2-6-iggy'
    );
    await stepAssertions('riley', 2);

    await memoryStore.handler(
      {
        content: JSON.stringify(
          Array.from({ length: 12 }, (_, i) => ({
            modifier: `Modifier ${i + 1}`,
            screenplay: `INT. VOID - NIGHT - Script ${i + 1}`,
          }))
        ),
        memoryType: 'episodic',
        persona: ['riley'],
        project: ['aismr'],
        tags: ['screenplays'],
        traceId,
      },
      'req-story2-6-scripts'
    );

    // Riley → Veo
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'veo',
        instructions: 'Generate 12 AISMR videos from the screenplays. Track jobs and store URLs.',
        metadata: { fromAgent: 'riley' },
      },
      'req-story2-6-riley'
    );
    await stepAssertions('veo', 3);

    await memoryStore.handler(
      {
        content: JSON.stringify(
          Array.from({ length: 12 }, (_, i) => `https://videos.example.com/video-${i + 1}.mp4`)
        ),
        memoryType: 'episodic',
        persona: ['veo'],
        project: ['aismr'],
        tags: ['videos'],
        traceId,
      },
      'req-story2-6-videos'
    );

    // Veo → Alex
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'alex',
        instructions: 'Edit the AISMR compilation. Track edit jobs and deliver the final URL.',
        metadata: { fromAgent: 'veo' },
      },
      'req-story2-6-veo'
    );
    await stepAssertions('alex', 4);

    const finalUrl = 'https://videos.example.com/final-compilation.mp4';
    await memoryStore.handler(
      {
        content: finalUrl,
        memoryType: 'episodic',
        persona: ['alex'],
        project: ['aismr'],
        tags: ['final-edit'],
        traceId,
      },
      'req-story2-6-final'
    );

    // Alex → Quinn
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'quinn',
        instructions: 'Publish the AISMR compilation. Generate caption/hashtags and store published URL.',
        metadata: { fromAgent: 'alex' },
      },
      'req-story2-6-alex'
    );
    await stepAssertions('quinn', 5);

    const publishedUrl = 'https://tiktok.com/@aismr/video/1234567890';
    await memoryStore.handler(
      {
        content: publishedUrl,
        memoryType: 'episodic',
        persona: ['quinn'],
        project: ['aismr'],
        tags: ['published'],
        traceId,
      },
      'req-story2-6-published'
    );

    // Quinn → Complete
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'complete',
        instructions: `Published AISMR compilation to TikTok. URL: ${publishedUrl}`,
        metadata: { fromAgent: 'quinn' },
      },
      'req-story2-6-quinn'
    );

    const finalTrace = await traceRepo.findByTraceId(traceId);
    expect(finalTrace?.status).toBe('completed');
    expect(finalTrace?.currentOwner).toBe('complete');
    expect(finalTrace?.workflowStep).toBe(6); // includes terminal step
    expect(finalTrace?.completedAt).toBeInstanceOf(Date);

    // Memory audit: ensure each persona stored work with traceId
    const personaMemories = await db
      .select({
        persona: memories.persona,
        metadata: memories.metadata,
      })
      .from(memories)
      .where(sql`${memories.metadata}->>'traceId' = ${traceId}`);
    const personasSeen = new Set<string>();
    personaMemories.forEach((row) => {
      row.persona.forEach((p) => personasSeen.add(p));
      expect((row.metadata as Record<string, unknown>).traceId).toBe(traceId);
    });
    expect(Array.from(personasSeen)).toEqual(
      expect.arrayContaining(['iggy', 'riley', 'veo', 'alex', 'quinn'])
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(5);
    const expectedBase = config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    invokeWebhookMock.mock.calls.forEach(([url]) => {
      expect(url).toBe(`${expectedBase}/webhook/myloware/ingest`);
    });

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(30_000);
  });
});

