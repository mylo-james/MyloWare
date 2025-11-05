import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '@/utils/retry.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should succeed on first try', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');

    const promise = withRetry(fn, {
      maxRetries: 2,
      initialDelay: 100,
    });

    // Advance timer by delay
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should stop after max retries', async () => {
    const error = new Error('always fails');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        initialDelay: 100,
      })
    ).rejects.toThrow('always fails');

    // Advance timers for all retries
    await vi.advanceTimersByTimeAsync(100 + 200 + 400);

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should use exponential backoff', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');

    const promise = withRetry(fn, {
      maxRetries: 3,
      initialDelay: 100,
      backoffMultiplier: 2,
    });

    // First retry after 100ms
    await vi.advanceTimersByTimeAsync(100);
    // Second retry after 200ms
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should respect shouldRetry predicate', async () => {
    const retryableError = new Error('rate_limit');
    const nonRetryableError = new Error('invalid_request');

    const fn = vi.fn().mockRejectedValue(retryableError);

    const promise = withRetry(fn, {
      maxRetries: 2,
      initialDelay: 100,
      shouldRetry: (error) => error.message.includes('rate_limit'),
    });

    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).rejects.toThrow('rate_limit');
    expect(fn).toHaveBeenCalledTimes(2);

    // Test non-retryable error
    const fn2 = vi.fn().mockRejectedValue(nonRetryableError);
    await expect(
      withRetry(fn2, {
        shouldRetry: (error) => error.message.includes('rate_limit'),
      })
    ).rejects.toThrow('invalid_request');
    expect(fn2).toHaveBeenCalledTimes(1); // No retries
  });
});

