import { db } from '../client.js';
import { videoGenerationJobs } from '../schema.js';
import { eq, sql } from 'drizzle-orm';

export interface VideoJob {
  id: string;
  traceId: string;
  scriptId: string | null;
  provider: string;
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  assetUrl: string | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertVideoJobParams {
  traceId: string;
  scriptId?: string | null;
  provider: string;
  taskId: string;
  status: VideoJob['status'];
  assetUrl?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface JobSummary {
  total: number;
  completed: number;
  failed: number;
  pending: number;
}

export class VideoJobsRepository {
  async upsertJob(params: UpsertVideoJobParams): Promise<VideoJob> {
    const now = new Date();
    const baseData = {
      traceId: params.traceId,
      scriptId: params.scriptId ?? null,
      provider: params.provider,
      taskId: params.taskId,
      status: params.status,
      assetUrl: params.assetUrl ?? null,
      error: params.error ?? null,
      startedAt: params.startedAt ?? null,
      completedAt: params.completedAt ?? null,
      metadata: params.metadata ?? {},
      updatedAt: now,
    };

    const [result] = await db
      .insert(videoGenerationJobs)
      .values({
        ...baseData,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [videoGenerationJobs.provider, videoGenerationJobs.taskId],
        set: baseData,
      })
      .returning();

    return result as VideoJob;
  }

  async summaryByTrace(traceId: string): Promise<JobSummary> {
    const [result] = await db
      .select({
        total: sql<number>`count(*)`,
        completed: sql<number>`count(*) filter (where ${videoGenerationJobs.status} = 'succeeded')`,
        failed: sql<number>`count(*) filter (where ${videoGenerationJobs.status} = 'failed')`,
        pending: sql<number>`count(*) filter (where ${videoGenerationJobs.status} in ('queued','running'))`,
      })
      .from(videoGenerationJobs)
      .where(eq(videoGenerationJobs.traceId, traceId));

    return {
      total: Number(result?.total ?? 0),
      completed: Number(result?.completed ?? 0),
      failed: Number(result?.failed ?? 0),
      pending: Number(result?.pending ?? 0),
    };
  }
}
