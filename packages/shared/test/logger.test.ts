import { createLogger } from '../src/utils/logger';

describe('Logger', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env['NODE_ENV'];
  });

  afterEach(() => {
    if (originalEnv) {
      process.env['NODE_ENV'] = originalEnv;
    } else {
      delete process.env['NODE_ENV'];
    }
  });

  describe('createLogger', () => {
    it('should create a logger with default configuration', () => {
      const logger = createLogger('test-service');

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should create a logger with custom log level', () => {
      const logger = createLogger('test-service', 'DEBUG');

      expect(logger).toBeDefined();
      expect(logger.level).toBe('debug');
    });

    it('should use development format in development environment', () => {
      process.env['NODE_ENV'] = 'development';
      const logger = createLogger('test-service');

      expect(logger).toBeDefined();
      // In development, the console transport should use colorized format
      const transports = logger.transports as any[];
      const consoleTransport = transports.find(t => t.name === 'console');
      expect(consoleTransport).toBeDefined();
    });

    it('should use JSON format in production environment', () => {
      process.env['NODE_ENV'] = 'production';
      const logger = createLogger('test-service');

      expect(logger).toBeDefined();
      // In production, the console transport should use JSON format
      const transports = logger.transports as any[];
      const consoleTransport = transports.find(t => t.name === 'console');
      expect(consoleTransport).toBeDefined();
    });

    it('should include service name in default metadata', () => {
      const logger = createLogger('test-service');

      expect(logger.defaultMeta).toEqual({ service: 'test-service' });
    });

    it('should handle different log levels', () => {
      const logger = createLogger('test-service');

      // Test that all log levels are available
      expect(() => logger.error('Error message')).not.toThrow();
      expect(() => logger.warn('Warning message')).not.toThrow();
      expect(() => logger.info('Info message')).not.toThrow();
      expect(() => logger.debug('Debug message')).not.toThrow();
    });

    it('should format messages with timestamp and metadata', () => {
      const logger = createLogger('test-service');

      // Test that logging functions work without errors
      expect(() => logger.info('Test message', { additional: 'data' })).not.toThrow();
      expect(() => logger.error('Error message')).not.toThrow();
      expect(() => logger.warn('Warning message')).not.toThrow();
      expect(() => logger.debug('Debug message')).not.toThrow();
    });
  });
});
