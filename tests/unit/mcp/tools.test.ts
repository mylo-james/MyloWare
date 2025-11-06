import { describe, it, expect, beforeEach } from 'vitest';
import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { agentRuns, handoffTasks, runEvents, memories } from '@/db/schema.js';
import { MemoryRepository } from '@/db/repositories/memory-repository.js';
import { RunEventsRepository } from '@/db/repositories/run-events-repository.js';

const getTool = (name: string) => {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
};

describe('MCP tools', () => {
  beforeEach(async () => {
    await db.delete(runEvents);
    await db.delete(handoffTasks);
    await db.delete(agentRuns);
    await db.delete(memories);
  });

  it('creates, reads, updates runs and logs events with actor', async () => {
    const createTool = getTool('run_state_createOrResume');
    const createResult = await createTool.handler(
      { persona: 'casey', project: 'aismr' },
      'req-run-create'
    );
    const runId = createResult.structuredContent?.runId as string;
    expect(runId).toBeDefined();

    const updateTool = getTool('run_state_update');
    await updateTool.handler(
      { runId, patch: { status: 'in_progress', currentStep: 'drafting' } },
      'req-run-update'
    );

    const appendEventTool = getTool('run_state_appendEvent');
    await appendEventTool.handler(
      { runId, eventType: 'handoff_created', actor: 'casey', payload: { foo: 'bar' } },
      'req-run-event'
    );

    const readTool = getTool('run_state_read');
    const readResult = await readTool.handler({ runId }, 'req-run-read');
    expect(readResult.structuredContent?.status).toBe('in_progress');

    const eventsRepo = new RunEventsRepository();
    const events = await eventsRepo.listForRun(runId);
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe('casey');
  });

  it('handles handoff lifecycle via tools', async () => {
    const createRunTool = getTool('run_state_createOrResume');
    const run = await createRunTool.handler(
      { persona: 'casey', project: 'aismr' },
      'req-run-for-handoff'
    );
    const runId = run.structuredContent?.runId as string;

    const handoffCreate = getTool('handoff_create');
    const handoff = await handoffCreate.handler(
      { runId, toPersona: 'editor', taskBrief: 'Edit script' },
      'req-handoff-create'
    );
    const handoffId = handoff.structuredContent?.handoffId as string;
    expect(handoffId).toBeDefined();

    const handoffClaim = getTool('handoff_claim');
    const claimResult = await handoffClaim.handler(
      { handoffId, agentId: 'agent-editor', ttlMs: 1000 },
      'req-handoff-claim'
    );
    expect(claimResult.structuredContent?.status).toBe('locked');

    const handoffComplete = getTool('handoff_complete');
    await handoffComplete.handler(
      { handoffId, status: 'done', outputs: { url: 'http://example.com' } },
      'req-handoff-complete'
    );

    const handoffList = getTool('handoff_listPending');
    const pending = await handoffList.handler({ runId }, 'req-handoff-list');
    expect(pending.structuredContent?.handoffs).toHaveLength(0);
  });

  it('stores and retrieves memories scoped by runId', async () => {
    const memoryStore = getTool('memory_store');
    await memoryStore.handler(
      {
        content: 'Step 1 completed',
        memoryType: 'episodic',
        persona: ['casey'],
        project: ['aismr'],
        tags: ['test'],
        runId: 'run-123',
      },
      'req-memory-store-1'
    );

    await memoryStore.handler(
      {
        content: 'Other run event',
        memoryType: 'episodic',
        runId: 'run-999',
      },
      'req-memory-store-2'
    );

    const memorySearchByRun = getTool('memory_searchByRun');
    const searchResult = await memorySearchByRun.handler(
      { runId: 'run-123' },
      'req-memory-search'
    );

    const result = searchResult.structuredContent as {
      memories: Array<{ metadata: Record<string, unknown> }>;
      totalFound: number;
    };

    expect(result.totalFound).toBe(1);
    expect(result.memories[0].metadata.runId).toBe('run-123');

    // Ensure metadata filter actually hit DB record
    const repo = new MemoryRepository();
    const stored = await repo.findByRunId('run-123', {});
    expect(stored).toHaveLength(1);
  });
});
