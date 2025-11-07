import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db/client.js';
import { editJobs } from '@/db/schema.js';
import { EditJobsRepository } from '@/db/repositories/edit-jobs-repository.js';

const repo = new EditJobsRepository();

describe('EditJobsRepository', () => {
  beforeEach(async () => {
    await db.delete(editJobs);
  });

  it('upserts edit job with metadata', async () => {
    const job = await repo.upsertJob({
      traceId: '33333333-3333-3333-3333-333333333333',
      provider: 'descript',
      taskId: 'edit-1',
      status: 'running',
      metadata: { clips: 5 },
    });

    expect(job.id).toBeDefined();
    expect(job.provider).toBe('descript');
    expect(job.metadata).toEqual({ clips: 5 });
  });

  it('returns latest job by trace', async () => {
    const traceId = '44444444-4444-4444-4444-444444444444';
    await repo.upsertJob({ traceId, provider: 'descript', taskId: 'edit-older', status: 'running' });
    const latest = await repo.upsertJob({ traceId, provider: 'descript', taskId: 'edit-new', status: 'succeeded' });

    const fetched = await repo.latestByTrace(traceId);
    expect(fetched?.taskId).toBe(latest.taskId);
  });

  it('summarizes edit jobs per trace', async () => {
    const traceId = '55555555-5555-5555-5555-555555555555';
    await Promise.all([
      repo.upsertJob({ traceId, provider: 'descript', taskId: 'e1', status: 'queued' }),
      repo.upsertJob({ traceId, provider: 'descript', taskId: 'e2', status: 'succeeded' }),
      repo.upsertJob({ traceId, provider: 'descript', taskId: 'e3', status: 'failed' }),
    ]);

    const summary = await repo.summaryByTrace(traceId);
    expect(summary.total).toBe(3);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(1);
  });
});
