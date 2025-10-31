const LN2 = Math.log(2);

export type TemporalDecayStrategy = 'exponential' | 'linear' | 'none';

export interface TemporalDecayConfig {
  strategy: TemporalDecayStrategy;
  halfLifeDays?: number;
  maxAgeDays?: number;
}

export function exponentialDecay(score: number, ageDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }

  if (!Number.isFinite(ageDays) || ageDays <= 0) {
    return score;
  }

  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) {
    return score;
  }

  const lambda = LN2 / halfLifeDays;
  return score * Math.exp(-lambda * ageDays);
}

export function linearDecay(score: number, ageDays: number, maxAgeDays: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }

  if (!Number.isFinite(ageDays) || ageDays <= 0) {
    return score;
  }

  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    return score;
  }

  const remaining = Math.max(0, 1 - ageDays / maxAgeDays);
  return score * remaining;
}

export function applyTemporalDecay(
  score: number,
  ageDays: number,
  config: TemporalDecayConfig,
): number {
  switch (config.strategy) {
    case 'exponential':
      return exponentialDecay(score, Math.max(ageDays, 0), config.halfLifeDays ?? 90);
    case 'linear':
      return linearDecay(score, Math.max(ageDays, 0), config.maxAgeDays ?? 365);
    default:
      return score;
  }
}

export function computeAgeInDays(updatedAt: Date, now: Date): number {
  const milliseconds = now.getTime() - updatedAt.getTime();
  return milliseconds <= 0 ? 0 : milliseconds / (1000 * 60 * 60 * 24);
}
