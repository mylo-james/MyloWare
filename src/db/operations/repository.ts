import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getOperationsDb } from './client';
import * as schema from './schema';
import type { NewRun, NewVideo, Run, RunStatus, Video, VideoStatus } from './schema';

export interface ListVideosOptions {
  status?: VideoStatus[];
  limit?: number;
}

export interface ListVideosByRunOptions {
  status?: VideoStatus[];
  limit?: number;
}

export interface DatabaseCheckResult {
  status: 'ok' | 'error';
  error?: string;
}

type CreateRunData = {
  id?: string;
  projectId: string;
  personaId?: string | null;
  chatId?: string | null;
  status?: RunStatus;
  result?: string | null;
  input?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

type UpdateRunData = Partial<
  Pick<
    Run,
    'projectId' | 'personaId' | 'chatId' | 'status' | 'result' | 'input' | 'metadata' | 'startedAt' | 'completedAt'
  >
>;

type CreateVideoData = {
  id?: string;
  runId: string;
  projectId: string;
  idea: string;
  userIdea?: string | null;
  vibe?: string | null;
  prompt?: string | null;
  videoLink?: string | null;
  status?: VideoStatus;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

type UpdateVideoData = Partial<
  Pick<
    Video,
    | 'idea'
    | 'userIdea'
    | 'vibe'
    | 'prompt'
    | 'videoLink'
    | 'status'
    | 'errorMessage'
    | 'startedAt'
    | 'completedAt'
    | 'metadata'
  >
>;

export class OperationsRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema> = getOperationsDb()) {}

  async createRun(data: CreateRunData): Promise<Run> {
    const timestamp = new Date().toISOString();

    const values: NewRun = {
      id: data.id,
      projectId: data.projectId,
      personaId: (data.personaId ?? null) as NewRun['personaId'],
      chatId: (data.chatId ?? null) as NewRun['chatId'],
      status: data.status ?? 'pending',
      result: (data.result ?? null) as NewRun['result'],
      input: (data.input ?? {}) as NewRun['input'],
      metadata: (data.metadata ?? {}) as NewRun['metadata'],
      startedAt: (data.startedAt ?? null) as NewRun['startedAt'],
      completedAt: (data.completedAt ?? null) as NewRun['completedAt'],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const [row] = await this.db.insert(schema.runs).values(values).returning();
    return row;
  }

  async getRunById(runId: string): Promise<Run | null> {
    const [row] = await this.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .limit(1);

    return row ?? null;
  }

  async updateRun(runId: string, data: UpdateRunData): Promise<Run | null> {
    const updatePayload: Partial<NewRun> & { updatedAt?: string } = {};

    if (data.projectId !== undefined) {
      updatePayload.projectId = data.projectId;
    }
    if (data.personaId !== undefined) {
      updatePayload.personaId = (data.personaId ?? null) as NewRun['personaId'];
    }
    if (data.chatId !== undefined) {
      updatePayload.chatId = (data.chatId ?? null) as NewRun['chatId'];
    }
    if (data.status !== undefined) {
      updatePayload.status = data.status;
    }
    if (data.result !== undefined) {
      updatePayload.result = (data.result ?? null) as NewRun['result'];
    }
    if (data.input !== undefined) {
      updatePayload.input = (data.input ?? {}) as NewRun['input'];
    }
    if (data.metadata !== undefined) {
      updatePayload.metadata = (data.metadata ?? {}) as NewRun['metadata'];
    }
    if (data.startedAt !== undefined) {
      updatePayload.startedAt = (data.startedAt ?? null) as NewRun['startedAt'];
    }
    if (data.completedAt !== undefined) {
      updatePayload.completedAt = (data.completedAt ?? null) as NewRun['completedAt'];
    }

    if (Object.keys(updatePayload).length === 0) {
      return this.getRunById(runId);
    }

    updatePayload.updatedAt = new Date().toISOString();

    const [row] = await this.db
      .update(schema.runs)
      .set(updatePayload)
      .where(eq(schema.runs.id, runId))
      .returning();

    return row ?? null;
  }

  async getVideoById(videoId: string): Promise<Video | null> {
    const [row] = await this.db
      .select()
      .from(schema.videos)
      .where(eq(schema.videos.id, videoId))
      .limit(1);

    return row ?? null;
  }

  async createVideo(data: CreateVideoData): Promise<Video> {
    await this.ensureRunRecord(data.runId, data.projectId);
    const timestamp = new Date().toISOString();

    const values: NewVideo = {
      id: data.id,
      runId: data.runId,
      projectId: data.projectId,
      idea: data.idea,
      userIdea: (data.userIdea ?? null) as NewVideo['userIdea'],
      vibe: (data.vibe ?? null) as NewVideo['vibe'],
      prompt: (data.prompt ?? null) as NewVideo['prompt'],
      videoLink: (data.videoLink ?? undefined) as NewVideo['videoLink'],
      status: data.status ?? 'idea_gen',
      errorMessage: (data.errorMessage ?? undefined) as NewVideo['errorMessage'],
      startedAt: (data.startedAt ?? null) as NewVideo['startedAt'],
      completedAt: (data.completedAt ?? null) as NewVideo['completedAt'],
      metadata: (data.metadata ?? {}) as NewVideo['metadata'],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Retry logic for foreign key constraint violations (race condition with parallel creates)
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const [row] = await this.db.insert(schema.videos).values(values).returning();
        return row;
      } catch (error) {
        lastError = error;
        // Check for foreign key violation (code 23503)
        if (isForeignKeyViolation(error)) {
          // Wait briefly for the run record to be committed, then retry
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
          // Re-verify the run exists
          await this.ensureRunRecord(data.runId, data.projectId);
          continue;
        }
        // For other errors, throw immediately
        throw error;
      }
    }

    // If we exhausted retries, throw the last error
    throw lastError;
  }

  async createVideos(data: CreateVideoData[]): Promise<Video[]> {
    if (data.length === 0) {
      return [];
    }

    // Ensure run record exists (all videos share the same runId and projectId)
    const firstVideo = data[0];
    await this.ensureRunRecord(firstVideo.runId, firstVideo.projectId);
    const timestamp = new Date().toISOString();

    const values: NewVideo[] = data.map((item) => ({
      id: item.id,
      runId: item.runId,
      projectId: item.projectId,
      idea: item.idea,
      userIdea: (item.userIdea ?? null) as NewVideo['userIdea'],
      vibe: (item.vibe ?? null) as NewVideo['vibe'],
      prompt: (item.prompt ?? null) as NewVideo['prompt'],
      videoLink: (item.videoLink ?? undefined) as NewVideo['videoLink'],
      status: item.status ?? 'idea_gen',
      errorMessage: (item.errorMessage ?? undefined) as NewVideo['errorMessage'],
      startedAt: (item.startedAt ?? null) as NewVideo['startedAt'],
      completedAt: (item.completedAt ?? null) as NewVideo['completedAt'],
      metadata: (item.metadata ?? {}) as NewVideo['metadata'],
      createdAt: timestamp,
      updatedAt: timestamp,
    }));

    const rows = await this.db.insert(schema.videos).values(values).returning();
    return rows;
  }

  async updateVideo(videoId: string, data: UpdateVideoData): Promise<Video | null> {
    const updatePayload: Partial<NewVideo> & { updatedAt?: string } = {};

    if ('idea' in data) {
      updatePayload.idea = (data.idea ?? null) as NewVideo['idea'];
    }

    if ('userIdea' in data) {
      updatePayload.userIdea = (data.userIdea ?? null) as NewVideo['userIdea'];
    }

    if ('vibe' in data) {
      updatePayload.vibe = (data.vibe ?? null) as NewVideo['vibe'];
    }

    if ('prompt' in data) {
      updatePayload.prompt = (data.prompt ?? null) as NewVideo['prompt'];
    }

    if ('videoLink' in data) {
      updatePayload.videoLink = (data.videoLink ?? undefined) as NewVideo['videoLink'];
    }

    if ('status' in data) {
      updatePayload.status = data.status as VideoStatus | undefined;
    }

    if ('errorMessage' in data) {
      updatePayload.errorMessage = (data.errorMessage ?? undefined) as NewVideo['errorMessage'];
    }

    if ('startedAt' in data) {
      updatePayload.startedAt = (data.startedAt ?? null) as NewVideo['startedAt'];
    }

    if ('completedAt' in data) {
      updatePayload.completedAt = (data.completedAt ?? null) as NewVideo['completedAt'];
    }

    if ('metadata' in data) {
      updatePayload.metadata = (data.metadata ?? {}) as NewVideo['metadata'];
    }

    if (Object.keys(updatePayload).length === 0) {
      return this.getVideoById(videoId);
    }

    updatePayload.updatedAt = new Date().toISOString();

    const [row] = await this.db
      .update(schema.videos)
      .set(updatePayload)
      .where(eq(schema.videos.id, videoId))
      .returning();

    return row ?? null;
  }

  async listVideosByProject(projectId: string, options: ListVideosOptions = {}): Promise<Video[]> {
    const conditions = [eq(schema.videos.projectId, projectId)];

    if (options.status && options.status.length > 0) {
      conditions.push(inArray(schema.videos.status, options.status));
    }

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

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

  async listVideosByRun(runId: string, options: ListVideosByRunOptions = {}): Promise<Video[]> {
    const conditions = [eq(schema.videos.runId, runId)];

    if (options.status && options.status.length > 0) {
      conditions.push(inArray(schema.videos.status, options.status));
    }

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

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

  private async ensureRunRecord(runId: string, projectId: string): Promise<void> {
    const existingRun = await this.getRunById(runId);
    if (existingRun) {
      return;
    }

    try {
      await this.createRun({ id: runId, projectId });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Race condition: another request created the run. Verify it exists now.
      const retryRun = await this.getRunById(runId);
      if (!retryRun) {
        throw new Error(`Run ${runId} should exist after unique violation but was not found`);
      }
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505',
  );
}

function isForeignKeyViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23503',
  );
}
