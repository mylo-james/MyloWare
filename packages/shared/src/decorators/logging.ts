import { createLogger } from '../utils/logger';

/**
 * Method decorator for automatic logging
 */
export function LogMethod(serviceName: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    const logger = createLogger(serviceName);

    descriptor.value = async function (...args: any[]) {
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
