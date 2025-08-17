import { PrismaClient, MemDoc, Prisma, MemDocType } from '@prisma/client';
import { BaseRepositoryImpl } from './base-repository';
import { QueryOptions, PaginatedResult, VectorSearchOptions, VectorSearchResult } from '../types';

export class MemDocRepository extends BaseRepositoryImpl<
  MemDoc,
  Prisma.MemDocCreateInput,
  Prisma.MemDocUpdateInput
> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'MemDoc');
  }

  async findById(id: string): Promise<MemDoc | null> {
    return this.prisma.memDoc.findUnique({
      where: { id },
      include: {
        workItem: true,
      },
    });
  }

  async findMany(options?: QueryOptions): Promise<PaginatedResult<MemDoc>> {
    const pagination = this.buildPaginationQuery(options);
    const orderBy = this.buildSortQuery(options);

    const [data, total] = await Promise.all([
      this.prisma.memDoc.findMany({
        ...pagination,
        orderBy,
        include: options?.include || {
          workItem: true,
        },
      }),
      this.prisma.memDoc.count(),
    ]);

    return this.buildPaginatedResult(data, total, options);
  }

  async create(data: Prisma.MemDocCreateInput): Promise<MemDoc> {
    return this.prisma.memDoc.create({
      data,
      include: {
        workItem: true,
      },
    });
  }

  async update(id: string, data: Prisma.MemDocUpdateInput): Promise<MemDoc> {
    return this.prisma.memDoc.update({
      where: { id },
      data,
      include: {
        workItem: true,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.memDoc.delete({
      where: { id },
    });
  }

  // Vector search methods
  async findSimilar(options: VectorSearchOptions): Promise<VectorSearchResult<MemDoc>[]> {
    const { embedding, limit = 10, threshold = 0.7 } = options;
    
    // Convert embedding array to pgvector format
    const embeddingString = `[${embedding.join(',')}]`;
    
    const results = await this.prisma.$queryRaw<Array<MemDoc & { similarity: number }>>`
      SELECT m.*, 1 - (m.embedding <=> ${embeddingString}::vector) as similarity
      FROM mem_docs m
      WHERE m.embedding IS NOT NULL
        AND 1 - (m.embedding <=> ${embeddingString}::vector) > ${threshold}
      ORDER BY m.embedding <=> ${embeddingString}::vector
      LIMIT ${limit}
    `;

    return results.map(result => ({
      item: {
        id: result.id,
        workItemId: result.workItemId,
        type: result.type,
        content: result.content,
        embedding: (result as any).embedding,
        metadata: result.metadata,
        createdAt: result.createdAt,
        lastAccessed: result.lastAccessed,
      },
      similarity: result.similarity,
    }));
  }

  async findByWorkItemId(workItemId: string, options?: QueryOptions): Promise<PaginatedResult<MemDoc>> {
    const pagination = this.buildPaginationQuery(options);
    const orderBy = this.buildSortQuery(options);

    const [data, total] = await Promise.all([
      this.prisma.memDoc.findMany({
        where: { workItemId },
        ...pagination,
        orderBy,
        include: {
          workItem: true,
        },
      }),
      this.prisma.memDoc.count({
        where: { workItemId },
      }),
    ]);

    return this.buildPaginatedResult(data, total, options);
  }

  async findByType(
    type: MemDocType,
    options?: QueryOptions
  ): Promise<PaginatedResult<MemDoc>> {
    const pagination = this.buildPaginationQuery(options);
    const orderBy = this.buildSortQuery(options);

    const [data, total] = await Promise.all([
      this.prisma.memDoc.findMany({
        where: { type },
        ...pagination,
        orderBy,
        include: {
          workItem: true,
        },
      }),
      this.prisma.memDoc.count({
        where: { type },
      }),
    ]);

    return this.buildPaginatedResult(data, total, options);
  }

  async updateLastAccessed(id: string): Promise<MemDoc> {
    return this.prisma.memDoc.update({
      where: { id },
      data: {
        lastAccessed: new Date(),
      },
    });
  }
}