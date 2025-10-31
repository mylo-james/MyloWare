import { eq, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDb } from './client';
import * as schema from './schema';
import type { MemoryLink, MemoryType } from './schema';

type Db = NodePgDatabase<typeof schema>;

export type MemoryLinkType = 'similar' | 'related' | 'prerequisite' | 'followup' | 'contrasts';

export interface CreateMemoryLinkInput {
  sourceChunkId: string;
  targetChunkId: string;
  linkType: MemoryLinkType;
  strength: number;
  metadata?: Record<string, unknown>;
}

export interface LinkedChunk {
  sourceChunkId: string;
  targetChunkId: string;
  linkType: MemoryLinkType;
  strength: number;
  metadata: Record<string, unknown>;
  targetPromptKey: string | null;
  targetMemoryType: MemoryType | null;
  targetUpdatedAt: string | null;
}

export interface LinkQueryOptions {
  limit?: number;
  minStrength?: number;
}

export interface ChunkClusterNode {
  chunkId: string;
  depth: number;
  promptKey: string | null;
  memoryType: MemoryType | null;
}

export interface ChunkCluster {
  root: ChunkClusterNode;
  nodes: ChunkClusterNode[];
  edges: LinkedChunk[];
}

export interface ClusterOptions {
  depth?: number;
  limitPerNode?: number;
  minStrength?: number;
}

export class MemoryLinkRepository {
  private readonly db: Db;

  constructor(db: Db = getDb() as Db) {
    this.db = db;
  }

