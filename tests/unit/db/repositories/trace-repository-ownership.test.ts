import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db/client.js';
import { executionTraces } from '@/db/schema.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';

describe('TraceRepository ownership/workflow', () => {
  const repo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(executionTraces);
  });

  it('initializes new trace with default owner and workflow fields', async () => {
    const trace = await repo.create({ projectId: 'aismr' });
    expect(trace.currentOwner).toBe('casey');
    expect(trace.previousOwner).toBeNull();
    expect(trace.instructions).toBe('');
    expect(trace.workflowStep).toBe(0);
  });

  it('updateWorkflow sets owner, instructions, step and tracks previousOwner', async () => {
    const trace = await repo.create({ projectId: 'aismr' });
    const updated = await repo.updateWorkflow(
      trace.traceId,
      'iggy',
      'Generate 12 AISMR modifiers. Validate uniqueness.',
      1
    );

    expect(updated).toBeTruthy();
    expect(updated?.previousOwner).toBe('casey');
    expect(updated?.currentOwner).toBe('iggy');
    expect(updated?.instructions).toMatch(/Generate 12/);
    expect(updated?.workflowStep).toBe(1);

    const roundtrip = await repo.getTrace(trace.traceId);
    expect(roundtrip?.currentOwner).toBe('iggy');
    expect(roundtrip?.previousOwner).toBe('casey');
  });

  it('updateTrace mutates project, instructions, and metadata while preserving ownership fields', async () => {
    const trace = await repo.create({ projectId: 'aismr' });

    const updated = await repo.updateTrace(trace.traceId, {
      projectId: 'genreact',
      instructions: 'Switch to GenReact brief and capture the new guardrails.',
      metadata: { source: 'casey', sessionId: 'telegram:42' },
    });

    expect(updated).toBeTruthy();
    expect(updated?.projectId).toBe('genreact');
    expect(updated?.instructions).toMatch(/GenReact/);
    expect(updated?.metadata).toEqual({ source: 'casey', sessionId: 'telegram:42' });
    expect(updated?.currentOwner).toBe('casey');
  });
  
  it('updateTrace returns null when trace does not exist', async () => {
    const result = await repo.updateTrace('00000000-0000-0000-0000-000000000000', {
      projectId: 'genreact',
    });
    expect(result).toBeNull();
  });
});
