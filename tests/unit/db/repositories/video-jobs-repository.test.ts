import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db/client.js';
import { videoGenerationJobs } from '@/db/schema.js';
import { VideoJobsRepository } from '@/db/repositories/video-jobs-repository.js';

const repo = new VideoJobsRepository();

describe('VideoJobsRepository', () => {
  beforeEach(async () => {
    await db.delete(videoGenerationJobs);
  });

  it('upserts new job', async () => {
    const job = await repo.upsertJob({
      traceId: '11111111-1111-1111-1111-111111111111',
      scriptId: '22222222-2222-2222-2222-222222222222',
      provider: 'runway',
      taskId: 'task-1',
      status: 'queued',
      metadata: { frames: 12 },
    });

    expect(job.id).toBeDefined();
    expect(job.provider).toBe('runway');
    expect(job.metadata).toEqual({ frames: 12 });
  });

  it('updates existing job when provider/task matches', async () => {
    const traceId = '11111111-1111-1111-1111-111111111111';
    await repo.upsertJob({
      traceId,
      provider: 'runway',
      taskId: 'task-1',
      status: 'queued',
    });

    const updated = await repo.upsertJob({
      traceId,
      provider: 'runway',
      taskId: 'task-1',
      status: 'succeeded',
      assetUrl: 'https://example.com/video.mp4',
    });

    expect(updated.status).toBe('succeeded');
    expect(updated.assetUrl).toBe('https://example.com/video.mp4');
  });

  it('summarizes jobs per trace', async () => {
    const traceId = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
    await Promise.all([
      repo.upsertJob({ traceId, provider: 'runway', taskId: 't1', status: 'queued' }),
      repo.upsertJob({ traceId, provider: 'runway', taskId: 't2', status: 'running' }),
      repo.upsertJob({ traceId, provider: 'runway', taskId: 't3', status: 'succeeded' }),
      repo.upsertJob({ traceId, provider: 'runway', taskId: 't4', status: 'failed' }),
    ]);

    const summary = await repo.summaryByTrace(traceId);
    expect(summary.total).toBe(4);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(2);
  });
});