  async upsertLinks(inputs: CreateMemoryLinkInput[]): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }

    const rows: Array<Omit<MemoryLink, 'id' | 'createdAt'>> = inputs.map((input) => ({
      sourceChunkId: input.sourceChunkId,
      targetChunkId: input.targetChunkId,
      linkType: input.linkType,
      strength: input.strength,
      metadata: (input.metadata ?? {}) as Record<string, unknown>,
    }));

    const result = await this.db
      .insert(schema.memoryLinks)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          schema.memoryLinks.sourceChunkId,
          schema.memoryLinks.targetChunkId,
          schema.memoryLinks.linkType,
        ],
        set: {
          strength: sql`excluded.strength`,
          metadata: sql`excluded.metadata`,
        },
      })
      .returning({ id: schema.memoryLinks.id });

    return result.length;
  }

  async createLink(input: CreateMemoryLinkInput): Promise<void> {
    await this.upsertLinks([input]);
  }

  async deleteLinksForSource(sourceChunkId: string): Promise<number> {
    const result = await this.db
      .delete(schema.memoryLinks)
      .where(eq(schema.memoryLinks.sourceChunkId, sourceChunkId))
      .returning({ id: schema.memoryLinks.id });

    return result.length;
  }

  async deleteLinksForTarget(targetChunkId: string): Promise<number> {
    const result = await this.db
      .delete(schema.memoryLinks)
      .where(eq(schema.memoryLinks.targetChunkId, targetChunkId))
      .returning({ id: schema.memoryLinks.id });

    return result.length;
  }

  async deleteLinksForChunk(chunkId: string): Promise<number> {
    const result = await this.db
      .delete(schema.memoryLinks)
      .where(
        or(
          eq(schema.memoryLinks.sourceChunkId, chunkId),
          eq(schema.memoryLinks.targetChunkId, chunkId),
        ),
      )
      .returning({ id: schema.memoryLinks.id });

    return result.length;
  }

  async getLinkedChunks(chunkId: string, options: LinkQueryOptions = {}): Promise<LinkedChunk[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
    const minStrength = Math.max(0, Math.min(options.minStrength ?? 0, 1));

    const query = sql<LinkedChunkRow>`
      SELECT
        ml.source_chunk_id AS "sourceChunkId",
        ml.target_chunk_id AS "targetChunkId",
        ml.link_type AS "linkType",
        ml.strength AS "strength",
        ml.metadata AS "metadata",
        pe.file_path AS "targetPromptKey",
        pe.memory_type AS "targetMemoryType",
        pe.updated_at AS "targetUpdatedAt"
      FROM ${schema.memoryLinks} ml
      LEFT JOIN ${schema.promptEmbeddings} pe
        ON pe.chunk_id = ml.target_chunk_id
      WHERE ml.source_chunk_id = ${chunkId}
        AND ml.strength >= ${minStrength}
      ORDER BY ml.strength DESC, ml.target_chunk_id ASC
      LIMIT ${limit}
    `;

    const { rows } = await this.db.execute(query);

    return rows.map((row) => ({
      sourceChunkId:
        typeof row.sourceChunkId === 'string' ? row.sourceChunkId : String(row.sourceChunkId),
      targetChunkId:
        typeof row.targetChunkId === 'string' ? row.targetChunkId : String(row.targetChunkId),
      linkType: (row.linkType ?? 'related') as MemoryLinkType,
      strength: Number(row.strength ?? 0),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      targetPromptKey: row.targetPromptKey == null ? null : String(row.targetPromptKey),
      targetMemoryType: (row.targetMemoryType ?? null) as MemoryType | null,
      targetUpdatedAt: row.targetUpdatedAt == null ? null : String(row.targetUpdatedAt),
    }));
  }

  async findCluster(
    rootChunkId: string,
    options: ClusterOptions = {},
  ): Promise<ChunkCluster | null> {
    const depth = Math.max(0, options.depth ?? 1);
    const limitPerNode = Math.max(1, Math.min(options.limitPerNode ?? 10, 100));
    const minStrength = Math.max(0, Math.min(options.minStrength ?? 0, 1));

    const rootInfo = await this.getChunkSummary(rootChunkId);
    if (!rootInfo) {
      return null;
    }

    const nodes = new Map<string, ChunkClusterNode>();
    nodes.set(rootChunkId, {
      chunkId: rootChunkId,
      depth: 0,
      promptKey: rootInfo.promptKey,
      memoryType: rootInfo.memoryType,
    });

    const edges: LinkedChunk[] = [];
    const edgeKeys = new Set<string>();
    const visited = new Set<string>([rootChunkId]);
    const queue: Array<{ chunkId: string; depth: number }> = [{ chunkId: rootChunkId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= depth) {
        continue;
      }

      const neighbors = await this.getLinkedChunks(current.chunkId, {
        limit: limitPerNode,
        minStrength,
      });

      for (const neighbor of neighbors) {
        const edgeKey = `${neighbor.sourceChunkId}->${neighbor.targetChunkId}:${neighbor.linkType}`;
        if (!edgeKeys.has(edgeKey)) {
          edgeKeys.add(edgeKey);
          edges.push(neighbor);
        }

        if (!nodes.has(neighbor.targetChunkId)) {
          nodes.set(neighbor.targetChunkId, {
            chunkId: neighbor.targetChunkId,
            depth: current.depth + 1,
            promptKey: neighbor.targetPromptKey,
            memoryType: neighbor.targetMemoryType,
          });
        }

        if (!visited.has(neighbor.targetChunkId) && current.depth + 1 <= depth) {
          visited.add(neighbor.targetChunkId);
          queue.push({
            chunkId: neighbor.targetChunkId,
            depth: current.depth + 1,
          });
        }
      }
    }

    return {
      root: nodes.get(rootChunkId)!,
      nodes: Array.from(nodes.values()).sort((a, b) => a.depth - b.depth),
      edges,
    };
  }

  private async getChunkSummary(
    chunkId: string,
  ): Promise<{ promptKey: string | null; memoryType: MemoryType | null } | null> {
    const query = sql<{ promptKey: string | null; memoryType: MemoryType | null }>`
      SELECT
        ${schema.promptEmbeddings.filePath} AS "promptKey",
        ${schema.promptEmbeddings.memoryType} AS "memoryType"
      FROM ${schema.promptEmbeddings}
      WHERE ${schema.promptEmbeddings.chunkId} = ${chunkId}
      LIMIT 1
    `;

    const { rows } = await this.db.execute(query);
    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      promptKey: row.promptKey == null ? null : String(row.promptKey),
      memoryType: (row.memoryType ?? null) as MemoryType | null,
    };
  }
}

interface LinkedChunkRow {
  sourceChunkId: string;
  targetChunkId: string;
  linkType: MemoryLinkType;
  strength: number;
  metadata: Record<string, unknown>;
  targetPromptKey: string | null;
  targetMemoryType: MemoryType | null;
  targetUpdatedAt: string | null;
}
