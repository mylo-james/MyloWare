import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';

const sendMessageMock = vi.fn().mockResolvedValue({
  success: true,
  messageId: 123,
  chatId: 456,
});

const getTelegramClientMock = vi.fn(() => ({
  sendMessage: sendMessageMock,
}));

vi.mock('@/integrations/telegram/client.js', () => ({
  getTelegramClient: getTelegramClientMock,
}));

const getTool = (name: string) => {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
};

describe('Terminal handoff behaviour', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();
  });

  it('marks trace completed and notifies Telegram users', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const handoffToAgent = getTool('handoff_to_agent');

    const sessionId = 'telegram:integration-complete';
    const prepareResult = await tracePrepare.handler(
      { instructions: 'Kickoff trace for terminal test', sessionId, source: 'telegram' },
      'req-terminal-complete-prepare'
    );
    const { traceId } = prepareResult.structuredContent as { traceId: string };

    await traceUpdate.handler(
      { traceId, projectId: 'aismr' },
      'req-terminal-complete-update'
    );

    // Ensure trace carries session, owner, and workflow step for completion path
    await db
      .update(executionTraces)
      .set({
        sessionId,
        currentOwner: 'quinn',
        workflowStep: 5,
      })
      .where(eq(executionTraces.traceId, traceId));

    const publishedUrl = 'https://tiktok.example.com/video/terminal-123';
    const response = await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'complete',
        instructions: `Published successfully. URL: ${publishedUrl}`,
      },
      'req-terminal-complete-handoff'
    );

    expect(response.structuredContent).toMatchObject({
      status: 'completed',
      toAgent: 'complete',
      traceId,
    });

    const updatedTrace = await traceRepo.findByTraceId(traceId);
    expect(updatedTrace?.status).toBe('completed');
    expect(updatedTrace?.currentOwner).toBe('complete');
    expect(updatedTrace?.completedAt).toBeInstanceOf(Date);

    expect(getTelegramClientMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const [userId, message] = sendMessageMock.mock.calls[0] as [string, string];
    expect(userId).toBe('integration-complete');
    expect(message).toContain(publishedUrl);
    expect(message).toContain('AISMR');
  });

  it('marks trace failed without sending notifications', async () => {
    const tracePrepare = getTool('trace_prepare');
    const traceUpdate = getTool('trace_update');
    const handoffToAgent = getTool('handoff_to_agent');

    const sessionId = 'telegram:integration-error';
    const prepareResult = await tracePrepare.handler(
      { instructions: 'Kickoff trace for error test', sessionId, source: 'telegram' },
      'req-terminal-error-prepare'
    );
    const { traceId } = prepareResult.structuredContent as { traceId: string };

    await traceUpdate.handler(
      { traceId, projectId: 'aismr' },
      'req-terminal-error-update'
    );

    await db
      .update(executionTraces)
      .set({
        sessionId,
        currentOwner: 'veo',
        workflowStep: 3,
      })
      .where(eq(executionTraces.traceId, traceId));

    const response = await handoffToAgent.handler(
      {
        traceId,
        toAgent: 'error',
        instructions: 'Content policy violation – unable to continue',
      },
      'req-terminal-error-handoff'
    );

    expect(response.structuredContent).toMatchObject({
      status: 'failed',
      toAgent: 'error',
      traceId,
    });

    const updatedTrace = await traceRepo.findByTraceId(traceId);
    expect(updatedTrace?.status).toBe('failed');
    expect(updatedTrace?.currentOwner).toBe('error');
    expect(updatedTrace?.completedAt).toBeInstanceOf(Date);

    expect(getTelegramClientMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

