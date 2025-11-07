import { db } from '../client.js';
import { editJobs } from '../schema.js';
import { desc, eq, sql } from 'drizzle-orm';
import type { JobSummary } from './video-jobs-repository.js';

export interface EditJob {
  id: string;
  traceId: string;
  provider: string;
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  finalUrl: string | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertEditJobParams {
  traceId: string;
  provider: string;
  taskId: string;
  status: EditJob['status'];
  finalUrl?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export class EditJobsRepository {
  async upsertJob(params: UpsertEditJobParams): Promise<EditJob> {
    const now = new Date();
    const baseData = {
      traceId: params.traceId,
      provider: params.provider,
      taskId: params.taskId,
      status: params.status,
      finalUrl: params.finalUrl ?? null,
      error: params.error ?? null,
      startedAt: params.startedAt ?? null,
      completedAt: params.completedAt ?? null,
      metadata: params.metadata ?? {},
      // updated_at is handled by trigger, don't set manually
    };

    const [result] = await db
      .insert(editJobs)
      .values({ ...baseData, createdAt: now })
      .onConflictDoUpdate({
        target: [editJobs.provider, editJobs.taskId],
        set: baseData,
      })
      .returning();

    return result as EditJob;
  }

  async latestByTrace(traceId: string): Promise<EditJob | null> {
    const [result] = await db
      .select()
      .from(editJobs)
      .where(eq(editJobs.traceId, traceId))
      .orderBy(desc(editJobs.createdAt))
      .limit(1);

    return (result as EditJob) || null;
  }

  async summaryByTrace(traceId: string): Promise<JobSummary> {
    const [result] = await db
      .select({
        total: sql<number>`count(*)`,
        completed: sql<number>`count(*) filter (where ${editJobs.status} = 'succeeded')`,
        failed: sql<number>`count(*) filter (where ${editJobs.status} = 'failed')`,
        pending: sql<number>`count(*) filter (where ${editJobs.status} in ('queued','running'))`,
      })
      .from(editJobs)
      .where(eq(editJobs.traceId, traceId));

    return {
      total: Number(result?.total ?? 0),
      completed: Number(result?.completed ?? 0),
      failed: Number(result?.failed ?? 0),
      pending: Number(result?.pending ?? 0),
    };
  }
}
