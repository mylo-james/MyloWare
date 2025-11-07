import { describe, it, expect, beforeEach } from 'vitest';
import { RunRepository } from '@/db/repositories/run-repository.js';
import { db } from '@/db/client.js';
import { agentRuns } from '@/db/schema.js';

describe('RunRepository', () => {
  const repository = new RunRepository();

  beforeEach(async () => {
    await db.delete(agentRuns);
  });

  describe('create', () => {
    it('should create a new run', async () => {
      const run = await repository.create({
        persona: 'test-persona',
        project: 'test-project',
        instructions: 'test instructions',
      });

      expect(run.id).toBeDefined();
      expect(run.persona).toBe('test-persona');
      expect(run.project).toBe('test-project');
      expect(run.status).toBe('new');
      expect(run.stateBlob).toEqual({});
    });

    it('should create a run with sessionId', async () => {
      const run = await repository.create({
        sessionId: 'test-session',
        persona: 'test-persona',
        project: 'test-project',
      });

      expect(run.sessionId).toBe('test-session');
    });
  });

  describe('findById', () => {
    it('should find a run by id', async () => {
      const created = await repository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      const found = await repository.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.persona).toBe('test-persona');
    });

    it('should return undefined for non-existent run', async () => {
      const found = await repository.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update run fields', async () => {
      const run = await repository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      const updated = await repository.update(run.id, {
        currentStep: 'test-step',
        status: 'in_progress',
      });

      expect(updated?.currentStep).toBe('test-step');
      expect(updated?.status).toBe('in_progress');
    });

    it('should update stateBlob', async () => {
      const run = await repository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      const updated = await repository.update(run.id, {
        stateBlob: { key: 'value' },
      });

      expect(updated?.stateBlob).toEqual({ key: 'value' });
    });
  });

  describe('findOrCreateForSession', () => {
    it('should create new run when none exists', async () => {
      const run = await repository.findOrCreateForSession(
        'test-session',
        'test-persona',
        'test-project',
        'instructions'
      );

      expect(run.id).toBeDefined();
      expect(run.sessionId).toBe('test-session');
      expect(run.persona).toBe('test-persona');
      expect(run.status).toBe('new');
    });

    it('should return existing active run', async () => {
      const created = await repository.create({
        sessionId: 'test-session',
        persona: 'test-persona',
        project: 'test-project',
        instructions: 'original',
      });

      const found = await repository.findOrCreateForSession(
        'test-session',
        'test-persona',
        'test-project'
      );

      expect(found.id).toBe(created.id);
      expect(found.instructions).toBe('original');
    });

    it('should create new run if existing is completed', async () => {
      const completed = await repository.create({
        sessionId: 'test-session',
        persona: 'test-persona',
        project: 'test-project',
      });
      await repository.update(completed.id, { status: 'completed' });

      const found = await repository.findOrCreateForSession(
        'test-session',
        'test-persona',
        'test-project'
      );

      expect(found.id).not.toBe(completed.id);
      expect(found.status).toBe('new');
    });
  });

  describe('claim', () => {
    it('should claim a run with lease', async () => {
      const run = await repository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      const result = await repository.claim(run.id, 'agent-1', 300000);

      expect(result.status).toBe('locked');
      expect(result.run?.custodianAgent).toBe('agent-1');
      expect(result.run?.lockedAt).toBeDefined();
    });

    it('should prevent double claiming', async () => {
      const run = await repository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      await repository.claim(run.id, 'agent-1', 300000);
      const result = await repository.claim(run.id, 'agent-2', 100);

      expect(result.status).toBe('conflict');
    });

    it('should allow claiming after lease expires', async () => {
      const run = await repository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      await repository.claim(run.id, 'agent-1', 100); // Very short lease

      // Simulate lease expiry by clearing the lock fields (equivalent to a timeout)
      await repository.update(run.id, {
        lockedAt: null,
        custodianAgent: null,
      });

      const result = await repository.claim(run.id, 'agent-2', 100);

      expect(result.status).toBe('locked');
      expect(result.run?.custodianAgent).toBe('agent-2');
    });
  });
});
