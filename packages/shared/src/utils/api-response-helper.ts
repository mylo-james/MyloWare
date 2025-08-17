import { ApiResponse, ApiError, ApiMeta } from '../types/api-response';

/**
 * Create a successful API response
 */
export function createSuccessResponse<T>(data: T, meta?: ApiMeta): ApiResponse<T> {
  const response: ApiResponse<T> = {
    success: true,
    data,
  };

  if (meta !== undefined) {
    response.meta = meta;
  }

  return response;
}

/**
 * Create an error API response
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: Record<string, any>
): ApiResponse {
  const error: ApiError = {
    code,
    message,
    timestamp: new Date().toISOString(),
  };

  if (details !== undefined) {
    error.details = details;
  }

  return {
    success: false,
    error,
  };
}

/**
 * Create pagination metadata
 */
export function createPaginationMeta(page: number, limit: number, total: number): ApiMeta {
  return {
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
