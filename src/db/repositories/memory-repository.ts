import { db } from '../client.js';
import { memories } from '../schema.js';
import { sql, and, eq, inArray } from 'drizzle-orm';
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
    const [result] = await db.insert(memories).values(memory).returning();
    return result as Memory;
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
    const [result] = await db
      .update(memories)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
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
}
