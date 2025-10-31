import { SQL, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { toSql as vectorToSql } from 'pgvector/pg';
import { config } from '../config';
import { expandGraphSeeds, type GraphPathStep, type GraphSeed } from '../vector/graphSearch';
import type { TemporalDecayStrategy } from '../vector/temporalScoring';
import { getDb } from './client';
import * as schema from './schema';
import type { MemoryType, NewPromptEmbedding, PromptEmbedding } from './schema';
import { MemoryLinkRepository, type MemoryLinkType } from './linkRepository';

type PromptMetadata = Record<string, unknown>;

type LinkRepositoryFactory = (db: NodePgDatabase<typeof schema>) => MemoryLinkRepository;

const defaultLinkRepositoryFactory: LinkRepositoryFactory = (db) => new MemoryLinkRepository(db);

const KEYWORD_SEARCH_DEFAULT_LIMIT = 20;
const KEYWORD_SEARCH_MAX_LIMIT = 50;
const KEYWORD_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'if',
  'in',
  'into',
  'is',
  'it',
  'no',
  'not',
  'of',
  'on',
  'or',
  'such',
  'that',
  'the',
  'their',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'will',
  'with',
]);

export class PromptEmbeddingsRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema> = getDb(),
    private readonly linkRepositoryFactory: LinkRepositoryFactory = defaultLinkRepositoryFactory,
  ) {}

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
      textsearch: sql`to_tsvector('simple', ${record.rawSource})` as unknown as NewPromptEmbedding['textsearch'],
      metadata: (record.metadata ?? {}) as PromptMetadata,
      checksum: record.checksum,
      memoryType: record.memoryType ?? 'semantic',
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

  async deleteByChunkIds(chunkIds: string[]): Promise<number> {
    if (chunkIds.length === 0) {
      return 0;
    }

    const result = await this.db
      .delete(schema.promptEmbeddings)
      .where(sql`${schema.promptEmbeddings.chunkId} = ANY(${chunkIds})`)
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
        memoryType: schema.promptEmbeddings.memoryType,
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
      memoryType: row.memoryType as MemoryType,
      updatedAt: row.updatedAt ?? null,
    }));
  }

  async getChunkEmbedding(chunkId: string): Promise<ChunkEmbedding | null> {
    const query = sql<ChunkEmbeddingRow>`
      SELECT
        ${schema.promptEmbeddings.chunkId} AS "chunkId",
        ${schema.promptEmbeddings.filePath} AS "promptKey",
        ${schema.promptEmbeddings.embedding} AS "embedding",
        ${schema.promptEmbeddings.memoryType} AS "memoryType",
        ${schema.promptEmbeddings.metadata} AS "metadata"
      FROM ${schema.promptEmbeddings}
      WHERE ${schema.promptEmbeddings.chunkId} = ${chunkId}
      LIMIT 1
    `;

    const { rows } = await this.db.execute(query);
    const row = rows[0];
    if (!row) {
      return null;
    }

    const embedding = normalizeVector(row.embedding);

    return {
      chunkId: typeof row.chunkId === 'string' ? row.chunkId : String(row.chunkId),
      promptKey: typeof row.promptKey === 'string' ? row.promptKey : String(row.promptKey),
      embedding,
      memoryType: (row.memoryType ?? 'semantic') as MemoryType,
      metadata: (row.metadata ?? {}) as PromptMetadata,
    };
  }

  async getChunksByIds(chunkIds: string[]): Promise<PromptChunk[]> {
    if (chunkIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(chunkIds));

    const query = sql<ChunkDetailRow>`
      SELECT
        ${schema.promptEmbeddings.chunkId} AS "chunkId",
        ${schema.promptEmbeddings.filePath} AS "promptKey",
        ${schema.promptEmbeddings.chunkText} AS "chunkText",
        ${schema.promptEmbeddings.rawMarkdown} AS "rawSource",
        ${schema.promptEmbeddings.metadata} AS "metadata",
        ${schema.promptEmbeddings.memoryType} AS "memoryType",
        ${schema.promptEmbeddings.granularity} AS "granularity",
        ${schema.promptEmbeddings.checksum} AS "checksum",
        ${schema.promptEmbeddings.updatedAt} AS "updatedAt"
      FROM ${schema.promptEmbeddings}
      WHERE ${schema.promptEmbeddings.chunkId} = ANY(${uniqueIds})
    `;

    const { rows } = await this.db.execute(query);
    const map = new Map<string, PromptChunk>();

    rows.forEach((row) => {
      const chunkId = typeof row.chunkId === 'string' ? row.chunkId : String(row.chunkId);
      map.set(chunkId, {
        chunkId,
        promptKey:
          row.promptKey == null
            ? ''
            : typeof row.promptKey === 'string'
              ? row.promptKey
              : String(row.promptKey),
        chunkText:
          row.chunkText == null
            ? ''
            : typeof row.chunkText === 'string'
              ? row.chunkText
              : String(row.chunkText),
        rawSource:
          row.rawSource == null
            ? ''
            : typeof row.rawSource === 'string'
              ? row.rawSource
              : String(row.rawSource),
        granularity: row.granularity as PromptEmbedding['granularity'],
        metadata: (row.metadata ?? {}) as PromptMetadata,
        checksum: typeof row.checksum === 'string' ? row.checksum : String(row.checksum ?? ''),
        memoryType: (row.memoryType ?? 'semantic') as MemoryType,
        updatedAt:
          row.updatedAt == null
            ? null
            : typeof row.updatedAt === 'string'
              ? row.updatedAt
              : String(row.updatedAt),
      });
    });

    return uniqueIds
      .map((id) => map.get(id))
      .filter((value): value is PromptChunk => value != null);
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
        MAX(${schema.promptEmbeddings.updatedAt}) AS "updatedAt",
        MIN(${schema.promptEmbeddings.memoryType}) AS "memoryType"
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
        memoryType: (row.memoryType ?? 'semantic') as MemoryType,
      };
    });
  }

  async search(params: SearchParameters): Promise<SearchResult[]> {
    const { embedding, persona, project, limit, minSimilarity, memoryTypes } = params;

    if (embedding.length === 0) {
      return [];
    }

    const normalizedLimit = Math.max(1, Math.min(limit, 50));
    const similarityThreshold = Math.min(Math.max(minSimilarity, 0), 1);

    const embeddingLiteral = sql.raw(`'${vectorToSql(embedding)}'::vector`);
    const baseSimilarityExpression = sql`1 - (${schema.promptEmbeddings.embedding} <=> ${embeddingLiteral})`;
    const ageDaysExpression = sql`GREATEST(EXTRACT(EPOCH FROM (NOW() - COALESCE(${schema.promptEmbeddings.updatedAt}, NOW()))) / 86400.0, 0)`;
    const temporalSettings = this.resolveTemporalSettings(params);
    const similarityExpression =
      temporalSettings === null
        ? baseSimilarityExpression
        : this.applyTemporalDecayToSimilarity(
            baseSimilarityExpression,
            ageDaysExpression,
            temporalSettings,
          );
    const thresholdExpression = temporalSettings === null ? baseSimilarityExpression : similarityExpression;

    const conditions: SQL[] = [
      sql`${thresholdExpression} >= ${similarityThreshold}`,
      sql`COALESCE(${schema.promptEmbeddings.metadata} ->> 'status', 'active') <> 'inactive'`,
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

    if (Array.isArray(memoryTypes) && memoryTypes.length > 0) {
      conditions.push(this.buildMemoryTypeCondition(memoryTypes));
    }

    const whereClause = sql.join(conditions, sql` AND `);

    const query = sql<SearchRow>`
      SELECT
        ${schema.promptEmbeddings.chunkId} AS "chunkId",
        ${schema.promptEmbeddings.filePath} AS "promptKey",
        ${schema.promptEmbeddings.chunkText} AS "chunkText",
        ${schema.promptEmbeddings.rawMarkdown} AS "rawSource",
        ${schema.promptEmbeddings.metadata} AS "metadata",
        ${schema.promptEmbeddings.memoryType} AS "memoryType",
        ${ageDaysExpression} AS "ageDays",
        ${similarityExpression} AS "similarity"
      FROM ${schema.promptEmbeddings}
      WHERE ${whereClause}
      ORDER BY "similarity" DESC
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
      ageDays:
        row.ageDays == null || Number.isNaN(Number(row.ageDays)) ? null : Number(row.ageDays),
      temporalDecayApplied: temporalSettings !== null,
      memoryType: (row.memoryType ?? 'semantic') as MemoryType,
    }));
  }

  async keywordSearch(
    query: string,
    filters: PromptLookupFilters = {},
    options: KeywordSearchOptions = {},
  ): Promise<SearchResult[]> {
    const normalizedQuery = this.normalizeKeywordQuery(query);
    if (!normalizedQuery) {
      return [];
    }

    const limitInput = options.limit ?? KEYWORD_SEARCH_DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(limitInput, KEYWORD_SEARCH_MAX_LIMIT));

    const fullTextConfig = config.search.fullText;
    const weightValues = Array.from(fullTextConfig.weights);
    const weightLiteral = sql.raw(
      `ARRAY[${weightValues.map((value) => value.toString()).join(', ')}]`,
    );

    const metadataConditions = this.buildMetadataConditions(filters);
    const memoryTypes = options.memoryTypes;
    if (Array.isArray(memoryTypes) && memoryTypes.length > 0) {
      metadataConditions.push(this.buildMemoryTypeCondition(memoryTypes));
    }
    const whereConditions: SQL[] = [
      sql`keyword_query.query @@ ${schema.promptEmbeddings.textsearch}`,
      sql`COALESCE(${schema.promptEmbeddings.metadata} ->> 'status', 'active') <> 'inactive'`,
      ...metadataConditions,
    ];

    const whereClause = sql.join(whereConditions, sql` AND `);

    const keywordQuery = sql<KeywordSearchRow>`
      WITH keyword_query AS (
        SELECT websearch_to_tsquery(${fullTextConfig.language}, ${normalizedQuery}) AS query
      ),
      ranked_results AS (
        SELECT
          ${schema.promptEmbeddings.chunkId} AS "chunkId",
          ${schema.promptEmbeddings.filePath} AS "promptKey",
          ${schema.promptEmbeddings.chunkText} AS "chunkText",
          ${schema.promptEmbeddings.rawMarkdown} AS "rawSource",
          ${schema.promptEmbeddings.metadata} AS "metadata",
          ${schema.promptEmbeddings.memoryType} AS "memoryType",
          ts_rank_cd(
            ${weightLiteral},
            ${schema.promptEmbeddings.textsearch},
            keyword_query.query
          ) AS "score"
        FROM ${schema.promptEmbeddings}, keyword_query
        WHERE ${whereClause}
      )
      SELECT
        "chunkId",
        "promptKey",
        "chunkText",
        "rawSource",
        "metadata",
        "memoryType",
        "score"
      FROM ranked_results
      WHERE "score" >= ${fullTextConfig.minScore}
      ORDER BY "score" DESC
      LIMIT ${limit}
    `;

    const { rows } = await this.db.execute(keywordQuery);

    return rows.map((row) => ({
      chunkId: typeof row.chunkId === 'string' ? row.chunkId : String(row.chunkId),
      promptKey: typeof row.promptKey === 'string' ? row.promptKey : String(row.promptKey),
      chunkText: typeof row.chunkText === 'string' ? row.chunkText : String(row.chunkText ?? ''),
      rawSource: typeof row.rawSource === 'string' ? row.rawSource : String(row.rawSource ?? ''),
      metadata: (row.metadata ?? {}) as PromptMetadata,
      similarity: Number(row.score ?? 0),
      ageDays: null,
      temporalDecayApplied: false,
      memoryType: (row.memoryType ?? 'semantic') as MemoryType,
    }));
  }

  async searchPersonaMemory(params: SearchParameters): Promise<SearchResult[]> {
    return this.search({
      ...params,
      memoryTypes: ['persona'],
    });
  }

  async searchProjectMemory(params: SearchParameters): Promise<SearchResult[]> {
    return this.search({
      ...params,
      memoryTypes: ['project'],
    });
  }

  async searchSemanticMemory(params: SearchParameters): Promise<SearchResult[]> {
    return this.search({
      ...params,
      memoryTypes: ['semantic'],
    });
  }

  async searchEpisodicMemory(params: SearchParameters): Promise<SearchResult[]> {
    return this.search({
      ...params,
      memoryTypes: ['episodic'],
    });
  }

  async searchAllMemory(params: MultiMemorySearchRequest): Promise<MemorySearchGroup[]> {
    const { memoryTypes, perTypeLimit, weights, limit, ...rest } = params;

    if (!Array.isArray(memoryTypes) || memoryTypes.length === 0) {
      return [];
    }

    const typeLimit = perTypeLimit ?? limit;
    const appliedWeights = weights ?? {};

    const results: MemorySearchGroup[] = [];

    for (const memoryType of memoryTypes) {
      const rawResults = await this.search({
        ...rest,
        limit: typeLimit,
        memoryTypes: [memoryType],
      });

      const weight = appliedWeights[memoryType] ?? 1;
      const weightedResults =
        weight === 1
          ? rawResults
          : rawResults.map((result) => ({
              ...result,
              similarity: result.similarity * weight,
            }));

      results.push({
        memoryType,
        results: weightedResults,
        weight,
      });
    }

    return results;
  }

  async searchWithGraphExpansion(params: GraphSearchParameters): Promise<SearchResult[]> {
    const baseResults = await this.search(params);

    if (!params.expandGraph || baseResults.length === 0) {
      return baseResults;
    }

    const seeds: GraphSeed[] = baseResults
      .map((result) => ({
        chunkId: result.chunkId,
        similarity: Number(result.similarity ?? 0),
      }))
      .filter((seed) => Number.isFinite(seed.similarity) && seed.similarity > 0);

    if (seeds.length === 0) {
      return baseResults;
    }

    const linkRepo = this.linkRepositoryFactory(this.db);
    const maxHops = Math.max(1, Math.floor(params.graphMaxHops ?? 2));
    const minLinkStrength = clamp01(params.graphMinLinkStrength ?? config.memoryGraph.minStrength);

    const expansionMatches = await expandGraphSeeds({
      seeds,
      linkRepository: linkRepo,
      options: {
        maxHops,
        minLinkStrength,
        maxPerNode: config.memoryGraph.maxNeighbors,
        maxResults: Math.max(params.limit, seeds.length * config.memoryGraph.maxNeighbors),
        seedWeight: 0.7,
        linkWeight: 0.3,
      },
    });

    if (expansionMatches.length === 0) {
      return baseResults;
    }

    const seedIds = new Set(seeds.map((seed) => seed.chunkId));
    const expansionIds = expansionMatches
      .map((match) => match.chunkId)
      .filter((chunkId) => !seedIds.has(chunkId));

    if (expansionIds.length === 0) {
      return baseResults;
    }

    const chunkDetails = await this.getChunksByIds(expansionIds);
    if (chunkDetails.length === 0) {
      return baseResults;
    }

    const detailMap = new Map(chunkDetails.map((detail) => [detail.chunkId, detail]));

    const expandedResults: SearchResult[] = [];
    for (const match of expansionMatches) {
      if (seedIds.has(match.chunkId)) {
        continue;
      }

      const detail = detailMap.get(match.chunkId);
      if (!detail) {
        continue;
      }

      const ageDays = calculateAgeDays(detail.updatedAt);
      const similarity = clamp01(match.score);

      expandedResults.push({
        chunkId: detail.chunkId,
        promptKey: detail.promptKey,
        chunkText: detail.chunkText,
        rawSource: detail.rawSource,
        metadata: detail.metadata,
        similarity,
        ageDays,
        temporalDecayApplied: false,
        memoryType: detail.memoryType,
        graphContext: {
          seedChunkId: match.seedChunkId,
          hopCount: match.hopCount,
          linkStrength: clamp01(match.linkStrength),
          seedSimilarity: clamp01(match.seedSimilarity),
          seedContribution: match.seedContribution,
          linkContribution: match.linkContribution,
          path: match.path,
        },
      });
    }

    if (expandedResults.length === 0) {
      return baseResults;
    }

    const merged = new Map<string, SearchResult>();

    for (const result of baseResults) {
      merged.set(result.chunkId, result);
    }

    for (const result of expandedResults) {
      const existing = merged.get(result.chunkId);
      if (!existing || result.similarity > existing.similarity) {
        merged.set(result.chunkId, result);
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => Number(b.similarity ?? 0) - Number(a.similarity ?? 0))
      .slice(0, params.limit);
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

  private resolveTemporalSettings(params: SearchParameters): ResolvedTemporalSettings | null {
    const defaults = config.search.temporal;
    const shouldApply = params.applyTemporalDecay ?? defaults.enabled;
    const strategy = params.temporalDecayConfig?.strategy ?? defaults.strategy;

    if (!shouldApply) {
      return null;
    }

    if (strategy !== 'exponential' && strategy !== 'linear') {
      return null;
    }

    const halfLifeDays = this.ensurePositiveNumber(
      params.temporalDecayConfig?.halfLifeDays,
      defaults.halfLifeDays,
    );
    const maxAgeDays = this.ensurePositiveNumber(
      params.temporalDecayConfig?.maxAgeDays,
      defaults.maxAgeDays,
    );

    return {
      strategy,
      halfLifeDays,
      maxAgeDays,
    };
  }

  private applyTemporalDecayToSimilarity(
    baseSimilarity: SQL,
    ageDaysExpression: SQL,
    settings: ResolvedTemporalSettings,
  ): SQL {
    if (settings.strategy === 'exponential') {
      const lambda = Math.log(2) / settings.halfLifeDays;
      return sql`${baseSimilarity} * EXP(-${lambda} * ${ageDaysExpression})`;
    }

    if (settings.strategy === 'linear') {
      return sql`${baseSimilarity} * GREATEST(0, 1 - (${ageDaysExpression} / ${settings.maxAgeDays}))`;
    }

    return baseSimilarity;
  }

  private ensurePositiveNumber(value: number | undefined, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
    return fallback;
  }

  private buildMetadataConditions(filters: PromptLookupFilters): SQL[] {
    const conditions: SQL[] = [];

    if (filters.type) {
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} ->> 'type' = ${filters.type.toLowerCase()}`,
      );
    }

    if (filters.persona) {
      const personaValue = filters.persona.toLowerCase();
      conditions.push(
        sql`EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(${schema.promptEmbeddings.metadata}->'persona', '[]'::jsonb)) AS persona_elem(value)
          WHERE persona_elem.value = ${personaValue}
        )`,
      );
    }

    if (filters.project) {
      const projectValue = filters.project.toLowerCase();
      conditions.push(
        sql`EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(${schema.promptEmbeddings.metadata}->'project', '[]'::jsonb)) AS project_elem(value)
          WHERE project_elem.value = ${projectValue}
        )`,
      );
    }

    return conditions;
  }

  private buildMemoryTypeCondition(memoryTypes: MemoryType[]): SQL {
    const normalized = memoryTypes
      .map((type) => type.toLowerCase() as MemoryType)
      .filter((type, index, self) => self.indexOf(type) === index);

    if (normalized.length === 0) {
      return sql`TRUE`;
    }

    const arrayLiteral = sql.raw(
      `ARRAY[${normalized.map((type) => `'${type}'::memory_type`).join(', ')}]`,
    );

    return sql`${schema.promptEmbeddings.memoryType} = ANY(${arrayLiteral})`;
  }

  private normalizeKeywordQuery(input: string): string | null {
    if (typeof input !== 'string') {
      return null;
    }

    const collapsed = input.replace(/\s+/g, ' ').trim();

    if (collapsed.length === 0) {
      return null;
    }

    const tokens = collapsed
      .split(/\s+/)
      .map((token) => token.replace(/^[^0-9a-z]+|[^0-9a-z]+$/gi, '').toLowerCase())
      .filter((token) => token.length > 0);

    if (tokens.length === 0) {
      return null;
    }

    const hasMeaningfulToken = tokens.some((token) => !KEYWORD_STOP_WORDS.has(token));
    if (!hasMeaningfulToken) {
      return null;
    }

    return collapsed;
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
  memoryType?: MemoryType;
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
  memoryType: MemoryType | null;
}

