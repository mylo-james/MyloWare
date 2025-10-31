const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);

type FeatureFlagDefinition = {
  readonly envVar: string;
  readonly defaultValue: boolean;
  readonly description: string;
};

const flagDefinitions = {
  hybridSearch: {
    envVar: 'HYBRID_SEARCH_ENABLED',
    defaultValue: false,
    description: 'Enables hybrid keyword + vector retrieval for prompt search.',
  },
  memoryRouting: {
    envVar: 'MEMORY_ROUTING_ENABLED',
    defaultValue: false,
    description: 'Routes agent queries to specialized memory subsystems.',
  },
  episodicMemory: {
    envVar: 'EPISODIC_MEMORY_ENABLED',
    defaultValue: false,
    description: 'Stores conversation-specific episodic memories.',
  },
  memoryGraph: {
    envVar: 'MEMORY_GRAPH_ENABLED',
    defaultValue: false,
    description: 'Activates graph-based memory traversal and linking.',
  },
  adaptiveRetrieval: {
    envVar: 'ADAPTIVE_RETRIEVAL_ENABLED',
    defaultValue: false,
    description: 'Adjusts retrieval strategy dynamically at runtime.',
  },
  runtimeMemory: {
    envVar: 'RUNTIME_MEMORY_ENABLED',
    defaultValue: false,
    description: 'Allows agents to add memories during execution.',
  },
} as const satisfies Record<string, FeatureFlagDefinition>;

type FlagDefinitions = typeof flagDefinitions;

export type FeatureFlagName = keyof FlagDefinitions;
export type FeatureFlagSnapshot = Record<FeatureFlagName, boolean>;

const flagNames = Object.freeze(Object.keys(flagDefinitions) as FeatureFlagName[]);

const baseFeatureFlags: FeatureFlagSnapshot = (() => {
  const snapshot = {} as FeatureFlagSnapshot;

  for (const flag of flagNames) {
    const definition = flagDefinitions[flag];
    snapshot[flag] = parseFlagValue(definition.envVar, definition.defaultValue);
  }

  return Object.freeze(snapshot);
})();

const overrides: Partial<FeatureFlagSnapshot> = {};

export const featureFlagDefinitions = flagDefinitions;
export const featureFlagNames = flagNames;

export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  return overrides[flag] ?? baseFeatureFlags[flag];
}

export function setFeatureFlag(flag: FeatureFlagName, value: boolean): void {
  overrides[flag] = value;
}

export function resetFeatureFlag(flag: FeatureFlagName): void {
  delete overrides[flag];
}

export function resetAllFeatureFlags(): void {
  for (const flag of featureFlagNames) {
    delete overrides[flag];
  }
}

export function getFeatureFlagsSnapshot(): FeatureFlagSnapshot {
  return featureFlagNames.reduce<FeatureFlagSnapshot>((snapshot, flag) => {
    snapshot[flag] = isFeatureEnabled(flag);
    return snapshot;
  }, {} as FeatureFlagSnapshot);
}

function parseFlagValue(envVar: string, defaultValue: boolean): boolean {
  const rawValue = process.env[envVar];

  if (rawValue === undefined || rawValue === null || rawValue.trim() === '') {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();

  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new Error(
    `Invalid boolean value "${rawValue}" provided for ${envVar}. Expected one of: ` +
      `${Array.from(TRUE_VALUES).join(', ')}, ${Array.from(FALSE_VALUES).join(', ')}.`,
  );
}
