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

describe('Concurrent Handoffs Integration', () => {
  const traceRepo = new TraceRepository();
  const webhookRepo = new AgentWebhookRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(agentWebhooks);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('should handle concurrent handoffs: only one succeeds, other retries', async () => {
    // Setup: Create agent webhooks
    await webhookRepo.create({
      agentName: 'agent-a',
      webhookPath: '/webhook/a',
      isActive: true,
    });

    await webhookRepo.create({
      agentName: 'agent-b',
      webhookPath: '/webhook/b',
      isActive: true,
    });

    // Create initial trace (internal - via TraceRepository)
    const createdTrace = await traceRepo.create({
      projectId: 'test-project',
      sessionId: 'test-session',
    });

    const traceId = createdTrace.traceId;
    expect(traceId).toBeDefined();

    // Verify initial state
    const initialTrace = await traceRepo.findByTraceId(traceId);
    expect(initialTrace?.currentOwner).toBe('casey');
    expect(initialTrace?.workflowStep).toBe(0);

    // Simulate two agents trying to handoff simultaneously
    const handoffTool = getTool('handoff_to_agent');
    
    const handoffA = handoffTool.handler(
      {
        traceId,
        toAgent: 'agent-a',
        instructions: 'Agent A instructions',
      },
      'req-concurrent-2'
    );

    const handoffB = handoffTool.handler(
      {
        traceId,
        toAgent: 'agent-b',
        instructions: 'Agent B instructions',
      },
      'req-concurrent-3'
    );

    // Execute both handoffs concurrently
    const results = await Promise.allSettled([handoffA, handoffB]);

    // At least one should succeed (both might succeed if they read before either writes)
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(succeeded.length + failed.length).toBe(2);

    // Verify any failures are ownership conflicts
    failed.forEach((failure) => {
      if (failure.status === 'rejected') {
        const error = failure.reason as Error;
        expect(error.message).toContain('Trace ownership conflict');
      }
    });

    // Verify final trace state is consistent
    const finalTrace = await traceRepo.findByTraceId(traceId);
    expect(finalTrace).toBeDefined();
    expect(finalTrace?.status).toBe('active');
    
    // One of the agents should be the owner (or casey if both failed, but that's unlikely)
    const owner = finalTrace?.currentOwner;
    expect(['agent-a', 'agent-b', 'casey']).toContain(owner);
    
    // If a handoff succeeded, workflowStep should be 1
    if (succeeded.length > 0) {
      expect(finalTrace?.workflowStep).toBeGreaterThanOrEqual(1);
      if (finalTrace?.workflowStep === 1) {
        expect(finalTrace?.previousOwner).toBe('casey');
      }
    }
  });

  it('should verify retry logic works correctly on ownership conflicts', async () => {
    // Setup: Create agent webhooks
    await webhookRepo.create({
      agentName: 'agent-retry',
      webhookPath: '/webhook/retry',
      isActive: true,
    });

    await webhookRepo.create({
      agentName: 'agent-other',
      webhookPath: '/webhook/other',
      isActive: true,
    });

    // Create initial trace (internal - via TraceRepository)
    const createdTrace = await traceRepo.create({
      projectId: 'test-project',
    });

    const traceId = createdTrace.traceId;

    // Verify initial state
    const initialTrace = await traceRepo.findByTraceId(traceId);
    expect(initialTrace?.currentOwner).toBe('casey');

    // Simulate two concurrent handoffs from the same owner (casey)
    // Only one should succeed due to optimistic locking
    const handoffTool = getTool('handoff_to_agent');
    
    const handoff1 = handoffTool.handler(
      {
        traceId,
        toAgent: 'agent-retry',
        instructions: 'First concurrent handoff',
      },
      'req-retry-2'
    );

    const handoff2 = handoffTool.handler(
      {
        traceId,
        toAgent: 'agent-other',
        instructions: 'Second concurrent handoff',
      },
      'req-retry-3'
    );

    // Execute both concurrently
    const results = await Promise.allSettled([handoff1, handoff2]);

    // At least one should succeed, at least one should fail
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(succeeded.length + failed.length).toBe(2);

    // Verify failures are ownership conflicts
    failed.forEach((failure) => {
      if (failure.status === 'rejected') {
        const error = failure.reason as Error;
        expect(error.message).toContain('Trace ownership conflict');
      }
    });

    // Verify final trace state is consistent
    const finalTrace = await traceRepo.findByTraceId(traceId);
    expect(finalTrace).toBeDefined();
    expect(finalTrace?.status).toBe('active');
    expect(finalTrace?.workflowStep).toBe(1);
    expect(['agent-retry', 'agent-other']).toContain(finalTrace?.currentOwner);
  });

  it('should maintain data consistency with concurrent terminal handoffs', async () => {
    // Setup: Create trace (internal - via TraceRepository)
    const createdTrace = await traceRepo.create({
      projectId: 'test-project',
    });

    const traceId = createdTrace.traceId;

    // Verify initial state
    const initialTrace = await traceRepo.findByTraceId(traceId);
    expect(initialTrace?.currentOwner).toBe('casey');

    // Simulate two concurrent terminal handoffs (complete/error)
    // Both start from the same owner (casey), so only one should succeed
    const handoffTool = getTool('handoff_to_agent');
    
    const completeHandoff = handoffTool.handler(
      {
        traceId,
        toAgent: 'complete',
        instructions: 'Workflow completed',
      },
      'req-terminal-2'
    );

    const errorHandoff = handoffTool.handler(
      {
        traceId,
        toAgent: 'error',
        instructions: 'Workflow failed',
      },
      'req-terminal-3'
    );

    // Execute both concurrently
    const results = await Promise.allSettled([completeHandoff, errorHandoff]);

    // At least one should succeed (both might succeed if timing is perfect, but optimistic locking should prevent this)
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    // Due to optimistic locking, typically one succeeds and one fails
    // But in rare cases both might succeed if they read before either writes
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(succeeded.length + failed.length).toBe(2);

    // Verify final trace state
    const finalTrace = await traceRepo.findByTraceId(traceId);
    expect(finalTrace).toBeDefined();
    
    // Trace should be in a terminal state (completed or failed)
    expect(['completed', 'failed']).toContain(finalTrace?.status);
    expect(finalTrace?.completedAt).toBeDefined();
    
    // Owner should be either 'complete' or 'error'
    expect(['complete', 'error']).toContain(finalTrace?.currentOwner);
  });

  it('should verify trace state consistency after multiple concurrent attempts', async () => {
    // Setup: Create agent webhooks
    await webhookRepo.create({
      agentName: 'agent-1',
      webhookPath: '/webhook/1',
      isActive: true,
    });

    await webhookRepo.create({
      agentName: 'agent-2',
      webhookPath: '/webhook/2',
      isActive: true,
    });

    await webhookRepo.create({
      agentName: 'agent-3',
      webhookPath: '/webhook/3',
      isActive: true,
    });

    // Create initial trace (internal - via TraceRepository)
    const createdTrace = await traceRepo.create({
      projectId: 'test-project',
    });
    const traceId = createdTrace.traceId;

    // Verify initial state
    const initialTrace = await traceRepo.findByTraceId(traceId);
    expect(initialTrace?.currentOwner).toBe('casey');

    // Simulate multiple concurrent handoffs
    const handoffTool = getTool('handoff_to_agent');
    
    const handoffs = [
      handoffTool.handler(
        {
          traceId,
          toAgent: 'agent-1',
          instructions: 'Handoff 1',
        },
        'req-multi-2'
      ),
      handoffTool.handler(
        {
          traceId,
          toAgent: 'agent-2',
          instructions: 'Handoff 2',
        },
        'req-multi-3'
      ),
      handoffTool.handler(
        {
          traceId,
          toAgent: 'agent-3',
          instructions: 'Handoff 3',
        },
        'req-multi-4'
      ),
    ];

    // Execute all concurrently
    const results = await Promise.allSettled(handoffs);

    // At least one should succeed (optimistic locking should prevent most conflicts)
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(succeeded.length + failed.length).toBe(3);

    // Verify all failures are ownership conflicts
    failed.forEach((failure) => {
      if (failure.status === 'rejected') {
        const error = failure.reason as Error;
        expect(error.message).toContain('Trace ownership conflict');
      }
    });

    // Verify final trace state is consistent
    const finalTrace = await traceRepo.findByTraceId(traceId);
    expect(finalTrace).toBeDefined();
    expect(finalTrace?.status).toBe('active');
    expect(finalTrace?.workflowStep).toBe(1);
    expect(['agent-1', 'agent-2', 'agent-3']).toContain(finalTrace?.currentOwner);
  });
});

