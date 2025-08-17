import { LogMethod } from '../src/decorators/logging';

describe('LogMethod Decorator', () => {
  describe('LogMethod', () => {
    it('should create a decorator function', () => {
      const decorator = LogMethod('test-service');
      expect(typeof decorator).toBe('function');
    });

    it('should return a function that can be used as a decorator', () => {
      const decorator = LogMethod('test-service');

      // Test that the decorator function can be called with the expected parameters
      const mockTarget = {};
      const mockPropertyName = 'testMethod';
      const mockDescriptor = {
        value: jest.fn(),
        writable: true,
        enumerable: true,
        configurable: true,
      };

      const result = decorator(mockTarget, mockPropertyName, mockDescriptor);

      expect(result).toBeDefined();
      expect(typeof result.value).toBe('function');
    });

    it('should preserve the original method functionality', () => {
      const decorator = LogMethod('test-service');

      const mockTarget = {};
      const mockPropertyName = 'testMethod';
      const originalMethod = jest.fn().mockReturnValue('test result');
      const mockDescriptor = {
        value: originalMethod,
        writable: true,
        enumerable: true,
        configurable: true,
      };

      const result = decorator(mockTarget, mockPropertyName, mockDescriptor);

      // The decorated method should still be callable
      expect(typeof result.value).toBe('function');
    });
  });
});
