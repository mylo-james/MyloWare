'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.createSuccessResponse = createSuccessResponse;
exports.createErrorResponse = createErrorResponse;
exports.createPaginationMeta = createPaginationMeta;
/**
 * Create a successful API response
 */
function createSuccessResponse(data, meta) {
  const response = {
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
function createErrorResponse(code, message, details) {
  const error = {
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
function createPaginationMeta(page, limit, total) {
  return {
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
//# sourceMappingURL=api-response-helper.js.map
