import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getOperationsDb } from './client';
import * as schema from './schema';
import type {
  NewRun,
  NewVideo,
  Run,
  RunStatus,
  Video,
  VideoStatus,
} from './schema';

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
type RunUpdateData = Partial<
  Pick<Run, 'result' | 'startedAt' | 'completedAt' | 'metadata' | 'input' | 'personaId' | 'chatId'> & {
    status?: RunStatus;
  }
>;

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
    'status' | 'result' | 'input' | 'metadata' | 'startedAt' | 'completedAt' | 'personaId' | 'chatId'
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
      personaId: data.personaId ?? null,
      chatId: data.chatId ?? null,
      status: data.status ?? 'pending',
      result: data.result ?? null,
      input: (data.input ?? {}) as NewRun['input'],
      metadata: (data.metadata ?? {}) as NewRun['metadata'],
      startedAt: (data.startedAt ?? null) as NewVideo['startedAt'],
      completedAt: (data.completedAt ?? null) as NewVideo['completedAt'],
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

  async updateRun(runId: string, data: RunUpdateData): Promise<Run | null> {
    const updatePayload: Partial<NewRun> & { updatedAt?: string } = {};

    if ('status' in data) {
      updatePayload.status = data.status as RunStatus | undefined;
    }

    if ('result' in data) {
      updatePayload.result = data.result ?? null;
    }

    if ('input' in data) {
      updatePayload.input = (data.input ?? {}) as Record<string, unknown>;
    }

    if ('metadata' in data) {
      updatePayload.metadata = (data.metadata ?? {}) as Record<string, unknown>;
    }

    if ('startedAt' in data) {
      updatePayload.startedAt = (data.startedAt ?? null) as NewVideo['startedAt'];
    }

    if ('completedAt' in data) {
      updatePayload.completedAt = (data.completedAt ?? null) as NewVideo['completedAt'];
    }

    if ('personaId' in data) {
      updatePayload.personaId = (data.personaId ?? null) as NewRun['personaId'];
    }

    if ('chatId' in data) {
      updatePayload.chatId = (data.chatId ?? null) as NewRun['chatId'];
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

    const [row] = await this.db.insert(schema.videos).values(values).returning();
    return row;
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

  async listVideosByRun(
    runId: string,
    options: ListVideosByRunOptions = {},
  ): Promise<Video[]> {
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
}
