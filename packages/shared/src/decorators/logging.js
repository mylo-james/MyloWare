'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.LogMethod = LogMethod;
const logger_1 = require('../utils/logger');
/**
 * Method decorator for automatic logging
 */
function LogMethod(serviceName) {
  return function (target, propertyName, descriptor) {
    const method = descriptor.value;
    const logger = (0, logger_1.createLogger)(serviceName);
    descriptor.value = async function (...args) {
      const start = Date.now();
      logger.info(`[${propertyName}] Starting execution`, { args: args.length });
      try {
        const result = await method.apply(this, args);
        const duration = Date.now() - start;
        logger.info(`[${propertyName}] Completed successfully`, { duration });
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        logger.error(`[${propertyName}] Failed with error`, {
          error: error instanceof Error ? error.message : String(error),
          duration,
        });
        throw error;
      }
    };
    return descriptor;
  };
}
//# sourceMappingURL=logging.js.map
