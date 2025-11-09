import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import type { N8nClient } from '@/integrations/n8n/client.js';
import { config } from '@/config/index.js';

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

describe('Story 2.1 – Casey → Iggy handoff', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('prepares trace, updates project via slug, and hands off to Iggy', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const handoffToAgent = getTool('handoff_to_agent');

    const sessionId = 'telegram:story-2-1';
    const instructions = 'Make an AISMR video about candles';

    // 1. Casey prepares the trace (project not yet set)
    const prepareResult = await tracePrepare.handler(
      {
        instructions,
        sessionId,
        source: 'telegram',
      },
      'req-trace-prepare-initial'
    );

    const traceContext = prepareResult.structuredContent as {
      traceId: string;
      systemPrompt: string;
      allowedTools: string[];
      project: { id: string | null; name: string };
      trace: { projectId: string | null };
    };

    expect(traceContext.trace.projectId).toBeNull();
    expect(traceContext.project.name.toLowerCase()).toBe('conversation');
    expect(traceContext.systemPrompt).toContain('SYSTEM HINT: This looks like the "aismr" project');
    expect(traceContext.systemPrompt).toContain('trace_update({traceId');
    expect(traceContext.allowedTools).toContain('trace_update');

    // 2. Casey updates the project using the slug
    const updateResult = await traceUpdate.handler(
      {
        traceId: traceContext.traceId,
        projectId: 'aismr',
      },
      'req-trace-update-aismr'
    );

    const updatedTrace = updateResult.structuredContent as {
      projectId: string;
      currentOwner: string;
    };

    expect(updatedTrace.projectId).toBeTruthy();
    expect(updatedTrace.currentOwner).toBe('casey');

    // 3. Reload trace context to confirm guardrails and workflow
    const refreshedContextResult = await tracePrepare.handler(
      {
        traceId: traceContext.traceId,
        instructions,
      },
      'req-trace-prepare-refreshed'
    );

    const refreshedContext = refreshedContextResult.structuredContent as {
      systemPrompt: string;
      project: { name: string };
      trace: { projectId: string | null };
    };

    expect(refreshedContext.project.name).toBe('aismr');
    expect(refreshedContext.trace.projectId).toBe(updatedTrace.projectId);
    expect(refreshedContext.systemPrompt).toContain('PROJECT GUARDRAILS');
    expect(refreshedContext.systemPrompt).toContain('FIRST AGENT');

    // 4. Casey hands off to Iggy
    const handoffInstructions =
      'Generate 12 surreal AISMR modifiers about candles. Validate uniqueness and guardrails before storing.';
    await handoffToAgent.handler(
      {
        traceId: traceContext.traceId,
        toAgent: 'iggy',
        instructions: handoffInstructions,
        metadata: { fromAgent: 'casey' },
      },
      'req-handoff-casey-iggy'
    );

    expect(invokeWebhookMock).toHaveBeenCalledTimes(1);
    const [webhookUrl, payload] = invokeWebhookMock.mock.calls[0];
    const expectedBase = config.n8n.webhookUrl?.replace(/\/$/, '') || 'http://n8n:5678';
    expect(webhookUrl).toBe(`${expectedBase}/webhook/myloware/ingest`);
    expect(payload).toMatchObject({
      traceId: traceContext.traceId,
      instructions: handoffInstructions,
      sessionId,
    });
    expect((payload as Record<string, unknown>).projectId).toBe(updatedTrace.projectId);

    // 5. Trace ownership updates and memory persisted
    const persistedTrace = await traceRepo.findByTraceId(traceContext.traceId);
    expect(persistedTrace?.currentOwner).toBe('iggy');
    expect(persistedTrace?.workflowStep).toBe(1);

    const [handoffMemory] = await db
      .select()
      .from(memories)
      .where(sql`${memories.metadata}->>'traceId' = ${traceContext.traceId}`)
      .limit(1);

    expect(handoffMemory).toBeTruthy();
    expect(handoffMemory?.content).toContain('Handed off to iggy');

    // 6. Iggy prompt should include agent expectations from project playbooks
    const iggyContextResult = await tracePrepare.handler(
      {
        traceId: traceContext.traceId,
        instructions: handoffInstructions,
      },
      'req-trace-prepare-iggy'
    );

    const iggyContext = iggyContextResult.structuredContent as {
      trace: { currentOwner: string };
      systemPrompt: string;
      project: { name: string };
    };

    expect(iggyContext.trace.currentOwner).toBe('iggy');
    expect(iggyContext.project.name).toBe('aismr');
    expect(iggyContext.systemPrompt).toContain('YOUR ROLE EXPECTATIONS');
    expect(iggyContext.systemPrompt).toContain('12 surreal object-modifier pairs');
  });
});

