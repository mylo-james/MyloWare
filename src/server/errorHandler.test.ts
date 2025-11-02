import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { errorHandler } from './errorHandler';
import { ApiError, NotFoundError, ValidationError, DatabaseError } from '../types/errors';

describe('errorHandler', () => {
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;

  beforeEach(() => {
    mockRequest = {
      url: '/test',
      id: 'test-request-id',
      log: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
      } as never,
    };

    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
  });

  it('should handle NotFoundError with 404 status', () => {
    const error = new NotFoundError('Resource not found');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockReply.status).toHaveBeenCalledWith(404);
    expect(mockReply.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'NOT_FOUND',
        message: 'Resource not found',
        requestId: 'test-request-id',
        path: '/test',
      }),
    });
  });

  it('should handle ValidationError with 400 status', () => {
    const error = new ValidationError('Invalid input', { field: 'email' });

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockReply.status).toHaveBeenCalledWith(400);
    expect(mockReply.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { field: 'email' },
      }),
    });
  });

  it('should handle DatabaseError with 503 status', () => {
    const error = new DatabaseError('Connection failed');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockReply.status).toHaveBeenCalledWith(503);
    expect(mockReply.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'DATABASE_ERROR',
        message: 'Connection failed',
      }),
    });
  });

  it('should handle generic Error with 500 status', () => {
    const error = new Error('Unexpected error');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockReply.status).toHaveBeenCalledWith(500);
    expect(mockReply.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'INTERNAL_ERROR',
        message: 'Unexpected error',
      }),
    });
  });

  it('should include timestamp in error response', () => {
    const error = new NotFoundError('Not found');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    const sendArg = (mockReply.send as any).mock.calls[0][0];
    expect(sendArg.error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should log server errors (5xx) as error level', () => {
    const error = new ApiError(500, 'INTERNAL_ERROR', 'Server error');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockRequest.log!.error).toHaveBeenCalled();
  });

  it('should log client errors (4xx) as warn level', () => {
    const error = new NotFoundError('Not found');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockRequest.log!.warn).toHaveBeenCalled();
  });

  it('should handle Fastify errors with statusCode', () => {
    const error = {
      statusCode: 400,
      code: 'FASTIFY_ERROR',
      message: 'Fastify validation error',
    } as never;

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockReply.status).toHaveBeenCalledWith(400);
    expect(mockReply.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'FASTIFY_ERROR',
        message: 'Fastify validation error',
      }),
    });
  });

  it('should include path and requestId in all error responses', () => {
    const error = new Error('Test error');

    errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

    const sendArg = (mockReply.send as any).mock.calls[0][0];
    expect(sendArg.error.path).toBe('/test');
    expect(sendArg.error.requestId).toBe('test-request-id');
  });
});