interface ChunkEmbeddingRow {
  chunkId: string;
  promptKey: string;
  embedding: unknown;
  memoryType: MemoryType;
  metadata: PromptMetadata;
}

export interface ChunkEmbedding {
  chunkId: string;
  promptKey: string;
  embedding: number[];
  memoryType: MemoryType;
  metadata: PromptMetadata;
}

function normalizeVector(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item));
  }

  if (value instanceof Float32Array || value instanceof Float64Array) {
    return Array.from(value);
  }

  if (value == null) {
    return [];
  }

  throw new Error('Unexpected embedding format returned from database.');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function calculateAgeDays(updatedAt: string | null): number | null {
  if (!updatedAt) {
    return null;
  }

  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  const diff = Date.now() - timestamp;
  if (!Number.isFinite(diff) || diff <= 0) {
    return diff === 0 ? 0 : null;
  }

  return Number((diff / 86_400_000).toFixed(2));
}

export interface PromptSummary {
  promptKey: string;
  metadata: PromptMetadata;
  chunkCount: number;
  updatedAt: string | null;
  memoryType: MemoryType;
}

export interface PromptChunk {
  chunkId: string;
  promptKey: string;
  chunkText: string;
  rawSource: string;
  granularity: PromptEmbedding['granularity'];
  metadata: PromptMetadata;
  checksum: string;
  memoryType: MemoryType;
  updatedAt: PromptEmbedding['updatedAt'];
}

