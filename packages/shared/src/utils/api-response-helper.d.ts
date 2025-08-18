import { ApiResponse, ApiMeta } from '../types/api-response';
/**
 * Create a successful API response
 */
export declare function createSuccessResponse<T>(data: T, meta?: ApiMeta): ApiResponse<T>;
/**
 * Create an error API response
 */
export declare function createErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ApiResponse;
/**
 * Create pagination metadata
 */
export declare function createPaginationMeta(page: number, limit: number, total: number): ApiMeta;
//# sourceMappingURL=api-response-helper.d.ts.map
