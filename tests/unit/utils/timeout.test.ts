import { describe, it, expect, vi } from 'vitest';
import { withTimeout, TimeoutError } from '@/utils/timeout.js';

describe('timeout', () => {
  it('should return result if function completes before timeout', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const promise = withTimeout(fn, { timeout: 1000 });
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw TimeoutError if timeout exceeded', async () => {
    const fn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );

    const promise = withTimeout(fn, {
      timeout: 50,
      message: 'Custom timeout message',
    });

    await expect(promise).rejects.toThrow(TimeoutError);
    await expect(promise).rejects.toThrow('Custom timeout message');
  });

  it('should include timeout duration in error', async () => {
    const fn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );

    const promise = withTimeout(fn, { timeout: 75 });

    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      if (error instanceof TimeoutError) {
        expect(error.timeout).toBe(75);
      }
    }
  });
});