export interface SearchParameters {
  embedding: number[];
  limit: number;
  minSimilarity: number;
  persona?: string;
  project?: string;
  memoryTypes?: MemoryType[];
  applyTemporalDecay?: boolean;
  temporalDecayConfig?: TemporalDecayOverrides;
}

export interface GraphSearchParameters extends SearchParameters {
  expandGraph?: boolean;
  graphMaxHops?: number;
  graphMinLinkStrength?: number;
}

export interface KeywordSearchOptions {
  limit?: number;
  memoryTypes?: MemoryType[];
}

interface SearchRow {
  chunkId: string;
  promptKey: string;
  chunkText: string | null;
  rawSource: string | null;
  metadata: PromptMetadata;
  memoryType: MemoryType | null;
  ageDays: number | string | null;
  similarity: number | string | null;
}

interface KeywordSearchRow {
  chunkId: string;
  promptKey: string;
  chunkText: string | null;
  rawSource: string | null;
  metadata: PromptMetadata;
  memoryType: MemoryType | null;
  score: number | null;
}

interface ChunkDetailRow {
  chunkId: string;
  promptKey: string | null;
  chunkText: string | null;
  rawSource: string | null;
  metadata: PromptMetadata | null;
  memoryType: MemoryType | null;
  granularity: PromptEmbedding['granularity'];
  checksum: string | null;
  updatedAt: string | null;
}

