'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.DEFAULTS = void 0;
/**
 * Default configuration values
 */
exports.DEFAULTS = {
  // Pagination
  PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  // Timeouts (in milliseconds)
  DEFAULT_TIMEOUT: 30000,
  DATABASE_TIMEOUT: 10000,
  REDIS_TIMEOUT: 5000,
  // Retry attempts
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  // Logging
  LOG_LEVEL: 'INFO',
  // Database
  MAX_CONNECTIONS: 10,
  CONNECTION_TIMEOUT: 5000,
  // Redis
  REDIS_MAX_RETRIES: 3,
  REDIS_RETRY_DELAY: 1000,
};
//# sourceMappingURL=defaults.js.map
