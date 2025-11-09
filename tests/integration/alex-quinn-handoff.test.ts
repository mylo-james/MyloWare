import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import type { N8nClient } from '@/integrations/n8n/client.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { config } from '@/config/index.js';

const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-alex-quinn',
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

describe('Story 2.5 – Alex → Quinn handoff', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('publishes final video and completes trace', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const memoryStore = getTool('memory_store');
    const handoffToAgent = getTool('handoff_to_agent');

    const sessionId = 'telegram:story-2-5';
    const prepareResult = await tracePrepare.handler(
      { instructions: 'Make an AISMR video about candles', sessionId, source: 'telegram' },
      'req-story2-5-prepare-casey'
    );
    const { traceId } = prepareResult.structuredContent as { traceId: string };

    await traceUpdate.handler(
      { traceId, projectId: 'aismr' },
      'req-story2-5-update-project'
    );

    // Progress trace to Alex (reuse earlier steps quickly)
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'iggy',
        instructions: 'Generate 12 AISMR modifiers for candles.',
        metadata: { fromAgent: 'casey' },
      },
      'req-story2-5-casey'
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
      'req-story2-5-modifiers'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'riley',
        instructions: 'Draft 12 AISMR scripts; validate timing and guardrails.',
        metadata: { fromAgent: 'iggy' },
      },
      'req-story2-5-iggy'
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
      'req-story2-5-scripts'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'veo',
        instructions: 'Generate 12 AISMR videos from the screenplays. Track jobs and store URLs.',
        metadata: { fromAgent: 'riley' },
      },
      'req-story2-5-riley'
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
      'req-story2-5-videos'
    );

    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'alex',
        instructions: 'Edit the AISMR compilation. Track jobs and deliver the final URL.',
        metadata: { fromAgent: 'veo' },
      },
      'req-story2-5-veo'
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
      'req-story2-5-final-edit'
    );

    const briefing =
      'Publish the AISMR compilation to TikTok. Generate caption/hashtags, store published URL, then mark trace complete.';
    await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'quinn',
        instructions: briefing,
        metadata: { fromAgent: 'alex' },
      },
      'req-story2-5-alex'
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(5);
    const [, , , , quinnCall] = invokeWebhookMock.mock.calls;
    const [webhookUrl, payload] = quinnCall;
    const expectedBase = config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    expect(webhookUrl).toBe(`${expectedBase}/webhook/myloware/ingest`);
    expect((payload as Record<string, unknown>).instructions).toBe(briefing);

    const quinnContextResult = await tracePrepare.handler(
      { traceId },
      'req-story2-5-prepare-quinn'
    );
    const quinnContext = quinnContextResult.structuredContent as {
      trace: { currentOwner: string };
      systemPrompt: string;
    };
    expect(quinnContext.trace.currentOwner).toBe('quinn');
    expect(quinnContext.systemPrompt).toMatch(/memory_search/);
    expect(quinnContext.systemPrompt).toMatch(/workflow_trigger/);
    expect(quinnContext.systemPrompt).toMatch(/handoff_to_agent.*complete/i);

    // Quinn stores published URL and completes trace
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
      'req-story2-5-publish-memory'
    );

    const completionResponse = await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'complete',
        instructions: `Published AISMR compilation to TikTok. URL: ${publishedUrl}`,
        metadata: { fromAgent: 'quinn' },
      },
      'req-story2-5-quinn-complete'
    );

    expect(completionResponse.structuredContent).toMatchObject({
      status: 'completed',
      toAgent: 'complete',
      traceId,
    });

    const trace = await traceRepo.findByTraceId(traceId);
    expect(trace?.status).toBe('completed');
    expect(trace?.currentOwner).toBe('complete');
    expect(trace?.completedAt).toBeInstanceOf(Date);

    const storedMemories = await db
      .select()
      .from(memories)
      .where(sql`${memories.metadata}->>'traceId' = ${traceId}`);
    expect(storedMemories.some((m) => m.persona.includes('alex'))).toBe(true);
    expect(storedMemories.some((m) => m.persona.includes('quinn'))).toBe(true);
  });
});