export interface GraphContext {
  seedChunkId: string;
  hopCount: number;
  linkStrength: number;
  seedSimilarity: number;
  seedContribution: number;
  linkContribution: number;
  path: GraphPathStep[];
}

export interface SearchResult {
  chunkId: string;
  promptKey: string;
  chunkText: string;
  rawSource: string;
  metadata: PromptEmbedding['metadata'];
  similarity: number;
  ageDays: number | null;
  temporalDecayApplied: boolean;
  memoryType: MemoryType;
  graphContext?: GraphContext;
}

export interface MemorySearchGroup {
  memoryType: MemoryType;
  results: SearchResult[];
  weight: number;
}

export interface MultiMemorySearchRequest extends Omit<SearchParameters, 'memoryTypes'> {
  memoryTypes: MemoryType[];
  perTypeLimit?: number;
  weights?: Partial<Record<MemoryType, number>>;
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

export interface TemporalDecayOverrides {
  strategy?: TemporalDecayStrategy;
  halfLifeDays?: number;
  maxAgeDays?: number;
}

interface ResolvedTemporalSettings {
  strategy: Extract<TemporalDecayStrategy, 'exponential' | 'linear'>;
  halfLifeDays: number;
  maxAgeDays: number;
}

export type { MemoryType } from './schema';
