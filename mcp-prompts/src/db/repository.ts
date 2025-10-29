import { SQL, count, eq, sql } from 'drizzle-orm';
import { toSql as vectorToSql } from 'pgvector/pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDb } from './client';
import * as schema from './schema';
import type { NewPromptEmbedding, PromptEmbedding } from './schema';

export class PromptEmbeddingsRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema> = getDb()) {}

  async count(): Promise<number> {
    const [result] = await this.db.select({ value: count() }).from(schema.promptEmbeddings);
    return Number(result?.value ?? 0);
  }

  async getByFilePath(filePath: string): Promise<PromptEmbedding[]> {
    return this.db
      .select()
      .from(schema.promptEmbeddings)
      .where(eq(schema.promptEmbeddings.filePath, filePath));
  }

  async removeEmbeddingsByFilePath(filePath: string): Promise<number> {
    const result = await this.db
      .delete(schema.promptEmbeddings)
      .where(eq(schema.promptEmbeddings.filePath, filePath))
      .returning({ id: schema.promptEmbeddings.id });

    return result.length;
  }

  async upsertEmbeddings(records: EmbeddingRecord[]): Promise<number> {
    if (!records.length) {
      return 0;
    }

    const rows: NewPromptEmbedding[] = records.map((record) => ({
      chunkId: record.chunkId,
      filePath: record.filePath,
      chunkText: record.chunkText,
      rawMarkdown: record.rawMarkdown,
      granularity: record.granularity,
      embedding: record.embedding,
      metadata: record.metadata ?? {},
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

  async listAllFilePaths(): Promise<string[]> {
    const rows = await this.db
      .select({ filePath: schema.promptEmbeddings.filePath })
      .from(schema.promptEmbeddings);

    return [...new Set(rows.map((row) => row.filePath))];
  }

  async listPrompts(params: ListPromptsParameters = {}): Promise<PromptSummary[]> {
    const conditions: SQL[] = [];

    if (params.type) {
      const typeValue = params.type.toLowerCase();
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} ->> 'type' = ${typeValue}`,
      );
    }

    if (params.persona) {
      const personaValue = params.persona.toLowerCase();
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} @> ${JSON.stringify({
          persona: [personaValue],
        })}::jsonb`,
      );
    }

    if (params.project) {
      const projectValue = params.project.toLowerCase();
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} @> ${JSON.stringify({
          project: [projectValue],
        })}::jsonb`,
      );
    }

    const whereClause =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const query = sql<ListPromptRow>`
      SELECT
        ${schema.promptEmbeddings.filePath} AS "filePath",
        ${schema.promptEmbeddings.metadata} AS "metadata",
        COUNT(*) AS "chunkCount"
      FROM ${schema.promptEmbeddings}
      ${whereClause}
      GROUP BY ${schema.promptEmbeddings.filePath}, ${schema.promptEmbeddings.metadata}
      ORDER BY ${schema.promptEmbeddings.filePath} ASC
    `;

    const { rows } = await this.db.execute(query);

    return rows.map((row) => ({
      filePath: row.filePath,
      metadata: row.metadata ?? {},
      chunkCount: Number(row.chunkCount ?? 0),
    }));
  }

  async filterChunks(params: FilterChunksParameters = {}): Promise<FilterChunksResult> {
    const conditions: SQL[] = [];

    if (params.type) {
      const typeValue = params.type.toLowerCase();
      conditions.push(sql`${schema.promptEmbeddings.metadata} ->> 'type' = ${typeValue}`);
    }

    if (params.persona) {
      const personaValue = params.persona.toLowerCase();
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} @> ${JSON.stringify({
          persona: [personaValue],
        })}::jsonb`,
      );
    }

    if (params.project) {
      const projectValue = params.project.toLowerCase();
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} @> ${JSON.stringify({
          project: [projectValue],
        })}::jsonb`,
      );
    }

    if (params.granularity) {
      const granularityValue = params.granularity.toLowerCase();
      conditions.push(sql`${schema.promptEmbeddings.granularity} = ${granularityValue}`);
    }

    const whereClause =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
    const offset = Math.max(0, params.offset ?? 0);

    const query = sql<FilterRow>`
      SELECT
        ${schema.promptEmbeddings.chunkId} AS "chunkId",
        ${schema.promptEmbeddings.filePath} AS "filePath",
        ${schema.promptEmbeddings.chunkText} AS "chunkText",
        ${schema.promptEmbeddings.rawMarkdown} AS "rawMarkdown",
        ${schema.promptEmbeddings.metadata} AS "metadata",
        ${schema.promptEmbeddings.granularity} AS "granularity",
        ${schema.promptEmbeddings.checksum} AS "checksum",
        COUNT(*) OVER() AS "total"
      FROM ${schema.promptEmbeddings}
      ${whereClause}
      ORDER BY ${schema.promptEmbeddings.filePath} ASC, ${schema.promptEmbeddings.chunkId} ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const { rows } = await this.db.execute(query);

    const total = rows.length > 0 ? Number(rows[0].total ?? 0) : 0;
    const chunks: FilteredChunk[] = rows.map((row) => ({
      chunkId: row.chunkId,
      filePath: row.filePath,
      chunkText: row.chunkText,
      rawMarkdown: row.rawMarkdown,
      metadata: row.metadata ?? {},
      granularity: row.granularity,
      checksum: row.checksum,
    }));

    return {
      total,
      chunks,
    };
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
    const lastUpdatedAtValue = row?.lastUpdatedAt ?? null;
    const lastUpdatedAt =
      lastUpdatedAtValue !== null && lastUpdatedAtValue !== undefined
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

  async insertMany(records: NewPromptEmbedding[]): Promise<void> {
    if (!records.length) {
      return;
    }

    await this.db.insert(schema.promptEmbeddings).values(records).onConflictDoNothing({
      target: schema.promptEmbeddings.chunkId,
    });
  }

  async search(params: SearchParameters): Promise<SearchResult[]> {
    const { embedding, persona, project, limit, minSimilarity } = params;

    if (!embedding.length) {
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
        ${schema.promptEmbeddings.filePath} AS "filePath",
        ${schema.promptEmbeddings.chunkText} AS "chunkText",
        ${schema.promptEmbeddings.rawMarkdown} AS "rawMarkdown",
        ${schema.promptEmbeddings.metadata} AS "metadata",
        1 - (${schema.promptEmbeddings.embedding} <=> ${embeddingLiteral}) AS "similarity"
      FROM ${schema.promptEmbeddings}
      WHERE ${whereClause}
      ORDER BY ${schema.promptEmbeddings.embedding} <=> ${embeddingLiteral} ASC
      LIMIT ${normalizedLimit}
    `;

    const { rows } = await this.db.execute(query);

    return rows.map((row) => ({
      chunkId: row.chunkId,
      filePath: row.filePath,
      chunkText: row.chunkText,
      rawMarkdown: row.rawMarkdown,
      metadata: row.metadata,
      similarity: Number(row.similarity),
    }));
  }
}

export interface EmbeddingRecord {
  chunkId: string;
  filePath: string;
  chunkText: string;
  rawMarkdown: string;
  granularity: PromptEmbedding['granularity'];
  embedding: number[];
  metadata?: PromptEmbedding['metadata'];
  checksum: string;
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
  filePath: string;
  chunkText: string;
  rawMarkdown: string;
  metadata: PromptEmbedding['metadata'];
  similarity: number;
}

export interface SearchResult {
  chunkId: string;
  filePath: string;
  chunkText: string;
  rawMarkdown: string;
  metadata: PromptEmbedding['metadata'];
  similarity: number;
}

export interface ListPromptsParameters {
  type?: string;
  persona?: string;
  project?: string;
}

interface ListPromptRow {
  filePath: string;
  metadata: PromptEmbedding['metadata'];
  chunkCount: number;
}

export interface PromptSummary {
  filePath: string;
  metadata: PromptEmbedding['metadata'];
  chunkCount: number;
}

export interface FilterChunksParameters {
  type?: string;
  persona?: string;
  project?: string;
  granularity?: string;
  limit?: number;
  offset?: number;
}

interface FilterRow {
  chunkId: string;
  filePath: string;
  chunkText: string;
  rawMarkdown: string;
  metadata: PromptEmbedding['metadata'];
  granularity: string;
  checksum: string;
  total: number;
}

export interface FilteredChunk {
  chunkId: string;
  filePath: string;
  chunkText: string;
  rawMarkdown: string;
  metadata: PromptEmbedding['metadata'];
  granularity: string;
  checksum: string;
}

export interface FilterChunksResult {
  total: number;
  chunks: FilteredChunk[];
}

interface PromptStatsRow {
  chunkCount: number;
  promptCount: number;
  lastUpdatedAt: string | Date | null;
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
