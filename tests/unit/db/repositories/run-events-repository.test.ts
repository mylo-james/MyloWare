import { describe, it, expect, beforeEach } from 'vitest';
import { RunEventsRepository } from '@/db/repositories/run-events-repository.js';
import { RunRepository } from '@/db/repositories/run-repository.js';
import { db } from '@/db/client.js';
import { runEvents, agentRuns } from '@/db/schema.js';

describe('RunEventsRepository', () => {
  const repository = new RunEventsRepository();
  const runRepository = new RunRepository();

  beforeEach(async () => {
    await db.delete(runEvents);
    await db.delete(agentRuns);
  });

  describe('append', () => {
    it('should append an event to a run', async () => {
      const run = await runRepository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      const event = await repository.append({
        runId: run.id,
        eventType: 'test_event',
        actor: 'agent-1',
        payload: { key: 'value' },
      });

      expect(event.id).toBeDefined();
      expect(event.runId).toBe(run.id);
      expect(event.eventType).toBe('test_event');
      expect(event.actor).toBe('agent-1');
      expect(event.payload).toEqual({ key: 'value' });
      expect(event.createdAt).toBeDefined();
    });

    it('should append event without payload', async () => {
      const run = await runRepository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      const event = await repository.append({
        runId: run.id,
        eventType: 'simple_event',
      });

      expect(event.payload).toEqual({});
    });

    it('should append event without actor', async () => {
      const run = await runRepository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

    const event = await repository.append({
      runId: run.id,
      eventType: 'system_event',
      payload: { message: 'test' },
    });

    expect(event.actor).toBeNull();
    expect(event.payload).toEqual({ message: 'test' });
  });
  });

  describe('listForRun', () => {
    it('should list events for a run', async () => {
      const run = await runRepository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      await repository.append({
        runId: run.id,
        eventType: 'event_1',
        payload: { step: 1 },
      });
      await repository.append({
        runId: run.id,
        eventType: 'event_2',
        payload: { step: 2 },
      });

      const events = await repository.listForRun(run.id);

      expect(events.length).toBe(2);
      expect(events[0].eventType).toBe('event_1');
      expect(events[1].eventType).toBe('event_2');
    });

    it('should return events in chronological order', async () => {
      const run = await runRepository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      await repository.append({
        runId: run.id,
        eventType: 'first',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      await repository.append({
        runId: run.id,
        eventType: 'second',
      });

      const events = await repository.listForRun(run.id);

      expect(events[0].eventType).toBe('first');
      expect(events[1].eventType).toBe('second');
      expect(events[0].createdAt.getTime()).toBeLessThanOrEqual(events[1].createdAt.getTime());
    });

    it('should return empty array for run with no events', async () => {
      const run = await runRepository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      const events = await repository.listForRun(run.id);

      expect(events).toEqual([]);
    });

    it('should only return events for the specified run', async () => {
      const run1 = await runRepository.create({
        persona: 'test-persona',
        project: 'test-project',
      });
      const run2 = await runRepository.create({
        persona: 'test-persona',
        project: 'test-project',
      });

      await repository.append({
        runId: run1.id,
        eventType: 'run1_event',
      });
      await repository.append({
        runId: run2.id,
        eventType: 'run2_event',
      });

      const events = await repository.listForRun(run1.id);

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('run1_event');
    });
  });
});
