import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FEATURE_ENV_VARS = [
  'HYBRID_SEARCH_ENABLED',
  'MEMORY_ROUTING_ENABLED',
  'EPISODIC_MEMORY_ENABLED',
  'MEMORY_GRAPH_ENABLED',
  'ADAPTIVE_RETRIEVAL_ENABLED',
  'RUNTIME_MEMORY_ENABLED',
] as const;

type FeatureEnvVar = (typeof FEATURE_ENV_VARS)[number];

const originalEnv: Partial<Record<FeatureEnvVar, string | undefined>> = {};

beforeEach(() => {
  for (const envVar of FEATURE_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }

  vi.resetModules();
});

afterEach(() => {
  for (const envVar of FEATURE_ENV_VARS) {
    const value = originalEnv[envVar];
    if (value === undefined) {
      delete process.env[envVar];
    } else {
      process.env[envVar] = value;
    }
  }

  vi.resetModules();
});

describe('featureFlags', () => {
  it('uses default values when environment variables are unset', async () => {
    const module = await import('./featureFlags.js');

    for (const flag of module.featureFlagNames) {
      expect(module.isFeatureEnabled(flag)).toBe(false);
    }
  });

  it('reads truthy environment variables as enabled flags', async () => {
    process.env.HYBRID_SEARCH_ENABLED = 'true';

    const module = await import('./featureFlags.js');

    expect(module.isFeatureEnabled('hybridSearch')).toBe(true);
  });

  it('supports runtime overrides and reset helpers', async () => {
    const module = await import('./featureFlags.js');

    module.setFeatureFlag('hybridSearch', true);
    expect(module.isFeatureEnabled('hybridSearch')).toBe(true);

    module.resetFeatureFlag('hybridSearch');
    expect(module.isFeatureEnabled('hybridSearch')).toBe(false);

    module.setFeatureFlag('adaptiveRetrieval', true);
    module.resetAllFeatureFlags();

    expect(module.isFeatureEnabled('adaptiveRetrieval')).toBe(false);
  });
});
