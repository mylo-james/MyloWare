/**
 * Retry utility with exponential backoff
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoff?: 'exponential' | 'linear' | 'fixed';
  backoffMultiplier?: number;
  retryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryable'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoff: 'exponential',
  backoffMultiplier: 2,
};

/**
 * Retry a function with exponential backoff
 *
 * @param fn - Function to retry
 * @param options - Retry configuration
 * @returns Result of function execution
 * @throws Last error if all retries exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let delay = config.initialDelay;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (config.retryable && !config.retryable(error)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === config.maxRetries) {
        break;
      }

      // Calculate delay based on backoff strategy
      const waitTime = Math.min(delay, config.maxDelay);
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      // Update delay for next iteration
      switch (config.backoff) {
        case 'exponential':
          delay *= config.backoffMultiplier;
          break;
        case 'linear':
          delay += config.initialDelay;
          break;
        case 'fixed':
          // delay stays the same
          break;
      }
    }
  }

  throw lastError;
}

/**
 * Check if an error is a network/transient error that should be retried
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors
    if (
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('network')
    ) {
      return true;
    }

    // HTTP 5xx errors
    if (error.message.includes('50')) {
      return true;
    }

    // Rate limiting (429)
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      return true;
    }
  }

  return false;
}
