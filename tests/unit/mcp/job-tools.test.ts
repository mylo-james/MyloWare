import { describe, it, expect, beforeEach } from 'vitest';
import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { videoGenerationJobs, editJobs } from '@/db/schema.js';

const getTool = (name: string) => {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
};

describe('Job Ledger Tools', () => {
  beforeEach(async () => {
    await db.delete(videoGenerationJobs);
    await db.delete(editJobs);
  });

  it('upserts video jobs via job_upsert', async () => {
    const tool = getTool('job_upsert');
    const response = await tool.handler(
      {
        kind: 'video',
        traceId: 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa',
        scriptId: 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb',
        provider: 'runway',
        taskId: 'task-video-1',
        status: 'running',
        url: 'https://example.com/render.mp4',
        metadata: { batch: 1 },
      },
      'req-job-upsert-video'
    );

    expect(response.structuredContent).toMatchObject({
      provider: 'runway',
      taskId: 'task-video-1',
      assetUrl: 'https://example.com/render.mp4',
    });
  });

  it('upserts edit jobs via job_upsert', async () => {
    const tool = getTool('job_upsert');
    const response = await tool.handler(
      {
        kind: 'edit',
        traceId: 'cccccccc-0000-0000-0000-cccccccccccc',
        provider: 'descript',
        taskId: 'task-edit-1',
        status: 'queued',
        metadata: { passes: 2 },
      },
      'req-job-upsert-edit'
    );

    expect(response.structuredContent).toMatchObject({
      provider: 'descript',
      taskId: 'task-edit-1',
      status: 'queued',
    });
  });

  it('summarizes jobs across video and edit tables', async () => {
    const upsert = getTool('job_upsert');
    await upsert.handler(
      {
        kind: 'video',
        traceId: 'dddddddd-0000-0000-0000-dddddddddddd',
        provider: 'runway',
        taskId: 'task-1',
        status: 'queued',
      },
      'req-job-video-summary-1'
    );
    await upsert.handler(
      {
        kind: 'video',
        traceId: 'dddddddd-0000-0000-0000-dddddddddddd',
        provider: 'runway',
        taskId: 'task-2',
        status: 'succeeded',
      },
      'req-job-video-summary-2'
    );
    await upsert.handler(
      {
        kind: 'edit',
        traceId: 'dddddddd-0000-0000-0000-dddddddddddd',
        provider: 'descript',
        taskId: 'task-3',
        status: 'failed',
      },
      'req-job-edit-summary-1'
    );

    const summaryTool = getTool('jobs_summary');
    const result = await summaryTool.handler(
      { traceId: 'dddddddd-0000-0000-0000-dddddddddddd' },
      'req-job-summary'
    );

    expect(result.structuredContent).toMatchObject({
      total: 3,
      completed: 1,
      failed: 1,
      pending: 1,
    });
  });
});
