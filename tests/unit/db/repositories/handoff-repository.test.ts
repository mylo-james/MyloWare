import { describe, it, expect, beforeEach } from 'vitest';
import { HandoffRepository } from '@/db/repositories/handoff-repository.js';
import { RunRepository } from '@/db/repositories/run-repository.js';
import { db } from '@/db/client.js';
import { handoffTasks, agentRuns } from '@/db/schema.js';

describe('HandoffRepository', () => {
  const repository = new HandoffRepository();
  const runRepository = new RunRepository();

  beforeEach(async () => {
    await db.delete(handoffTasks);
    await db.delete(agentRuns);
  });

  describe('create', () => {
    it('should create a new handoff', async () => {
      const run = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });

      const handoff = await repository.create({
        runId: run.id,
        fromPersona: 'persona-a',
        toPersona: 'persona-b',
        taskBrief: 'Do something',
      });

      expect(handoff.id).toBeDefined();
      expect(handoff.runId).toBe(run.id);
      expect(handoff.fromPersona).toBe('persona-a');
      expect(handoff.toPersona).toBe('persona-b');
      expect(handoff.taskBrief).toBe('Do something');
      expect(handoff.status).toBe('pending');
    });

    it('should create with requiredOutputs', async () => {
      const run = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });

      const handoff = await repository.create({
        runId: run.id,
        toPersona: 'persona-b',
        requiredOutputs: { result: 'required' },
      });

      expect(handoff.requiredOutputs).toEqual({ result: 'required' });
    });
  });

  describe('findById', () => {
    it('should find a handoff by id', async () => {
      const run = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });

      const created = await repository.create({
        runId: run.id,
        toPersona: 'persona-b',
      });

      const found = await repository.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.toPersona).toBe('persona-b');
    });

    it('should return undefined for non-existent handoff', async () => {
      const found = await repository.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeUndefined();
    });
  });

  describe('listPending', () => {
    it('should list all pending handoffs', async () => {
      const run1 = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });
      const run2 = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });

      await repository.create({
        runId: run1.id,
        toPersona: 'persona-b',
      });
      await repository.create({
        runId: run2.id,
        toPersona: 'persona-b',
      });

      const pending = await repository.listPending();

      expect(pending.length).toBeGreaterThanOrEqual(2);
      expect(pending.every(h => h.status === 'pending')).toBe(true);
    });

    it('should filter by runId', async () => {
      const run1 = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });
      const run2 = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });

      await repository.create({
        runId: run1.id,
        toPersona: 'persona-b',
      });
      await repository.create({
        runId: run2.id,
        toPersona: 'persona-b',
      });

      const pending = await repository.listPending(run1.id);

      expect(pending.length).toBe(1);
      expect(pending[0].runId).toBe(run1.id);
    });

    it('should filter by persona', async () => {
      const run = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });

      await repository.create({
        runId: run.id,
        toPersona: 'persona-b',
      });
      await repository.create({
        runId: run.id,
        toPersona: 'persona-c',
      });

      const pending = await repository.listPending(undefined, 'persona-b');

      expect(pending.length).toBeGreaterThanOrEqual(1);
      expect(pending.every(h => h.toPersona === 'persona-b')).toBe(true);
    });
  });

  describe('claim', () => {
    it('should claim a pending handoff', async () => {
      const run = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });

      const handoff = await repository.create({
        runId: run.id,
        toPersona: 'persona-b',
      });

      const result = await repository.claim(handoff.id, 'agent-1', 300000);

      expect(result.status).toBe('locked');
      expect(result.handoff?.custodianAgent).toBe('agent-1');
      expect(result.handoff?.status).toBe('in_progress');
      expect(result.handoff?.lockedAt).toBeDefined();
    });

    it('should prevent double claiming', async () => {
      const run = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });

      const handoff = await repository.create({
        runId: run.id,
        toPersona: 'persona-b',
      });

      await repository.claim(handoff.id, 'agent-1', 300000);
      const result = await repository.claim(handoff.id, 'agent-2', 300000);

      expect(result.status).toBe('conflict');
    });

    it('should not claim already completed handoff', async () => {
      const run = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });

      const handoff = await repository.create({
        runId: run.id,
        toPersona: 'persona-b',
      });

      await repository.complete(handoff.id, { status: 'done' });
      const result = await repository.claim(handoff.id, 'agent-1', 300000);

      expect(result.status).toBe('conflict');
    });
  });

  describe('complete', () => {
    it('should complete a handoff with status done', async () => {
      const run = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });

      const handoff = await repository.create({
        runId: run.id,
        toPersona: 'persona-b',
      });

      const completed = await repository.complete(handoff.id, {
        status: 'done',
        outputs: { result: 'success' },
        notes: 'Completed successfully',
      });

      expect(completed?.status).toBe('done');
      expect(completed?.completedAt).toBeDefined();
      expect(completed?.metadata).toEqual({
        outputs: { result: 'success' },
        notes: 'Completed successfully',
      });
    });

    it('should complete with status returned', async () => {
      const run = await runRepository.create({
        persona: 'persona-a',
        project: 'test-project',
      });

      const handoff = await repository.create({
        runId: run.id,
        toPersona: 'persona-b',
      });

      const completed = await repository.complete(handoff.id, {
        status: 'returned',
      });

      expect(completed?.status).toBe('returned');
      expect(completed?.completedAt).toBeDefined();
    });
  });
});

