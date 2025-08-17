/**
 * Standardized API Response wrapper for all API responses
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ApiMeta;
}

/**
 * API Error structure
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

/**
 * API Metadata for pagination and additional info
 */
export interface ApiMeta {
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  requestId?: string;
  version?: string;
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
