import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { WorkflowRunRepository } from '@/db/repositories/workflow-run-repository.js';
import { db } from '@/db/client.js';
import { workflowRuns } from '@/db/schema.js';

describe('WorkflowRunRepository', () => {
  const repository = new WorkflowRunRepository();

  beforeAll(async () => {
    // Ensure database is ready
  });

  beforeEach(async () => {
    await db.delete(workflowRuns);
  });

  describe('create', () => {
    it('should create workflow run', async () => {
      const run = await repository.create({
        workflowName: 'test-workflow',
        input: { test: 'data' },
        metadata: { source: 'test' }
      });

      expect(run.id).toBeDefined();
      expect(run.workflowName).toBe('test-workflow');
      expect(run.status).toBe('pending');
      expect(run.input).toEqual({ test: 'data' });
      expect(run.metadata).toEqual({ source: 'test' });
    });

    it('should create workflow run with session ID', async () => {
      const run = await repository.create({
        sessionId: 'test-session',
        workflowName: 'test-workflow',
        input: {}
      });

      expect(run.sessionId).toBe('test-session');
    });
  });

  describe('updateStatus', () => {
    it('should update status to running', async () => {
      const run = await repository.create({
        workflowName: 'test-workflow'
      });

      const updated = await repository.updateStatus(run.id, 'running');

      expect(updated.status).toBe('running');
    });

    it('should update status to completed with output', async () => {
      const run = await repository.create({
        workflowName: 'test-workflow'
      });

      const updated = await repository.updateStatus(run.id, 'completed', {
        output: { result: 'success' }
      });

      expect(updated.status).toBe('completed');
      expect(updated.output).toEqual({ result: 'success' });
      expect(updated.completedAt).toBeDefined();
    });

    it('should update status to failed with error', async () => {
      const run = await repository.create({
        workflowName: 'test-workflow'
      });

      const updated = await repository.updateStatus(run.id, 'failed', {
        error: 'Something went wrong'
      });

      expect(updated.status).toBe('failed');
      expect(updated.error).toBe('Something went wrong');
      expect(updated.completedAt).toBeDefined();
    });
  });

  describe('findById', () => {
    it('should find workflow run by ID', async () => {
      const run = await repository.create({
        workflowName: 'test-workflow'
      });

      const found = await repository.findById(run.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(run.id);
      expect(found?.workflowName).toBe('test-workflow');
    });

    it('should return null for non-existent ID', async () => {
      const found = await repository.findById('00000000-0000-0000-0000-000000000000');

      expect(found).toBeNull();
    });
  });

  describe('findBySessionId', () => {
    it('should find workflow runs by session ID', async () => {
      const sessionId = 'test-session';
      
      await repository.create({
        sessionId,
        workflowName: 'workflow-1'
      });
      
      await repository.create({
        sessionId,
        workflowName: 'workflow-2'
      });

      const runs = await repository.findBySessionId(sessionId);

      expect(runs.length).toBe(2);
      expect(runs[0].workflowName).toBe('workflow-2'); // Most recent first
      expect(runs[1].workflowName).toBe('workflow-1');
    });

    it('should return empty array for non-existent session', async () => {
      const runs = await repository.findBySessionId('non-existent-session');

      expect(runs).toEqual([]);
    });
  });

  describe('findRecent', () => {
    it('should find recent workflow runs', async () => {
      await repository.create({ workflowName: 'workflow-1' });
      await repository.create({ workflowName: 'workflow-2' });
      await repository.create({ workflowName: 'workflow-3' });

      const runs = await repository.findRecent(2);

      expect(runs.length).toBe(2);
      expect(runs[0].workflowName).toBe('workflow-3'); // Most recent first
      expect(runs[1].workflowName).toBe('workflow-2');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await repository.create({ workflowName: `workflow-${i}` });
      }

      const runs = await repository.findRecent(3);

      expect(runs.length).toBe(3);
    });
  });
});
