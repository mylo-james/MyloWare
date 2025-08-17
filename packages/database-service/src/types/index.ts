// Re-export all Prisma generated types
export * from '@prisma/client';

// Custom types for database operations
export interface DatabaseConfig {
  url: string;
  maxConnections?: number;
  connectionTimeout?: number;
  queryTimeout?: number;
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
  offset?: number;
}

export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QueryOptions {
  pagination?: PaginationOptions;
  sort?: SortOptions;
  include?: Record<string, boolean>;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Repository interfaces
export interface BaseRepository<T, CreateInput, UpdateInput> {
  findById(id: string): Promise<T | null>;
  findMany(options?: QueryOptions): Promise<PaginatedResult<T>>;
  create(data: CreateInput): Promise<T>;
  update(id: string, data: UpdateInput): Promise<T>;
  delete(id: string): Promise<void>;
}

// Vector search types
export interface VectorSearchOptions {
  embedding: number[];
  limit?: number;
  threshold?: number;
}

export interface VectorSearchResult<T> {
  item: T;
  similarity: number;
}