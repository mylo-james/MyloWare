import {
  createSuccessResponse,
  createErrorResponse,
  createPaginationMeta,
} from './api-response-helper';

describe('API Response Helper', () => {
  describe('createSuccessResponse', () => {
    it('should create a successful response with data', () => {
      const data = { id: '123', name: 'test' };
      const response = createSuccessResponse(data);

      expect(response).toEqual({
        success: true,
        data,
      });
    });

    it('should create a successful response with data and meta', () => {
      const data = { id: '123', name: 'test' };
      const meta = { requestId: 'req-123' };
      const response = createSuccessResponse(data, meta);

      expect(response).toEqual({
        success: true,
        data,
        meta,
      });
    });
  });

  describe('createErrorResponse', () => {
    it('should create an error response with code and message', () => {
      const response = createErrorResponse('TEST_ERROR', 'Test error message');

      expect(response.success).toBe(false);
      expect(response.error).toMatchObject({
        code: 'TEST_ERROR',
        message: 'Test error message',
      });
      expect(response.error?.timestamp).toBeDefined();
    });

    it('should create an error response with details', () => {
      const details = { field: 'value' };
      const response = createErrorResponse('TEST_ERROR', 'Test error message', details);

      expect(response.error?.details).toEqual(details);
    });
  });

  describe('createPaginationMeta', () => {
    it('should create pagination metadata', () => {
      const meta = createPaginationMeta(2, 10, 25);

      expect(meta).toEqual({
        pagination: {
          page: 2,
          limit: 10,
          total: 25,
          totalPages: 3,
        },
      });
    });

    it('should handle exact division', () => {
      const meta = createPaginationMeta(1, 10, 20);

      expect(meta.pagination?.totalPages).toBe(2);
    });
  });
});
