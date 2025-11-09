import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import type { N8nClient } from '@/integrations/n8n/client.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { config } from '@/config/index.js';

const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-telegram-iggy',
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

describe('E2E: Telegram to Iggy (Story 2.1)', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('completes Casey → Iggy handoff from Telegram trigger under 30 seconds', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const handoffToAgent = getTool('handoff_to_agent');
    const sessionId = 'telegram:e2e-story-2-1';
    const userMessage = 'Make an AISMR video about candles';
    const startTime = Date.now();

    // Prepare trace (Casey kickoff)
    const prepareResult = await tracePrepare.handler(
      {
        instructions: userMessage,
        sessionId,
        source: 'telegram',
      },
      'req-e2e-telegram-prepare'
    );

    const initialContext = prepareResult.structuredContent as {
      traceId: string;
      trace: { projectId: string | null };
      systemPrompt: string;
      allowedTools: string[];
    };

    expect(initialContext.trace.projectId).toBeNull();
    expect(initialContext.allowedTools).toContain('trace_update');
    expect(initialContext.systemPrompt).toContain('SYSTEM HINT');

    // Casey sets project and refreshes context
    await traceUpdate.handler(
      {
        traceId: initialContext.traceId,
        projectId: 'aismr',
      },
      'req-e2e-telegram-update'
    );

    const refreshedContextResult = await tracePrepare.handler(
      {
        traceId: initialContext.traceId,
      },
      'req-e2e-telegram-refresh'
    );

    const refreshedContext = refreshedContextResult.structuredContent as {
      systemPrompt: string;
      project: { name: string };
      trace: { currentOwner: string };
    };

    expect(refreshedContext.project.name).toBe('aismr');
    expect(refreshedContext.systemPrompt).toContain('PROJECT GUARDRAILS');
    expect(refreshedContext.trace.currentOwner).toBe('casey');

    // Casey hands off to Iggy
    const briefing =
      'Generate 12 surreal AISMR modifiers about candles. Check uniqueness before storing and hand off to Riley.';
    await handoffToAgent.handler(
      {
        traceId: initialContext.traceId,
        toAgent: 'iggy',
        instructions: briefing,
        metadata: { fromAgent: 'casey' },
      },
      'req-e2e-telegram-handoff'
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(1);
    const [webhookUrl, payload] = invokeWebhookMock.mock.calls[0];
    const expectedBase = config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    expect(webhookUrl).toBe(`${expectedBase}/webhook/myloware/ingest`);
    expect(payload).toMatchObject({
      traceId: initialContext.traceId,
      instructions: briefing,
      sessionId,
    });

    // Validate trace ownership/memory
    const trace = await traceRepo.findByTraceId(initialContext.traceId);
    expect(trace?.currentOwner).toBe('iggy');
    expect(trace?.workflowStep).toBe(1);

    const [handoffMemory] = await db
      .select()
      .from(memories)
      .where(sql`${memories.metadata}->>'traceId' = ${initialContext.traceId}`)
      .limit(1);

    expect(handoffMemory).toBeTruthy();
    expect(handoffMemory?.content).toContain('Handed off to iggy');

    // Confirm runtime constraint for stubbed flow
    const durationMs = Date.now() - startTime;
    expect(durationMs).toBeLessThan(30_000);
  });
});

