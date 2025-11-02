import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, ValidationError, NotFoundError, DatabaseError } from '../types/errors';
import type { ApiErrorResponse } from '../types/errors';

export function errorHandler(
  error: FastifyError | ApiError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const errorResponse: ApiErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: request.id,
    },
  };

  let statusCode = 500;

  if (error instanceof ApiError) {
    statusCode = error.statusCode;
    errorResponse.error.code = error.code;
    errorResponse.error.message = error.message;
    if (error.details) {
      errorResponse.error.details = error.details;
    }

    // Log level based on status code
    if (statusCode >= 500) {
      request.log.error({ err: error, requestId: request.id }, 'Server error');
    } else if (statusCode >= 400) {
      request.log.warn({ err: error, requestId: request.id }, 'Client error');
    }
  } else if ('statusCode' in error && typeof error.statusCode === 'number') {
    // Fastify error
    statusCode = error.statusCode;
    errorResponse.error.code = error.code ?? 'FASTIFY_ERROR';
    errorResponse.error.message = error.message;
    request.log.error({ err: error, requestId: request.id }, 'Fastify error');
  } else {
    // Unknown error
    errorResponse.error.message = error.message || 'Internal server error';
    request.log.error({ err: error, requestId: request.id }, 'Unhandled error');
  }

  void reply.status(statusCode).send(errorResponse);
}

