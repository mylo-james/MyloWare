import { createLogger } from '../utils/logger';

/**
 * Method decorator for automatic logging
 */
export function LogMethod(
  serviceName: string
): (target: unknown, propertyName: string, descriptor: PropertyDescriptor) => PropertyDescriptor {
  return function (
    target: unknown,
    propertyName: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const method = descriptor.value;
    const logger = createLogger(serviceName);

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
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
