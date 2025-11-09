import { db } from '../client.js';
import { memories } from '../schema.js';
import { sql, and, eq, inArray, desc } from 'drizzle-orm';
import type { MemorySearchParams, Memory } from '../../types/memory.js';

export class MemoryRepository {
  async vectorSearch(
    embedding: number[],
    params: MemorySearchParams
  ): Promise<Memory[]> {
    const {
      memoryTypes = ['episodic', 'semantic', 'procedural'],
      persona,
      project,
      traceId,
      limit = 10,
      minSimilarity,
    } = params;

    const conditions = [];

    // Filter by memory types
    if (memoryTypes.length > 0) {
      conditions.push(inArray(memories.memoryType, memoryTypes));
    }

    // Filter by persona
    if (persona) {
      conditions.push(sql`${persona} = ANY(${memories.persona})`);
    }

    // Filter by project
    if (project) {
      conditions.push(sql`${project} = ANY(${memories.project})`);
    }

    // Filter by traceId
    if (traceId) {
      conditions.push(eq(memories.traceId, traceId));
    }

    // Filter by minimum similarity (cosine similarity = 1 - cosine distance)
    if (minSimilarity !== undefined) {
      conditions.push(
        sql`1 - (${memories.embedding} <=> ${JSON.stringify(embedding)}::vector) >= ${minSimilarity}`
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : sql`TRUE`;

    // Vector similarity search with cosine distance
    const results = await db
      .select()
      .from(memories)
      .where(where)
      .orderBy(sql`${memories.embedding} <=> ${JSON.stringify(embedding)}::vector`)
      .limit(limit);

    return results as Memory[];
  }

  async keywordSearch(
    query: string,
    params: MemorySearchParams
  ): Promise<Memory[]> {
    const {
      memoryTypes = ['episodic', 'semantic', 'procedural'],
      persona,
      project,
      traceId,
      limit = 10,
    } = params;

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    const conditions = [];

    // Text search across content + summary
    const tsQuery = sql`plainto_tsquery('english', ${trimmedQuery})`;
    const searchVector = sql`
      setweight(to_tsvector('english', ${memories.content}), 'A') ||
      coalesce(setweight(to_tsvector('english', coalesce(${memories.summary}, '')), 'B'), to_tsvector('english', ''))
    `;

    conditions.push(sql`${searchVector} @@ ${tsQuery}`);

    // Filter by memory types
    if (memoryTypes.length > 0) {
      conditions.push(inArray(memories.memoryType, memoryTypes));
    }

    // Filter by persona
    if (persona) {
      conditions.push(sql`${persona} = ANY(${memories.persona})`);
    }

    // Filter by project
    if (project) {
      conditions.push(sql`${project} = ANY(${memories.project})`);
    }

    if (traceId) {
      conditions.push(eq(memories.traceId, traceId));
    }

    const where = and(...conditions);

    const rankExpression = sql`ts_rank_cd(${searchVector}, ${tsQuery})`;

    const results = await db
      .select()
      .from(memories)
      .where(where)
      .orderBy(sql`${rankExpression} DESC`)
      .limit(limit);

    return results as Memory[];
  }

  async insert(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    // Extract trace_id from metadata if present
    const traceId = memory.metadata?.traceId as string | undefined;
    const insertValues = {
      ...memory,
      // Only set traceId if it exists in execution_traces (FK constraint)
      // For knowledge ingestion outside of traces, traceId will be null
      traceId: traceId || null,
    };
    
    try {
      const [result] = await db.insert(memories).values(insertValues).returning();
      return result as Memory;
    } catch (error) {
      // If FK constraint fails (trace doesn't exist), retry with traceId = null
      // This handles knowledge ingestion outside of production traces
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorString = String(error);
      const errorWithCode = error as { code?: unknown } | undefined;
      const errorCode =
        typeof errorWithCode?.code === 'string' ? (errorWithCode.code as string) : undefined;
      
      // Check for FK constraint violation (Postgres error code 23503 or error message)
      const isForeignKeyError =
        errorCode === '23503' ||
        errorMessage.includes('foreign key constraint') ||
        errorMessage.includes('memories_trace_id_fk') ||
        errorString.includes('foreign key constraint') ||
        errorString.includes('memories_trace_id_fk');
      
      if (isForeignKeyError && insertValues.traceId) {
        // Retry without traceId
        const insertValuesWithoutTrace = {
          ...insertValues,
          traceId: null,
        };
        const [result] = await db.insert(memories).values(insertValuesWithoutTrace).returning();
        return result as Memory;
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Memory | null> {
    const [result] = await db
      .select()
      .from(memories)
      .where(eq(memories.id, id))
      .limit(1);

    return (result as Memory) || null;
  }

  async update(
    id: string,
    updates: Partial<Memory>
  ): Promise<Memory> {
    // Extract trace_id from metadata if present in updates
    const updateData: Record<string, unknown> = { ...updates };
    if (updates.metadata?.traceId) {
      updateData.traceId = updates.metadata.traceId as string;
    }
    // updated_at is handled by trigger, don't set manually
    delete updateData.updatedAt;

    const [result] = await db
      .update(memories)
      .set(updateData)
      .where(eq(memories.id, id))
      .returning();

    return result as Memory;
  }

  async updateAccessCount(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) {
      return;
    }

    await db
      .update(memories)
      .set({
        lastAccessedAt: new Date(),
        accessCount: sql`${memories.accessCount} + 1`,
      })
      .where(inArray(memories.id, memoryIds));
  }

  async findByIds(ids: string[]): Promise<Memory[]> {
    if (ids.length === 0) return [];

    const results = await db
      .select()
      .from(memories)
      .where(inArray(memories.id, ids));

    return results as Memory[];
  }

  async findByRunId(
    runId: string,
    params: { persona?: string; project?: string; limit?: number }
  ): Promise<Memory[]> {
    const conditions = [sql`${memories.metadata} ->> 'runId' = ${runId}`];

    if (params.persona) {
      conditions.push(sql`${params.persona} = ANY(${memories.persona})`);
    }

    if (params.project) {
      conditions.push(sql`${params.project} = ANY(${memories.project})`);
    }

    const where = and(...conditions);

    const results = await db
      .select()
      .from(memories)
      .where(where)
      .orderBy(desc(memories.createdAt))
      .limit(params.limit ?? 20);

    return results as Memory[];
  }

  async findByTraceId(
    traceId: string,
    params: { persona?: string; project?: string; limit?: number; offset?: number }
  ): Promise<Memory[]> {
    const conditions = [eq(memories.traceId, traceId)];

    if (params.persona) {
      conditions.push(sql`${params.persona} = ANY(${memories.persona})`);
    }

    if (params.project) {
      conditions.push(sql`${params.project} = ANY(${memories.project})`);
    }

    const where = and(...conditions);

    const results = await db
      .select()
      .from(memories)
      .where(where)
      .orderBy(desc(memories.createdAt))
      .limit(params.limit ?? 20)
      .offset(params.offset ?? 0);

    return results as Memory[];
  }
}
