import { describe, expect, it } from 'vitest';
import {
  applyTemporalDecay,
  computeAgeInDays,
  exponentialDecay,
  linearDecay,
} from './temporalScoring';

describe('temporalScoring', () => {
  it('applies exponential decay using half-life', () => {
    const original = 1;
    const halfLife = 90;
    const decayed = exponentialDecay(original, halfLife, halfLife);
    expect(decayed).toBeCloseTo(0.5, 3);
  });

  it('applies linear decay to zero after max age', () => {
    const result = linearDecay(0.8, 400, 365);
    expect(result).toBe(0);
  });

  it('returns original score when strategy is none', () => {
    const score = applyTemporalDecay(0.7, 120, { strategy: 'none' });
    expect(score).toBeCloseTo(0.7, 6);
  });

  it('handles negative ages as zero', () => {
    const score = applyTemporalDecay(0.9, -10, {
      strategy: 'exponential',
      halfLifeDays: 90,
    });
    expect(score).toBeCloseTo(0.9, 6);
  });

  it('computes age in days between timestamps', () => {
    const updatedAt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-11T00:00:00Z');
    const age = computeAgeInDays(updatedAt, now);
    expect(age).toBeCloseTo(10, 5);
  });
});
