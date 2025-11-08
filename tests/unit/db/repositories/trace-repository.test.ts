import { describe, it, expect, beforeEach } from 'vitest';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { db } from '@/db/client.js';
import { executionTraces } from '@/db/schema.js';

describe('TraceRepository', () => {
  const repository = new TraceRepository();
  const project1Id = '00000000-0000-4000-8000-000000000011';
  const project2Id = '00000000-0000-4000-8000-000000000012';
  const project3Id = '00000000-0000-4000-8000-000000000013';

  beforeEach(async () => {
    await db.delete(executionTraces);
  });

  describe('create', () => {
    it('should create a new trace with all parameters', async () => {
      const trace = await repository.create({
        projectId: null,
        sessionId: 'test-session',
        metadata: { key: 'value' },
      });

      expect(trace.id).toBeDefined();
      expect(trace.traceId).toBeDefined();
      expect(trace.projectId).toBeNull();
      expect(trace.sessionId).toBe('test-session');
      expect(trace.status).toBe('active');
      expect(trace.metadata).toEqual({ key: 'value' });
      expect(trace.createdAt).toBeInstanceOf(Date);
    });

    it('should create a trace with minimal parameters', async () => {
      const trace = await repository.create({
        projectId: null,
      });

      expect(trace.traceId).toBeDefined();
      expect(trace.projectId).toBeNull();
      expect(trace.sessionId).toBeNull();
      expect(trace.status).toBe('active');
      expect(trace.metadata).toEqual({});
    });

    it('should generate unique traceId for each trace', async () => {
      const trace1 = await repository.create({ projectId: null });
      const trace2 = await repository.create({ projectId: null });

      expect(trace1.traceId).not.toBe(trace2.traceId);
    });
  });

  describe('findByTraceId', () => {
    it('should find a trace by traceId', async () => {
      const created = await repository.create({
        projectId: null,
        sessionId: 'test-session',
      });

      const found = await repository.findByTraceId(created.traceId);

      expect(found).toBeDefined();
      expect(found?.traceId).toBe(created.traceId);
      expect(found?.projectId).toBeNull();
    });

    it('should return null for non-existent traceId', async () => {
      const found = await repository.findByTraceId('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update trace status to completed', async () => {
      const trace = await repository.create({
        projectId: null,
      });

      const outputs = { url: 'https://example.com' };
      const updated = await repository.updateStatus(trace.traceId, 'completed', outputs);

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('completed');
      expect(updated?.completedAt).toBeInstanceOf(Date);
      expect(updated?.outputs).toEqual(outputs);
    });

    it('should update trace status to failed', async () => {
      const trace = await repository.create({
        projectId: null,
      });

      const updated = await repository.updateStatus(trace.traceId, 'failed');

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('failed');
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });

    it('should update without outputs if not provided', async () => {
      const trace = await repository.create({
        projectId: null,
      });

      const updated = await repository.updateStatus(trace.traceId, 'completed');

      expect(updated?.status).toBe('completed');
      expect(updated?.outputs).toBeNull();
    });
  });

  describe('findActiveTraces', () => {
    it('should find all active traces', async () => {
      await repository.create({ projectId: project1Id });
      await repository.create({ projectId: project2Id });
      const completed = await repository.create({ projectId: project3Id });
      await repository.updateStatus(completed.traceId, 'completed');

      const active = await repository.findActiveTraces();

      expect(active.length).toBe(2);
      expect(active.every(t => t.status === 'active')).toBe(true);
    });

    it('should filter by projectId when provided', async () => {
      await repository.create({ projectId: project1Id });
      await repository.create({ projectId: project2Id });
      await repository.create({ projectId: project1Id });

      const active = await repository.findActiveTraces(project1Id);

      expect(active.length).toBe(2);
      expect(active.every(t => t.projectId === project1Id)).toBe(true);
    });

    it('should return empty array when no active traces', async () => {
      const trace = await repository.create({ projectId: project1Id });
      await repository.updateStatus(trace.traceId, 'completed');

      const active = await repository.findActiveTraces();

      expect(active.length).toBe(0);
    });
  });
});

