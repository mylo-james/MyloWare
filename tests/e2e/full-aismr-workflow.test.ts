import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import type { N8nClient } from '@/integrations/n8n/client.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { config } from '@/config/index.js';

const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-full-aismr',
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

describe('E2E: Full AISMR workflow to completion (Story 2.5)', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('runs Casey → Iggy → Riley → Veo → Alex → Quinn → Complete', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const memoryStore = getTool('memory_store');
    const handoffToAgent = getTool('handoff_to_agent');

    const prepareResult = await tracePrepare.handler(
      { instructions: 'Make an AISMR video about candles', sessionId: 'telegram:e2e-full', source: 'telegram' },
      'req-e2e-full-prepare'
    );
    const { traceId } = prepareResult.structuredContent as { traceId: string };

    await traceUpdate.handler(
      { traceId, projectId: 'aismr' },
      'req-e2e-full-update'
    );

    // Casey → Iggy
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'iggy',
        instructions: 'Generate 12 AISMR modifiers for candles.',
        metadata: { fromAgent: 'casey' },
      },
      'req-e2e-full-casey'
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
      'req-e2e-full-modifiers'
    );

    // Iggy → Riley
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'riley',
        instructions: 'Draft 12 AISMR scripts aligned to the modifiers.',
        metadata: { fromAgent: 'iggy' },
      },
      'req-e2e-full-iggy'
    );

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
      'req-e2e-full-scripts'
    );

    // Riley → Veo
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'veo',
        instructions: 'Generate 12 AISMR videos from the screenplays. Track jobs and store URLs.',
        metadata: { fromAgent: 'riley' },
      },
      'req-e2e-full-riley'
    );

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
      'req-e2e-full-videos'
    );

    // Veo → Alex
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'alex',
        instructions: 'Edit the AISMR compilation. Track edit jobs and deliver the final URL.',
        metadata: { fromAgent: 'veo' },
      },
      'req-e2e-full-veo'
    );

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
      'req-e2e-full-final'
    );

    // Alex → Quinn
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'quinn',
        instructions: 'Publish the AISMR compilation. Generate caption/hashtags and store published URL.',
        metadata: { fromAgent: 'alex' },
      },
      'req-e2e-full-alex'
    );

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
      'req-e2e-full-published'
    );

    // Quinn → Complete
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'complete',
        instructions: `Published AISMR compilation to TikTok. URL: ${publishedUrl}`,
        metadata: { fromAgent: 'quinn' },
      },
      'req-e2e-full-quinn'
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(5); // All non-terminal handoffs
    const trace = await traceRepo.findByTraceId(traceId);
    expect(trace?.status).toBe('completed');
    expect(trace?.currentOwner).toBe('complete');
    expect(trace?.workflowStep).toBe(5);

    const storedMemories = await db
      .select()
      .from(memories)
      .where(sql`${memories.metadata}->>'traceId' = ${traceId}`);
    expect(storedMemories.length).toBeGreaterThan(0);

    const expectedBase = config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    const webhookUrls = invokeWebhookMock.mock.calls.map(([url]) => url);
    webhookUrls.forEach((url) => expect(url).toBe(`${expectedBase}/webhook/myloware/ingest`));
  });
});

