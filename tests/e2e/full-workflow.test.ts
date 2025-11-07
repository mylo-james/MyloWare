import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, agentWebhooks, memories } from '@/db/schema.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { AgentWebhookRepository } from '@/db/repositories/agent-webhook-repository.js';
import { N8nClient } from '@/integrations/n8n/client.js';

// Mock N8nClient
const invokeWebhookMock = vi.fn().mockResolvedValue({
  executionId: 'exec-123',
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

describe('Full workflow E2E', () => {
  const traceRepo = new TraceRepository();
  const webhookRepo = new AgentWebhookRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(agentWebhooks);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('should complete Casey → Iggy → Riley → Veo → Alex → Quinn → Complete', async () => {
    // Setup: Create agent webhooks for all personas
    const agents = ['iggy', 'riley', 'veo', 'alex', 'quinn'];
    for (const agent of agents) {
      await webhookRepo.create({
        agentName: agent,
        webhookPath: `/webhook/${agent}`,
        isActive: true,
      });
    }

    // Step 1: Casey creates trace and sets project
    const traceCreateTool = getTool('trace_create');
    const createResult = await traceCreateTool.handler(
      {
        projectId: 'unknown',
        sessionId: 'telegram:test-user',
      },
      'req-e2e-1'
    );
    const traceId = createResult.structuredContent?.traceId as string;
    expect(traceId).toBeDefined();

    // Casey sets project
    const setProjectTool = getTool('set_project');
    await setProjectTool.handler(
      { traceId, projectId: 'aismr' },
      'req-e2e-2'
    );

    // Verify project was set
    const traceAfterProject = await traceRepo.findByTraceId(traceId);
    expect(traceAfterProject?.projectId).toBe('aismr');

    // Step 2: Casey hands off to Iggy
    const handoffTool = getTool('handoff_to_agent');
    await handoffTool.handler(
      {
        traceId,
        toAgent: 'iggy',
        instructions: 'Generate 12 AISMR modifiers for candles',
      },
      'req-e2e-3'
    );

    let trace = await traceRepo.findByTraceId(traceId);
    expect(trace?.currentOwner).toBe('iggy');
    expect(trace?.workflowStep).toBe(1);

    // Step 3: Iggy hands off to Riley
    await handoffTool.handler(
      {
        traceId,
        toAgent: 'riley',
        instructions: 'Write scripts for 12 modifiers',
      },
      'req-e2e-4'
    );

    trace = await traceRepo.findByTraceId(traceId);
    expect(trace?.currentOwner).toBe('riley');
    expect(trace?.workflowStep).toBe(2);

    // Step 4: Riley hands off to Veo
    await handoffTool.handler(
      {
        traceId,
        toAgent: 'veo',
        instructions: 'Generate videos for 12 scripts',
      },
      'req-e2e-5'
    );

    trace = await traceRepo.findByTraceId(traceId);
    expect(trace?.currentOwner).toBe('veo');
    expect(trace?.workflowStep).toBe(3);

    // Step 5: Veo hands off to Alex
    await handoffTool.handler(
      {
        traceId,
        toAgent: 'alex',
        instructions: 'Edit and stitch videos together',
      },
      'req-e2e-6'
    );

    trace = await traceRepo.findByTraceId(traceId);
    expect(trace?.currentOwner).toBe('alex');
    expect(trace?.workflowStep).toBe(4);

    // Step 6: Alex hands off to Quinn
    await handoffTool.handler(
      {
        traceId,
        toAgent: 'quinn',
        instructions: 'Publish final edit to TikTok',
      },
      'req-e2e-7'
    );

    trace = await traceRepo.findByTraceId(traceId);
    expect(trace?.currentOwner).toBe('quinn');
    expect(trace?.workflowStep).toBe(5);

    // Step 7: Quinn completes workflow
    await handoffTool.handler(
      {
        traceId,
        toAgent: 'complete',
        instructions: 'Published AISMR candles compilation to TikTok successfully. URL: https://tiktok.com/@mylo_aismr/video/123',
      },
      'req-e2e-8'
    );

    // Verify trace was completed
    const finalTrace = await traceRepo.findByTraceId(traceId);
    expect(finalTrace?.status).toBe('completed');
    expect(finalTrace?.completedAt).toBeDefined();
    expect(finalTrace?.workflowStep).toBe(5); // Should remain at last step

    // Verify all handoffs invoked webhooks (except completion)
    expect(invokeWebhookMock).toHaveBeenCalledTimes(5); // 5 handoffs (not counting complete)
  });

  it('should handle error handoff correctly', async () => {
    // Setup
    await webhookRepo.create({
      agentName: 'iggy',
      webhookPath: '/webhook/iggy',
      isActive: true,
    });

    // Create trace
    const traceCreateTool = getTool('trace_create');
    const createResult = await traceCreateTool.handler(
      { projectId: 'aismr', sessionId: 'telegram:test' },
      'req-e2e-error-1'
    );
    const traceId = createResult.structuredContent?.traceId as string;

    // Handoff to agent
    const handoffTool = getTool('handoff_to_agent');
    await handoffTool.handler(
      {
        traceId,
        toAgent: 'iggy',
        instructions: 'Generate modifiers',
      },
      'req-e2e-error-2'
    );

    // Error handoff
    await handoffTool.handler(
      {
        traceId,
        toAgent: 'error',
        instructions: 'Failed to generate modifiers',
      },
      'req-e2e-error-3'
    );

    // Verify trace status set to 'failed'
    const trace = await traceRepo.findByTraceId(traceId);
    expect(trace?.status).toBe('failed');
    expect(trace?.completedAt).toBeDefined();

    // Verify no webhook was invoked for error
    // (invokeWebhookMock should only be called once for the iggy handoff, not for error)
    expect(invokeWebhookMock).toHaveBeenCalledTimes(1);
  });

  it('should handle concurrent traces without conflicts', async () => {
    // Setup
    await webhookRepo.create({
      agentName: 'iggy',
      webhookPath: '/webhook/iggy',
      isActive: true,
    });

    // Create two traces simultaneously
    const traceCreateTool = getTool('trace_create');
    const trace1Result = await traceCreateTool.handler(
      { projectId: 'aismr', sessionId: 'telegram:user1' },
      'req-e2e-concurrent-1'
    );
    const trace2Result = await traceCreateTool.handler(
      { projectId: 'aismr', sessionId: 'telegram:user2' },
      'req-e2e-concurrent-2'
    );

    const traceId1 = trace1Result.structuredContent?.traceId as string;
    const traceId2 = trace2Result.structuredContent?.traceId as string;

    // Handoff both traces simultaneously
    const handoffTool = getTool('handoff_to_agent');
    await Promise.all([
      handoffTool.handler(
        {
          traceId: traceId1,
          toAgent: 'iggy',
          instructions: 'Trace 1 instructions',
        },
        'req-e2e-concurrent-3'
      ),
      handoffTool.handler(
        {
          traceId: traceId2,
          toAgent: 'iggy',
          instructions: 'Trace 2 instructions',
        },
        'req-e2e-concurrent-4'
      ),
    ]);

    // Verify both traces updated independently
    const trace1 = await traceRepo.findByTraceId(traceId1);
    const trace2 = await traceRepo.findByTraceId(traceId2);

    expect(trace1?.currentOwner).toBe('iggy');
    expect(trace1?.workflowStep).toBe(1);
    expect(trace2?.currentOwner).toBe('iggy');
    expect(trace2?.workflowStep).toBe(1);

    // Verify both traces have different IDs and are independent
    expect(traceId1).not.toBe(traceId2);
    expect(trace1?.instructions).toContain('Trace 1');
    expect(trace2?.instructions).toContain('Trace 2');
  });
});

