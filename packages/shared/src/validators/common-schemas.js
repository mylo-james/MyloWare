'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.envSchema = exports.commonSchemas = void 0;
const joi_1 = __importDefault(require('joi'));
/**
 * Common validation schemas
 */
exports.commonSchemas = {
  id: joi_1.default.string().uuid().required(),
  email: joi_1.default.string().email().required(),
  password: joi_1.default
    .string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required(),
  timestamp: joi_1.default.date().iso().required(),
  pagination: joi_1.default.object({
    page: joi_1.default.number().integer().min(1).default(1),
    limit: joi_1.default.number().integer().min(1).max(100).default(20),
    sortBy: joi_1.default.string().optional(),
    sortOrder: joi_1.default.string().valid('asc', 'desc').default('asc'),
  }),
};
/**
 * Environment variable validation schema
 */
exports.envSchema = joi_1.default.object({
  NODE_ENV: joi_1.default
    .string()
    .valid('development', 'staging', 'production')
    .default('development'),
  LOG_LEVEL: joi_1.default.string().valid('ERROR', 'WARN', 'INFO', 'DEBUG').default('INFO'),
  DATABASE_URL: joi_1.default.string().uri().required(),
  REDIS_URL: joi_1.default.string().uri().required(),
  TEMPORAL_HOST: joi_1.default.string().hostname().required(),
  TEMPORAL_PORT: joi_1.default.number().port().required(),
});
//# sourceMappingURL=common-schemas.js.map
