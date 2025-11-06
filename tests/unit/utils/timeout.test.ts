import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, TimeoutError } from '@/utils/timeout.js';

describe('timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return result if function completes before timeout', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const promise = withTimeout(fn, { timeout: 1000 });
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw TimeoutError if timeout exceeded', async () => {
    const fn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 2000))
    );

    const promise = withTimeout(fn, {
      timeout: 1000,
      message: 'Custom timeout message',
    });

    // Fast-forward past timeout
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).rejects.toThrow(TimeoutError);
    await expect(promise).rejects.toThrow('Custom timeout message');
  });

  it('should include timeout duration in error', async () => {
    const fn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 2000))
    );

    const promise = withTimeout(fn, { timeout: 500 });

    await vi.advanceTimersByTimeAsync(500);

    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      if (error instanceof TimeoutError) {
        expect(error.timeout).toBe(500);
      }
    }
  });
});

