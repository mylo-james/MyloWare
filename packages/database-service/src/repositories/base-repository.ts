import { PrismaClient } from '@prisma/client';
import { BaseRepository, QueryOptions, PaginatedResult } from '../types';

export abstract class BaseRepositoryImpl<T, CreateInput, UpdateInput>
  implements BaseRepository<T, CreateInput, UpdateInput>
{
  protected prisma: PrismaClient;
  protected modelName: string;

  constructor(prisma: PrismaClient, modelName: string) {
    this.prisma = prisma;
    this.modelName = modelName;
  }

  abstract findById(id: string): Promise<T | null>;
  abstract findMany(options?: QueryOptions): Promise<PaginatedResult<T>>;
  abstract create(data: CreateInput): Promise<T>;
  abstract update(id: string, data: UpdateInput): Promise<T>;
  abstract delete(id: string): Promise<void>;

  protected buildPaginationQuery(options?: QueryOptions) {
    const page = options?.pagination?.page || 1;
    const limit = options?.pagination?.limit || 10;
    const offset = options?.pagination?.offset || (page - 1) * limit;

    return {
      skip: offset,
      take: limit,
    };
  }

  protected buildSortQuery(options?: QueryOptions) {
    if (!options?.sort) {
      return { createdAt: 'desc' as const };
    }

    return {
      [options.sort.field]: options.sort.direction,
    };
  }

  protected async buildPaginatedResult<TData>(
    data: TData[],
    total: number,
    options?: QueryOptions
  ): Promise<PaginatedResult<TData>> {
    const page = options?.pagination?.page || 1;
    const limit = options?.pagination?.limit || 10;
    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }
}