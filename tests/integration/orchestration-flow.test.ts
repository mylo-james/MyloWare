import { describe, it, expect, beforeEach } from 'vitest';
import { RunRepository, HandoffRepository, RunEventsRepository } from '@/db/repositories/index.js';
import { db } from '@/db/client.js';
import { agentRuns, handoffTasks, runEvents } from '@/db/schema.js';

describe('Orchestration Flow', () => {
  const runRepo = new RunRepository();
  const handoffRepo = new HandoffRepository();
  const eventsRepo = new RunEventsRepository();

  beforeEach(async () => {
    await db.delete(runEvents);
    await db.delete(handoffTasks);
    await db.delete(agentRuns);
  });

  it('should complete a full handoff cycle', async () => {
    // 1. Create a run
    const run = await runRepo.create({
      sessionId: 'test-session',
      persona: 'persona-a',
      project: 'test-project',
    });

    expect(run.id).toBeDefined();
    expect(run.status).toBe('new');

    // 2. Update run status to in_progress
    await runRepo.update(run.id, {
      status: 'in_progress',
      currentStep: 'initiating-handoff',
    });

    const updatedRun = await runRepo.findById(run.id);
    expect(updatedRun?.status).toBe('in_progress');

    // 3. Create handoff
    const handoff = await handoffRepo.create({
      runId: run.id,
      fromPersona: 'persona-a',
      toPersona: 'persona-b',
      taskBrief: 'Do something',
      requiredOutputs: { result: 'required' },
    });

    expect(handoff.id).toBeDefined();
    expect(handoff.status).toBe('pending');
    expect(handoff.toPersona).toBe('persona-b');

    // 4. Log event
    const event = await eventsRepo.append({
      runId: run.id,
      eventType: 'handoff_created',
      actor: 'persona-a',
      payload: { handoffId: handoff.id, toPersona: 'persona-b' },
    });

    expect(event.eventType).toBe('handoff_created');

    // 5. List pending handoffs
    const pending = await handoffRepo.listPending(run.id);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(handoff.id);

    // 6. Claim handoff
    const claimed = await handoffRepo.claim(handoff.id, 'agent-b', 300000);
    expect(claimed.status).toBe('locked');
    expect(claimed.handoff?.custodianAgent).toBe('agent-b');
    expect(claimed.handoff?.status).toBe('in_progress');

    // 7. Complete handoff
    const completed = await handoffRepo.complete(handoff.id, {
      status: 'done',
      outputs: { result: 'success' },
      notes: 'Task completed successfully',
    });

    expect(completed?.status).toBe('done');
    expect(completed?.completedAt).toBeDefined();

    // 8. Verify events
    const events = await eventsRepo.listForRun(run.id);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.eventType === 'handoff_created')).toBe(true);

    // 9. Update run status
    await runRepo.update(run.id, {
      status: 'completed',
      currentStep: 'finalized',
    });

    const finalRun = await runRepo.findById(run.id);
    expect(finalRun?.status).toBe('completed');
  });

  it('should handle multiple handoffs in sequence', async () => {
    const run = await runRepo.create({
      sessionId: 'test-session',
      persona: 'persona-a',
      project: 'test-project',
    });

    // Create first handoff
    const handoff1 = await handoffRepo.create({
      runId: run.id,
      fromPersona: 'persona-a',
      toPersona: 'persona-b',
      taskBrief: 'Task 1',
    });

    // Create second handoff
    const handoff2 = await handoffRepo.create({
      runId: run.id,
      fromPersona: 'persona-a',
      toPersona: 'persona-c',
      taskBrief: 'Task 2',
    });

    // Both should be pending
    const pending = await handoffRepo.listPending(run.id);
    expect(pending.length).toBeGreaterThanOrEqual(2);

    // Claim and complete first
    await handoffRepo.claim(handoff1.id, 'agent-b', 300000);
    await handoffRepo.complete(handoff1.id, { status: 'done' });

    // Only second should be pending now
    const remainingPending = await handoffRepo.listPending(run.id);
    expect(remainingPending.some(h => h.id === handoff2.id)).toBe(true);
    expect(remainingPending.every(h => h.id !== handoff1.id)).toBe(true);
  });

  it('should prevent double claiming of handoff', async () => {
    const run = await runRepo.create({
      sessionId: 'test-session',
      persona: 'persona-a',
      project: 'test-project',
    });

    const handoff = await handoffRepo.create({
      runId: run.id,
      toPersona: 'persona-b',
    });

    // First claim succeeds
    const claim1 = await handoffRepo.claim(handoff.id, 'agent-1', 300000);
    expect(claim1.status).toBe('locked');

    // Second claim fails
    const claim2 = await handoffRepo.claim(handoff.id, 'agent-2', 300000);
    expect(claim2.status).toBe('conflict');
  });

  it('should track events throughout handoff lifecycle', async () => {
    const run = await runRepo.create({
      sessionId: 'test-session',
      persona: 'persona-a',
      project: 'test-project',
    });

    // Log various events
    await eventsRepo.append({
      runId: run.id,
      eventType: 'run_started',
      actor: 'persona-a',
    });

    const handoff = await handoffRepo.create({
      runId: run.id,
      toPersona: 'persona-b',
    });

    await eventsRepo.append({
      runId: run.id,
      eventType: 'handoff_created',
      payload: { handoffId: handoff.id },
    });

    await handoffRepo.claim(handoff.id, 'agent-b', 300000);

    await eventsRepo.append({
      runId: run.id,
      eventType: 'handoff_claimed',
      payload: { handoffId: handoff.id },
    });

    await handoffRepo.complete(handoff.id, { status: 'done' });

    await eventsRepo.append({
      runId: run.id,
      eventType: 'handoff_completed',
      payload: { handoffId: handoff.id },
    });

    const events = await eventsRepo.listForRun(run.id);
    expect(events.length).toBeGreaterThanOrEqual(4);
    
    const eventTypes = events.map(e => e.eventType);
    expect(eventTypes).toContain('run_started');
    expect(eventTypes).toContain('handoff_created');
    expect(eventTypes).toContain('handoff_claimed');
    expect(eventTypes).toContain('handoff_completed');
  });
});

