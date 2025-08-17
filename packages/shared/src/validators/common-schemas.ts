import Joi from 'joi';

/**
 * Common validation schemas
 */
export const commonSchemas = {
  id: Joi.string().uuid().required(),
  email: Joi.string().email().required(),
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required(),
  timestamp: Joi.date().iso().required(),
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
  }),
};

/**
 * Environment variable validation schema
 */
export const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production').default('development'),
  LOG_LEVEL: Joi.string().valid('ERROR', 'WARN', 'INFO', 'DEBUG').default('INFO'),
  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().required(),
  TEMPORAL_HOST: Joi.string().hostname().required(),
  TEMPORAL_PORT: Joi.number().port().required(),
});
