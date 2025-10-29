import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getOperationsDb } from './client';
import * as schema from './schema';
import type { Run, RunStatus, Video, VideoStatus } from './schema';

export interface ListVideosOptions {
  status?: VideoStatus[];
  limit?: number;
}

export interface DatabaseCheckResult {
  status: 'ok' | 'error';
  error?: string;
}
type RunUpdateData = Partial<
  Pick<Run, 'result' | 'startedAt' | 'completedAt' | 'metadata'> & {
    status?: RunStatus;
  }
>;

export class OperationsRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema> = getOperationsDb()) {}

  async getRunById(runId: string): Promise<Run | null> {
    const [row] = await this.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .limit(1);

    return row ?? null;
  }

  async updateRun(runId: string, data: RunUpdateData): Promise<Run | null> {
    if (Object.keys(data).length === 0) {
      return this.getRunById(runId);
    }

    const [row] = await this.db
      .update(schema.runs)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(schema.runs.id, runId))
      .returning();

    return row ?? null;
  }

  async listVideosByProject(projectId: string, options: ListVideosOptions = {}): Promise<Video[]> {
    const conditions = [eq(schema.videos.projectId, projectId)];

    if (options.status && options.status.length > 0) {
      conditions.push(inArray(schema.videos.status, options.status));
    }

    const whereClause =
      conditions.length === 1 ? conditions[0] : and(...conditions);

    const baseQuery = this.db
      .select()
      .from(schema.videos)
      .where(whereClause)
      .orderBy(desc(schema.videos.createdAt));

    if (options.limit && options.limit > 0) {
      return baseQuery.limit(Math.min(options.limit, 200));
    }

    return baseQuery;
  }

  async listVideosByRun(runId: string): Promise<Video[]> {
    return this.db
      .select()
      .from(schema.videos)
      .where(eq(schema.videos.runId, runId))
      .orderBy(desc(schema.videos.createdAt));
  }

  async checkConnection(): Promise<DatabaseCheckResult> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown operations database error',
      };
    }
  }
}
