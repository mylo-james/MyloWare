import { EnvLoader, loadEnvironmentVariables, validateEnvironmentVariables, getEnv } from './env-loader';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('EnvLoader', () => {
  let envLoader: EnvLoader;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Reset process.env
    process.env = {};
    
    // Reset singleton instance for testing
    (EnvLoader as any).instance = undefined;
    
    // Create new instance
    envLoader = EnvLoader.getInstance();
    
    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getInstance', () => {
    it('should return the same instance', () => {
      const instance1 = EnvLoader.getInstance();
      const instance2 = EnvLoader.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('loadEnv', () => {
    it('should load environment variables from .env file', () => {
      const mockEnvContent = `
DATABASE_URL=postgresql://localhost:5432/test
REDIS_URL=redis://localhost:6379
NODE_ENV=test
      `.trim();

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(mockEnvContent);

      envLoader.loadEnv();

      expect(process.env['DATABASE_URL']).toBe('postgresql://localhost:5432/test');
      expect(process.env['REDIS_URL']).toBe('redis://localhost:6379');
      expect(process.env['NODE_ENV']).toBe('test');
    });

    it('should skip comments and empty lines', () => {
      const mockEnvContent = `
# This is a comment
DATABASE_URL=postgresql://localhost:5432/test

# Another comment
REDIS_URL=redis://localhost:6379
      `.trim();

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(mockEnvContent);

      envLoader.loadEnv();

      expect(process.env['DATABASE_URL']).toBe('postgresql://localhost:5432/test');
      expect(process.env['REDIS_URL']).toBe('redis://localhost:6379');
      expect(process.env['# This is a comment']).toBeUndefined();
    });

    it('should handle quoted values', () => {
      const mockEnvContent = `
DATABASE_URL="postgresql://localhost:5432/test"
REDIS_URL='redis://localhost:6379'
API_KEY="test-key-123"
      `.trim();

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(mockEnvContent);

      envLoader.loadEnv();

      expect(process.env['DATABASE_URL']).toBe('postgresql://localhost:5432/test');
      expect(process.env['REDIS_URL']).toBe('redis://localhost:6379');
      expect(process.env['API_KEY']).toBe('test-key-123');
    });

    it('should not load if already loaded', () => {
      const mockEnvContent = 'DATABASE_URL=test';
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(mockEnvContent);

      envLoader.loadEnv();
      envLoader.loadEnv(); // Second call

      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('should handle missing .env file gracefully', () => {
      mockedFs.existsSync.mockReturnValue(false);

      expect(() => envLoader.loadEnv()).not.toThrow();
    });
  });

  describe('get', () => {
    it('should return environment variable value', () => {
      process.env['TEST_VAR'] = 'test-value';
      expect(envLoader.get('TEST_VAR')).toBe('test-value');
    });

    it('should return fallback if variable not found', () => {
      expect(envLoader.get('MISSING_VAR', 'fallback')).toBe('fallback');
    });

    it('should return undefined if no fallback provided', () => {
      expect(envLoader.get('MISSING_VAR')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all environment variables', () => {
      process.env['VAR1'] = 'value1';
      process.env['VAR2'] = 'value2';

      const all = envLoader.getAll();
      expect(all['VAR1']).toBe('value1');
      expect(all['VAR2']).toBe('value2');
    });
  });

  describe('validateEnv', () => {
    it('should return valid when all required variables are present', () => {
      process.env['DATABASE_URL'] = 'postgresql://localhost:5432/test';
      process.env['REDIS_URL'] = 'redis://localhost:6379';
      process.env['TEMPORAL_HOST'] = 'localhost';
      process.env['TEMPORAL_PORT'] = '7233';
      process.env['PUSHOVER_USER_KEY'] = 'test-user-key';
      process.env['PUSHOVER_APP_TOKEN'] = 'test-app-token';

      const result = envLoader.validateEnv();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid when required variables are missing', () => {
      const result = envLoader.validateEnv();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('isConfigured', () => {
    it('should return true when environment is properly configured', () => {
      process.env['DATABASE_URL'] = 'postgresql://localhost:5432/test';
      process.env['REDIS_URL'] = 'redis://localhost:6379';
      process.env['TEMPORAL_HOST'] = 'localhost';
      process.env['TEMPORAL_PORT'] = '7233';
      process.env['PUSHOVER_USER_KEY'] = 'test-user-key';
      process.env['PUSHOVER_APP_TOKEN'] = 'test-app-token';

      expect(envLoader.isConfigured()).toBe(true);
    });

    it('should return false when environment is not properly configured', () => {
      expect(envLoader.isConfigured()).toBe(false);
    });
  });
});

describe('Convenience functions', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env = {};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadEnvironmentVariables', () => {
    it('should load environment variables', () => {
      const mockEnvContent = 'DATABASE_URL=test';
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(mockEnvContent);

      loadEnvironmentVariables();

      expect(process.env['DATABASE_URL']).toBe('test');
    });
  });

  describe('validateEnvironmentVariables', () => {
    it('should validate environment variables', () => {
      const result = validateEnvironmentVariables();
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
    });
  });

  describe('getEnv', () => {
    it('should get environment variable', () => {
      process.env['TEST_VAR'] = 'test-value';
      expect(getEnv('TEST_VAR')).toBe('test-value');
    });

    it('should return fallback if variable not found', () => {
      expect(getEnv('MISSING_VAR', 'fallback')).toBe('fallback');
    });
  });
});
