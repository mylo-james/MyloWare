/**
 * Timeout utility for async operations
 */

export class TimeoutError extends Error {
  constructor(message: string, public timeout: number) {
    super(message);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

export interface TimeoutOptions {
  timeout: number;
  message?: string;
}

/**
 * Wrap a promise with a timeout
 *
 * @param fn - Function to execute
 * @param options - Timeout configuration
 * @returns Result of function execution
 * @throws TimeoutError if timeout exceeded
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeout, message } = options;

  return Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(
          new TimeoutError(
            message || `Operation timed out after ${timeout}ms`,
            timeout
          )
        );
      }, timeout);
    }),
  ]);
}

