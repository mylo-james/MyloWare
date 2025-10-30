import { SQL, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { toSql as vectorToSql } from 'pgvector/pg';
import { getDb } from './client';
import * as schema from './schema';
import type { NewPromptEmbedding, PromptEmbedding } from './schema';

type PromptMetadata = Record<string, unknown>;

export class PromptEmbeddingsRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema> = getDb()) {}

  async upsertEmbeddings(records: EmbeddingRecord[]): Promise<number> {
    if (records.length === 0) {
      return 0;
    }

    const rows: NewPromptEmbedding[] = records.map((record) => ({
      chunkId: record.chunkId,
      filePath: record.promptKey,
      chunkText: record.chunkText,
      rawMarkdown: record.rawSource,
      granularity: record.granularity,
      embedding: record.embedding,
      metadata: (record.metadata ?? {}) as PromptMetadata,
      checksum: record.checksum,
    }));

    const result = await this.db
      .insert(schema.promptEmbeddings)
      .values(rows)
      .onConflictDoUpdate({
        target: schema.promptEmbeddings.chunkId,
        set: {
          filePath: sql`excluded.file_path`,
          chunkText: sql`excluded.chunk_text`,
          rawMarkdown: sql`excluded.raw_markdown`,
          granularity: sql`excluded.granularity`,
          embedding: sql`excluded.embedding`,
          metadata: sql`excluded.metadata`,
          checksum: sql`excluded.checksum`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: schema.promptEmbeddings.id });

    return result.length;
  }

  async deleteByPromptKey(promptKey: string): Promise<number> {
    const result = await this.db
      .delete(schema.promptEmbeddings)
      .where(eq(schema.promptEmbeddings.filePath, promptKey))
      .returning({ id: schema.promptEmbeddings.id });

    return result.length;
  }

  async getChunksByPromptKey(promptKey: string): Promise<PromptChunk[]> {
    const rows = await this.db
      .select({
        chunkId: schema.promptEmbeddings.chunkId,
        promptKey: schema.promptEmbeddings.filePath,
        chunkText: schema.promptEmbeddings.chunkText,
        rawSource: schema.promptEmbeddings.rawMarkdown,
        granularity: schema.promptEmbeddings.granularity,
        metadata: schema.promptEmbeddings.metadata,
        checksum: schema.promptEmbeddings.checksum,
        updatedAt: schema.promptEmbeddings.updatedAt,
      })
      .from(schema.promptEmbeddings)
      .where(eq(schema.promptEmbeddings.filePath, promptKey))
      .orderBy(schema.promptEmbeddings.chunkId);

    return rows.map((row) => ({
      chunkId: typeof row.chunkId === 'string' ? row.chunkId : String(row.chunkId),
      promptKey: typeof row.promptKey === 'string' ? row.promptKey : String(row.promptKey),
      chunkText: typeof row.chunkText === 'string' ? row.chunkText : String(row.chunkText ?? ''),
      rawSource: typeof row.rawSource === 'string' ? row.rawSource : String(row.rawSource ?? ''),
      granularity: row.granularity,
      metadata: (row.metadata ?? {}) as PromptMetadata,
      checksum: row.checksum,
      updatedAt: row.updatedAt ?? null,
    }));
  }

  async listPrompts(filters: PromptLookupFilters = {}): Promise<PromptSummary[]> {
    const conditions = this.buildMetadataConditions(filters);
    const whereClause =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const query = sql<ListPromptRow>`
      SELECT
        ${schema.promptEmbeddings.filePath} AS "promptKey",
        ${schema.promptEmbeddings.metadata} AS "metadata",
        COUNT(*) AS "chunkCount",
        MAX(${schema.promptEmbeddings.updatedAt}) AS "updatedAt"
      FROM ${schema.promptEmbeddings}
      ${whereClause}
      GROUP BY ${schema.promptEmbeddings.filePath}, ${schema.promptEmbeddings.metadata}
      ORDER BY ${schema.promptEmbeddings.filePath} ASC
    `;

    const { rows } = await this.db.execute(query);

    return rows.map((row) => {
      const promptKey = typeof row.promptKey === 'string' ? row.promptKey : String(row.promptKey);
      return {
        promptKey,
        metadata: (row.metadata ?? {}) as PromptMetadata,
        chunkCount: Number(row.chunkCount ?? 0),
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
      };
    });
  }

  async search(params: SearchParameters): Promise<SearchResult[]> {
    const { embedding, persona, project, limit, minSimilarity } = params;

    if (embedding.length === 0) {
      return [];
    }

    const normalizedLimit = Math.max(1, Math.min(limit, 50));
    const similarityThreshold = Math.min(Math.max(minSimilarity, 0), 1);

    const embeddingLiteral = sql.raw(`'${vectorToSql(embedding)}'::vector`);

    const conditions: SQL[] = [
      sql`1 - (${schema.promptEmbeddings.embedding} <=> ${embeddingLiteral}) >= ${similarityThreshold}`,
    ];

    if (persona) {
      const personaValue = persona.toLowerCase();
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} @> ${JSON.stringify({
          persona: [personaValue],
        })}::jsonb`,
      );
    }

    if (project) {
      const projectValue = project.toLowerCase();
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} @> ${JSON.stringify({
          project: [projectValue],
        })}::jsonb`,
      );
    }

    const whereClause = sql.join(conditions, sql` AND `);

    const query = sql<SearchRow>`
      SELECT
        ${schema.promptEmbeddings.chunkId} AS "chunkId",
        ${schema.promptEmbeddings.filePath} AS "promptKey",
        ${schema.promptEmbeddings.chunkText} AS "chunkText",
        ${schema.promptEmbeddings.rawMarkdown} AS "rawSource",
        ${schema.promptEmbeddings.metadata} AS "metadata",
        1 - (${schema.promptEmbeddings.embedding} <=> ${embeddingLiteral}) AS "similarity"
      FROM ${schema.promptEmbeddings}
      WHERE ${whereClause}
      ORDER BY ${schema.promptEmbeddings.embedding} <=> ${embeddingLiteral} ASC
      LIMIT ${normalizedLimit}
    `;

    const { rows } = await this.db.execute(query);

    return rows.map((row) => ({
      chunkId: typeof row.chunkId === 'string' ? row.chunkId : String(row.chunkId),
      promptKey: typeof row.promptKey === 'string' ? row.promptKey : String(row.promptKey),
      chunkText: typeof row.chunkText === 'string' ? row.chunkText : String(row.chunkText ?? ''),
      rawSource: typeof row.rawSource === 'string' ? row.rawSource : String(row.rawSource ?? ''),
      metadata: (row.metadata ?? {}) as PromptMetadata,
      similarity: Number(row.similarity),
    }));
  }

  async getPromptStatistics(): Promise<PromptStatistics> {
    const query = sql<PromptStatsRow>`
      SELECT
        COUNT(*) AS "chunkCount",
        COUNT(DISTINCT ${schema.promptEmbeddings.filePath}) AS "promptCount",
        MAX(${schema.promptEmbeddings.updatedAt}) AS "lastUpdatedAt"
      FROM ${schema.promptEmbeddings}
    `;

    const { rows } = await this.db.execute(query);
    const [row] = rows;

    const chunkCount = Number(row?.chunkCount ?? 0);
    const promptCount = Number(row?.promptCount ?? 0);
    const lastUpdatedAtValue = row?.lastUpdatedAt;
    const lastUpdatedAt =
      typeof lastUpdatedAtValue === 'string' && lastUpdatedAtValue.length > 0
        ? new Date(lastUpdatedAtValue)
        : null;

    return {
      chunkCount,
      promptCount,
      lastUpdatedAt: Number.isNaN(lastUpdatedAt?.getTime() ?? NaN) ? null : lastUpdatedAt,
    };
  }

  async checkConnection(): Promise<DatabaseCheckResult> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown database error',
      };
    }
  }

  async transaction<T>(fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  private buildMetadataConditions(filters: PromptLookupFilters): SQL[] {
    const conditions: SQL[] = [];

    if (filters.type) {
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} ->> 'type' = ${filters.type.toLowerCase()}`,
      );
    }

    if (filters.persona) {
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} @> ${JSON.stringify({
          persona: [filters.persona.toLowerCase()],
        })}::jsonb`,
      );
    }

    if (filters.project) {
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} @> ${JSON.stringify({
          project: [filters.project.toLowerCase()],
        })}::jsonb`,
      );
    }

    return conditions;
  }
}

export interface EmbeddingRecord {
  chunkId: string;
  promptKey: string;
  chunkText: string;
  rawSource: string;
  granularity: PromptEmbedding['granularity'];
  embedding: number[];
  metadata?: PromptEmbedding['metadata'];
  checksum: string;
}

export interface PromptLookupFilters {
  type?: string;
  persona?: string;
  project?: string;
}

interface ListPromptRow {
  promptKey: string;
  metadata: PromptMetadata;
  chunkCount: number;
  updatedAt: string | null;
}

export interface PromptSummary {
  promptKey: string;
  metadata: PromptMetadata;
  chunkCount: number;
  updatedAt: string | null;
}

export interface PromptChunk {
  chunkId: string;
  promptKey: string;
  chunkText: string;
  rawSource: string;
  granularity: PromptEmbedding['granularity'];
  metadata: PromptMetadata;
  checksum: string;
  updatedAt: PromptEmbedding['updatedAt'];
}

export interface SearchParameters {
  embedding: number[];
  limit: number;
  minSimilarity: number;
  persona?: string;
  project?: string;
}

interface SearchRow {
  chunkId: string;
  promptKey: string;
  chunkText: string;
  rawSource: string;
  metadata: PromptMetadata;
  similarity: number;
}

export interface SearchResult {
  chunkId: string;
  promptKey: string;
  chunkText: string;
  rawSource: string;
  metadata: PromptEmbedding['metadata'];
  similarity: number;
}

interface PromptStatsRow {
  chunkCount: number | string | null;
  promptCount: number | string | null;
  lastUpdatedAt: string | null;
}

export interface PromptStatistics {
  chunkCount: number;
  promptCount: number;
  lastUpdatedAt: Date | null;
}

export interface DatabaseCheckResult {
  status: 'ok' | 'error';
  error?: string;
}
