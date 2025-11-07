import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { agentWebhooks, executionTraces, memories } from '@/db/schema.js';
import { AgentWebhookRepository } from '@/db/repositories/agent-webhook-repository.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { config } from '@/config/index.js';
import { sql } from 'drizzle-orm';
import type { N8nClient } from '@/integrations/n8n/client.js';

const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-casey-iggy',
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

describe('Casey → Iggy workflow contract', () => {
  const webhookRepo = new AgentWebhookRepository();
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(agentWebhooks);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('hands off with trace, session, and instructions context', async () => {
    await webhookRepo.create({
      agentName: 'iggy',
      webhookPath: '/webhook/iggy/ingest',
      description: 'Iggy workflow entry',
      isActive: true,
      metadata: {
        persona: 'iggy',
        expects: ['traceId', 'projectId', 'sessionId', 'instructions'],
      },
    });

    const traceCreate = getTool('trace_create');
    const traceResult = await traceCreate.handler(
      {
        projectId: 'aismr',
        sessionId: 'telegram:42',
        metadata: { source: 'casey-test' },
      },
      'req-casey-trace'
    );

    const traceId = (traceResult.structuredContent as { traceId: string })
      .traceId;
    expect(traceId).toBeTruthy();

    const handoff = getTool('handoff_to_agent');
    const instructions =
      'Generate 12 AISMR modifiers about tidal pools with calm energy.';
    await handoff.handler(
      {
        traceId,
        toAgent: 'iggy',
        instructions,
        metadata: { fromAgent: 'casey' },
      },
      'req-casey-handoff'
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(1);
    const [webhookUrl, payload] = invokeWebhookMock.mock.calls[0];
    const expectedBase =
      config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    expect(webhookUrl).toBe(`${expectedBase}/webhook/iggy/ingest`);
    expect(payload).toMatchObject({
      traceId,
      projectId: 'aismr',
      sessionId: 'telegram:42',
      instructions,
    });
    expect((payload as Record<string, unknown>).metadata).toMatchObject({
      fromAgent: 'casey',
    });

    const persistedTrace = await traceRepo.findByTraceId(traceId);
    expect(persistedTrace?.status).toBe('active');

    const [handoffMemory] = await db
      .select()
      .from(memories)
      .where(sql`${memories.metadata}->>'traceId' = ${traceId}`)
      .limit(1);

    expect(handoffMemory).toBeTruthy();
    expect(handoffMemory?.content).toContain('Handed off to iggy');
  });
});
