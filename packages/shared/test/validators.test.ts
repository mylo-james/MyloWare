import Joi from 'joi';
import { commonSchemas, envSchema } from '../src/validators/common-schemas';

describe('Validation Schemas', () => {
  describe('commonSchemas', () => {
    describe('id', () => {
      it('should validate a valid UUID', () => {
        const validId = '123e4567-e89b-12d3-a456-426614174000';
        const result = commonSchemas.id.validate(validId);
        expect(result.error).toBeUndefined();
        expect(result.value).toBe(validId);
      });

      it('should reject invalid UUID', () => {
        const invalidId = 'invalid-uuid';
        const result = commonSchemas.id.validate(invalidId);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('must be a valid GUID');
      });

      it('should reject empty string', () => {
        const result = commonSchemas.id.validate('');
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('is not allowed to be empty');
      });

      it('should reject undefined', () => {
        const result = commonSchemas.id.validate(undefined);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('is required');
      });
    });

    describe('email', () => {
      it('should validate a valid email', () => {
        const validEmail = 'test@example.com';
        const result = commonSchemas.email.validate(validEmail);
        expect(result.error).toBeUndefined();
        expect(result.value).toBe(validEmail);
      });

      it('should reject invalid email format', () => {
        const invalidEmail = 'invalid-email';
        const result = commonSchemas.email.validate(invalidEmail);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('must be a valid email');
      });

      it('should reject empty string', () => {
        const result = commonSchemas.email.validate('');
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('is not allowed to be empty');
      });
    });

    describe('password', () => {
      it('should validate a strong password', () => {
        const validPassword = 'StrongP@ss123';
        const result = commonSchemas.password.validate(validPassword);
        expect(result.error).toBeUndefined();
        expect(result.value).toBe(validPassword);
      });

      it('should reject password without uppercase', () => {
        const weakPassword = 'weakp@ss123';
        const result = commonSchemas.password.validate(weakPassword);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('fails to match the required pattern');
      });

      it('should reject password without lowercase', () => {
        const weakPassword = 'WEAKP@SS123';
        const result = commonSchemas.password.validate(weakPassword);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('fails to match the required pattern');
      });

      it('should reject password without number', () => {
        const weakPassword = 'WeakP@ss';
        const result = commonSchemas.password.validate(weakPassword);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('fails to match the required pattern');
      });

      it('should reject password without special character', () => {
        const weakPassword = 'WeakPass123';
        const result = commonSchemas.password.validate(weakPassword);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('fails to match the required pattern');
      });

      it('should reject password shorter than 8 characters', () => {
        const shortPassword = 'W@k1';
        const result = commonSchemas.password.validate(shortPassword);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('length must be at least 8 characters long');
      });
    });

    describe('timestamp', () => {
      it('should validate a valid ISO date', () => {
        const validDate = '2024-12-19T15:00:00.000Z';
        const result = commonSchemas.timestamp.validate(validDate);
        expect(result.error).toBeUndefined();
        expect(result.value).toEqual(new Date(validDate));
      });

      it('should reject invalid date format', () => {
        const invalidDate = 'not-a-date';
        const result = commonSchemas.timestamp.validate(invalidDate);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('must be in ISO 8601 date format');
      });

      it('should reject non-date string', () => {
        const result = commonSchemas.timestamp.validate('not-a-date');
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('must be in ISO 8601 date format');
      });
    });

    describe('pagination', () => {
      it('should validate pagination with default values', () => {
        const result = commonSchemas.pagination.validate({});
        expect(result.error).toBeUndefined();
        expect(result.value).toEqual({
          page: 1,
          limit: 20,
          sortOrder: 'asc',
        });
      });

      it('should validate pagination with custom values', () => {
        const pagination = {
          page: 2,
          limit: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        };
        const result = commonSchemas.pagination.validate(pagination);
        expect(result.error).toBeUndefined();
        expect(result.value).toEqual(pagination);
      });

      it('should reject page less than 1', () => {
        const result = commonSchemas.pagination.validate({ page: 0 });
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('must be greater than or equal to 1');
      });

      it('should reject limit greater than 100', () => {
        const result = commonSchemas.pagination.validate({ limit: 101 });
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('must be less than or equal to 100');
      });

      it('should reject invalid sort order', () => {
        const result = commonSchemas.pagination.validate({ sortOrder: 'invalid' });
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('must be one of [asc, desc]');
      });
    });
  });

  describe('envSchema', () => {
    it('should validate complete environment configuration', () => {
      const env = {
        NODE_ENV: 'production',
        LOG_LEVEL: 'INFO',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        TEMPORAL_HOST: 'localhost',
        TEMPORAL_PORT: 7233,
      };
      const result = envSchema.validate(env);
      expect(result.error).toBeUndefined();
      expect(result.value).toEqual(env);
    });

    it('should use default values for optional fields', () => {
      const env = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        TEMPORAL_HOST: 'localhost',
        TEMPORAL_PORT: 7233,
      };
      const result = envSchema.validate(env);
      expect(result.error).toBeUndefined();
      expect(result.value).toEqual({
        NODE_ENV: 'development',
        LOG_LEVEL: 'INFO',
        ...env,
      });
    });

    it('should reject invalid NODE_ENV', () => {
      const env = {
        NODE_ENV: 'invalid',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        TEMPORAL_HOST: 'localhost',
        TEMPORAL_PORT: 7233,
      };
      const result = envSchema.validate(env);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('must be one of [development, staging, production]');
    });

    it('should reject invalid LOG_LEVEL', () => {
      const env = {
        LOG_LEVEL: 'INVALID',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        TEMPORAL_HOST: 'localhost',
        TEMPORAL_PORT: 7233,
      };
      const result = envSchema.validate(env);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('must be one of [ERROR, WARN, INFO, DEBUG]');
    });

    it('should reject invalid DATABASE_URL', () => {
      const env = {
        DATABASE_URL: 'invalid-url',
        REDIS_URL: 'redis://localhost:6379',
        TEMPORAL_HOST: 'localhost',
        TEMPORAL_PORT: 7233,
      };
      const result = envSchema.validate(env);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('must be a valid uri');
    });

    it('should reject invalid TEMPORAL_PORT', () => {
      const env = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        TEMPORAL_HOST: 'localhost',
        TEMPORAL_PORT: 99999,
      };
      const result = envSchema.validate(env);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('must be a valid port');
    });
  });
});
