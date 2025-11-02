import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDb } from './client';
import * as schema from './schema';
import { PromptEmbeddingsRepository } from './repository';
import { embedTexts } from '../vector/embedTexts';

type Db = NodePgDatabase<typeof schema>;

type ConversationTurnRow = {
  id: string;
  session_id: string;
  user_id: string | null;
  role: schema.ConversationRole;
  turn_index: number;
  content: string;
  summary: unknown;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
};

type SessionSummaryRow = {
  session_id: string;
  turn_count: number | string;
  started_at: string | null;
  ended_at: string | null;
  user_id: string | null;
};
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_MIN_SIMILARITY = 0.2;

export interface StoreConversationTurnInput {
  sessionId: string;
  content: string;
  role: schema.ConversationRole;
  userId?: string | null;
  summary?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  embeddingText?: string;
}

export interface StoreConversationTurnOptions {
  embed?: typeof embedTexts;
}

export interface ConversationTurnRecord {
  id: string;
  sessionId: string;
  userId: string | null;
  role: schema.ConversationRole;
  turnIndex: number;
  content: string;
  summary: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StoreConversationTurnResult {
  turn: ConversationTurnRecord;
  chunkId: string;
  promptKey: string;
  isNewSession: boolean;
}

export interface SessionHistoryOptions {
  limit?: number;
  order?: 'asc' | 'desc';
  from?: Date;
  to?: Date;
}

export interface ConversationSearchOptions {
  limit?: number;
  minSimilarity?: number;
  sessionId?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  embed?: typeof embedTexts;
}

export interface ConversationSearchResult {
  turn: ConversationTurnRecord;
  similarity: number;
  chunkId: string;
  promptKey: string;
}

export interface SessionSummary {
  sessionId: string;
  userId: string | null;
  turnCount: number;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ListSessionsOptions {
  userId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface EpisodicRepositoryDependencies {
  db?: Db;
  embed?: typeof embedTexts;
  promptRepositoryFactory?: (db: Db) => PromptEmbeddingsRepository;
}

export class EpisodicMemoryRepository {
  private readonly db: Db;
  private readonly embedFn: typeof embedTexts;
  private readonly promptRepoFactory: (db: Db) => PromptEmbeddingsRepository;

  constructor(dependencies: EpisodicRepositoryDependencies = {}) {
    this.db = dependencies.db ?? (getDb() as Db);
    this.embedFn = dependencies.embed ?? embedTexts;
    this.promptRepoFactory =
      dependencies.promptRepositoryFactory ?? ((db) => new PromptEmbeddingsRepository(db));
  }

  async storeConversationTurn(
    input: StoreConversationTurnInput,
    options: StoreConversationTurnOptions = {},
  ): Promise<StoreConversationTurnResult> {
    const embed = options.embed ?? this.embedFn;

    const trimmedContent = input.content.trim();
    if (trimmedContent.length === 0) {
      throw new Error('Conversation turn content must not be empty.');
    }

    return this.db.transaction(async (tx) => {
      const preview = buildPreview(trimmedContent);
      const keywords = extractKeywords(trimmedContent);

      const turnMetadata: Record<string, unknown> = {
        ...(input.metadata ?? {}),
        preview,
        ...(keywords.length > 0 ? { keywords } : {}),
        ...(input.summary != null ? { summary: input.summary } : {}),
      };

      const { rows: nextRows } = await tx.execute(
        sql<{ next_index: number }>`
          SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_index
          FROM conversation_turns
          WHERE session_id = ${input.sessionId}::uuid
        `,
      );
      const nextIndex = Number(nextRows[0]?.next_index ?? 0);
      const isNewSession = nextIndex === 0;

      const { rows: insertedRowsRaw } = await tx.execute(
        sql<ConversationTurnRow>`
          INSERT INTO conversation_turns (
            session_id,
            user_id,
            role,
            turn_index,
            content,
            summary,
            metadata
          )
          VALUES (
            ${input.sessionId}::uuid,
            ${input.userId ?? null},
            ${input.role}::conversation_role,
            ${nextIndex},
            ${trimmedContent},
            ${input.summary ?? null}::jsonb,
            ${turnMetadata}::jsonb
          )
          RETURNING
            id,
            session_id,
            user_id,
            role,
            turn_index,
            content,
            summary,
            metadata,
            created_at,
            updated_at
        `,
      );

      const insertedRows = insertedRowsRaw as ConversationTurnRow[];
      const row = insertedRows[0];
      if (!row) {
        throw new Error('Failed to insert conversation turn.');
      }

      const embeddingInput = input.embeddingText?.trim() ?? trimmedContent;
      const [embedding] = await embed([embeddingInput]);
      if (!embedding || embedding.length === 0) {
        throw new Error('Failed to generate embedding for conversation turn.');
      }

      const sessionId = row.session_id;
      const turnId = row.id;
      const turnIndex = row.turn_index;
      const chunkId = buildChunkId(sessionId, turnId);
      const promptKey = buildPromptKey(sessionId);
      const checksum = createHash('sha256')
        .update(`${sessionId}:${turnIndex}:${embeddingInput}`)
        .digest('hex');

      const embeddingMetadata: Record<string, unknown> = {
        session_id: sessionId,
        turn_id: turnId,
        turn_index: turnIndex,
        role: row.role,
        user_id: row.user_id ?? null,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
        ...turnMetadata,
      };

      const promptRepo = this.promptRepoFactory(tx);
      await promptRepo.upsertEmbeddings([
        {
          chunkId,
          promptKey,
          chunkText: trimmedContent,
          rawSource: trimmedContent,
          granularity: 'turn',
          embedding,
          metadata: embeddingMetadata,
          checksum,
          memoryType: 'episodic',
        },
      ]);

      const turnRecord = mapTurnRow(row);

      return {
        turn: turnRecord,
        chunkId,
        promptKey,
        isNewSession,
      };
    });
  }

  async getSessionHistory(
    sessionId: string,
    options: SessionHistoryOptions = {},
  ): Promise<ConversationTurnRecord[]> {
    const conditions = [sql`session_id = ${sessionId}::uuid`];

    if (options.from) {
      conditions.push(sql`created_at >= ${toTimestamp(options.from)}::timestamptz`);
    }
    if (options.to) {
      conditions.push(sql`created_at <= ${toTimestamp(options.to)}::timestamptz`);
    }

    const whereClause =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    const orderClause = options.order === 'desc' ? sql`DESC` : sql`ASC`;
    const limitClause =
      typeof options.limit === 'number' && options.limit > 0 ? sql`LIMIT ${options.limit}` : sql``;

    const { rows: historyRowsRaw } = await this.db.execute(
      sql<ConversationTurnRow>`
        SELECT
          id,
          session_id,
          user_id,
          role,
          turn_index,
          content,
          summary,
          metadata,
          created_at,
          updated_at
        FROM conversation_turns
        ${whereClause}
        ORDER BY turn_index ${orderClause}
        ${limitClause}
      `,
    );

    const rows = historyRowsRaw as ConversationTurnRow[];
    return rows.map((row): ConversationTurnRecord => mapTurnRow(row));
  }

  async getTurnById(turnId: string): Promise<ConversationTurnRecord | null> {
    const { rows } = await this.db.execute(
      sql<ConversationTurnRow>`
        SELECT
          id,
          session_id,
          user_id,
          role,
          turn_index,
          content,
          summary,
          metadata,
          created_at,
          updated_at
        FROM conversation_turns
        WHERE id = ${turnId}::uuid
        LIMIT 1
      `,
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return mapTurnRow(row as ConversationTurnRow);
  }

  async searchConversationHistory(
    query: string,
    options: ConversationSearchOptions = {},
  ): Promise<ConversationSearchResult[]> {
    const normalized = query.trim();
    if (normalized.length === 0) {
      return [];
    }

    const embed = options.embed ?? this.embedFn;
    const [embedding] = await embed([normalized]);
    if (!embedding || embedding.length === 0) {
      return [];
    }

    const promptRepo = this.promptRepoFactory(this.db);
    const results = await promptRepo.search({
      embedding,
      limit: clamp(options.limit ?? DEFAULT_SEARCH_LIMIT, 1, 50),
      minSimilarity: clampSimilarity(options.minSimilarity ?? DEFAULT_MIN_SIMILARITY),
      memoryTypes: ['episodic'],
    });

    const filtered = results.filter((result) => {
      const metadata = toRecord(result.metadata);
      const session = extractString(metadata, 'session_id');
      const user = extractString(metadata, 'user_id');
      const createdAt = extractString(metadata, 'created_at');

      if (options.sessionId && session !== options.sessionId) {
        return false;
      }
      if (options.userId && user !== options.userId) {
        return false;
      }
      if (options.from && createdAt && new Date(createdAt) < options.from) {
        return false;
      }
      if (options.to && createdAt && new Date(createdAt) > options.to) {
        return false;
      }

      return true;
    });

    const turnIds = filtered
      .map((result) => {
        const metadata = toRecord(result.metadata);
        return extractString(metadata, 'turn_id');
      })
      .filter((value): value is string => Boolean(value));

    if (turnIds.length === 0) {
      return [];
    }

    const turnIdList = sql.join(
      turnIds.map((turnId) => sql`${turnId}::uuid`),
      sql`, `,
    );

    const { rows: turnRowsRaw } = await this.db.execute(
      sql<ConversationTurnRow>`
        SELECT
          id,
          session_id,
          user_id,
          role,
          turn_index,
          content,
          summary,
          metadata,
          created_at,
          updated_at
        FROM conversation_turns
        WHERE id IN (${turnIdList})
      `,
    );

    const rows = turnRowsRaw as ConversationTurnRow[];
    const turnMapEntries = rows.map<[string, ConversationTurnRecord]>((row) => [
      row.id,
      mapTurnRow(row),
    ]);
    const turnMap = new Map<string, ConversationTurnRecord>(turnMapEntries);

    const aggregated: ConversationSearchResult[] = [];
    for (const result of filtered) {
      const metadata = toRecord(result.metadata);
      const turnId = extractString(metadata, 'turn_id');
      if (!turnId) {
        continue;
      }

      const turn = turnMap.get(turnId);
      if (!turn) {
        continue;
      }

      aggregated.push({
        turn,
        similarity: Number(result.similarity),
        chunkId: result.chunkId,
        promptKey: result.promptKey,
      });
    }

    return aggregated;
  }

  async listSessions(options: ListSessionsOptions = {}): Promise<SessionSummary[]> {
    const conditions: ReturnType<typeof sql>[] = [];

    if (options.userId) {
      conditions.push(sql`user_id = ${options.userId}`);
    }
    if (options.from) {
      conditions.push(sql`created_at >= ${toTimestamp(options.from)}::timestamptz`);
    }
    if (options.to) {
      conditions.push(sql`created_at <= ${toTimestamp(options.to)}::timestamptz`);
    }

    const whereClause =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    const limitClause =
      typeof options.limit === 'number' && options.limit > 0 ? sql`LIMIT ${options.limit}` : sql``;

    const { rows: summaryRowsRaw } = await this.db.execute(
      sql<SessionSummaryRow>`
        SELECT
          session_id,
          COUNT(*) AS turn_count,
          MIN(created_at) AS started_at,
          MAX(created_at) AS ended_at,
          MAX(user_id) FILTER (WHERE user_id IS NOT NULL) AS user_id
        FROM conversation_turns
        ${whereClause}
        GROUP BY session_id
        ORDER BY ended_at DESC NULLS LAST
        ${limitClause}
      `,
    );

    const summaryRows = summaryRowsRaw as SessionSummaryRow[];

    return summaryRows.map(
      (row): SessionSummary => ({
        sessionId: row.session_id,
        userId: row.user_id ?? null,
        turnCount: Number(row.turn_count ?? 0),
        startedAt: row.started_at ?? null,
        endedAt: row.ended_at ?? null,
      }),
    );
  }
}

function buildChunkId(sessionId: string, turnId: string): string {
  return `episodic::${sessionId}::${turnId}`;
}

function buildPromptKey(sessionId: string): string {
  return `episodic::${sessionId}`;
}

function mapTurnRow(row: ConversationTurnRow): ConversationTurnRecord {
  const metadata = toRecord(row.metadata);
  const summary = row.summary == null ? null : toRecord(row.summary);

  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id ?? null,
    role: row.role,
    turnIndex: Number(row.turn_index),
    content: row.content,
    summary,
    metadata,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function buildPreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 177)}...`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampSimilarity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MIN_SIMILARITY;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function extractString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function toTimestamp(input: Date | string): string {
  if (input instanceof Date) {
    return input.toISOString();
  }
  return input;
}

function extractKeywords(content: string): string[] {
  const normalized = content.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);

  if (tokens.length === 0) {
    return [];
  }

  const frequencies = new Map<string, number>();
  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  return Array.from(frequencies.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([token]) => token);
}
