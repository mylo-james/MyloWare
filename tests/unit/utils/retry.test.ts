import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryableError } from '@/utils/retry.js';

describe('retry', () => {
  it('should succeed on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(fn, { maxRetries: 3 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxRetries: 3,
      initialDelay: 5,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after max retries', async () => {
    const error = new Error('Persistent error');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, {
        maxRetries: 2,
        initialDelay: 5,
      })
    ).rejects.toThrow('Persistent error');
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('should use exponential backoff', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Error'));
    await expect(
      withRetry(fn, {
        maxRetries: 2,
        initialDelay: 5,
        backoff: 'exponential',
        backoffMultiplier: 2,
      })
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should respect retryable function', async () => {
    const retryableError = new Error('Network error');
    const nonRetryableError = new Error('Validation error');

    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableError)
      .mockRejectedValueOnce(nonRetryableError);

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        initialDelay: 5,
        retryable: (error) => {
          return error instanceof Error && error.message.includes('Network');
        },
      })
    ).rejects.toThrow('Validation error');
    expect(fn).toHaveBeenCalledTimes(2); // Initial + 1 retry, then stops
  });

  describe('isRetryableError', () => {
    it('should identify network errors as retryable', () => {
      expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isRetryableError(new Error('ENOTFOUND'))).toBe(true);
    });

    it('should identify 5xx errors as retryable', () => {
      expect(isRetryableError(new Error('500 Internal Server Error'))).toBe(true);
      expect(isRetryableError(new Error('502 Bad Gateway'))).toBe(true);
    });

    it('should identify rate limit errors as retryable', () => {
      expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
      expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
    });

    it('should not identify 4xx errors as retryable', () => {
      expect(isRetryableError(new Error('400 Bad Request'))).toBe(false);
      expect(isRetryableError(new Error('404 Not Found'))).toBe(false);
    });
  });
});
