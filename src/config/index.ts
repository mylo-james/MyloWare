import 'dotenv/config';
import { z } from 'zod';
import type { TemporalDecayStrategy } from '../vector/temporalScoring';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).catch('development'),
  SERVER_HOST: z.string().default('0.0.0.0'),
  SERVER_PORT: z.coerce.number().int().positive().default(3456),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  OPERATIONS_DATABASE_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  HTTP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  HTTP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  HTTP_ALLOWED_ORIGINS: z.string().optional(),
  HTTP_ALLOWED_HOSTS: z.string().optional(),
  MCP_API_KEY: z.string().optional(),
});

type Environment = z.infer<typeof envSchema>;

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const formatted = parsedEnv.error.errors
    .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
    .join('\n');

  throw new Error(`Invalid environment configuration:\n${formatted}`);
}

const data: Environment = parsedEnv.data;

const FULLTEXT_DEFAULT_WEIGHTS: Readonly<[number, number, number, number]> = Object.freeze([
  1.0, 0.4, 0.2, 0.1,
] as const);
const AUTO_MODE_DEFAULT_KEYWORD_WEIGHT = 1;
const AUTO_MODE_DEFAULT_VECTOR_WEIGHT = 1;
const AUTO_MODE_DEFAULT_HYBRID_WEIGHT = 1;
const AUTO_MODE_DEFAULT_PATTERN = '(?:[A-Z]{2,}\\d{2,}|[_:.-]{3,}|\\b[A-Za-z]+[_-]id\\b)';
const TEMPORAL_DEFAULT_STRATEGY = 'none';
const TEMPORAL_DEFAULT_HALFLIFE = 90;
const TEMPORAL_DEFAULT_MAX_AGE = 365;
const MEMORY_ROUTING_DEFAULT_ROLLOUT = 0;
const EPISODIC_SUMMARY_DEFAULT_DAYS = 30;
const EPISODIC_SUMMARY_DEFAULT_BATCH = 100;
const MEMORY_GRAPH_DEFAULT_MAX_NEIGHBORS = 20;
const MEMORY_GRAPH_DEFAULT_SIMILAR_THRESHOLD = 0.75;
const MEMORY_GRAPH_DEFAULT_RELATED_THRESHOLD = 0.5;
const MEMORY_GRAPH_DEFAULT_MIN_STRENGTH = 0.45;
const MEMORY_GRAPH_DEFAULT_BIDIRECTIONAL = true;

const HYBRID_DEFAULT_VECTOR_WEIGHT = 0.6;
const HYBRID_DEFAULT_KEYWORD_WEIGHT = 0.4;

function parseCsv(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

const fullTextWeights = parseFullTextWeights(process.env.FULLTEXT_SEARCH_WEIGHTS);
const fullTextMinScore = parseFullTextMinScore(process.env.FULLTEXT_MIN_SCORE);
const fullTextLanguage = parseFullTextLanguage(process.env.FULLTEXT_SEARCH_LANGUAGE);
const hybridRrfK = parseHybridRrfK(process.env.HYBRID_RRF_K);
const hybridWeights = parseHybridWeights(
  process.env.HYBRID_VECTOR_WEIGHT,
  process.env.HYBRID_KEYWORD_WEIGHT,
);
const temporalConfig = parseTemporalConfig({
  enabled: process.env.TEMPORAL_DECAY_ENABLED,
  strategy: process.env.TEMPORAL_DECAY_FUNCTION,
  halfLife: process.env.TEMPORAL_DECAY_HALFLIFE_DAYS,
  maxAge: process.env.TEMPORAL_DECAY_MAX_AGE_DAYS,
});
const memoryRoutingConfig = parseMemoryRoutingConfig({
  enabled: process.env.MEMORY_ROUTING_ENABLED,
  rolloutPct: process.env.MEMORY_ROUTING_ROLLOUT_PCT,
});
const episodicMemoryConfig = parseEpisodicMemoryConfig({
  enabled: process.env.EPISODIC_MEMORY_ENABLED,
  summaryThresholdDays: process.env.EPISODIC_SUMMARY_THRESHOLD_DAYS,
  summaryBatchLimit: process.env.EPISODIC_SUMMARY_BATCH_LIMIT,
});
const autoModeConfig = parseAutoModeConfig({
  enabled: process.env.AUTO_MODE_ENABLED,
  technicalPattern: process.env.TECHNICAL_PATTERN_REGEX,
  keywordWeight: process.env.AUTO_MODE_KEYWORD_WEIGHT,
  vectorWeight: process.env.AUTO_MODE_VECTOR_WEIGHT,
  hybridWeight: process.env.AUTO_MODE_HYBRID_WEIGHT,
});
const memoryGraphConfig = parseMemoryGraphConfig({
  maxNeighbors: process.env.MEMORY_GRAPH_MAX_NEIGHBORS,
  similarThreshold: process.env.MEMORY_GRAPH_SIMILAR_THRESHOLD,
  relatedThreshold: process.env.MEMORY_GRAPH_RELATED_THRESHOLD,
  minStrength: process.env.MEMORY_GRAPH_MIN_STRENGTH,
  bidirectional: process.env.MEMORY_GRAPH_BIDIRECTIONAL,
});

export const config = {
  ...data,
  isProduction: data.NODE_ENV === 'production',
  isTest: data.NODE_ENV === 'test',
  isDevelopment: data.NODE_ENV === 'development',
  http: {
    rateLimitMax: data.HTTP_RATE_LIMIT_MAX,
    rateLimitWindowMs: data.HTTP_RATE_LIMIT_WINDOW_MS,
    requestTimeoutMs: data.HTTP_REQUEST_TIMEOUT_MS,
    allowedOrigins: parseCsv(data.HTTP_ALLOWED_ORIGINS),
    allowedHosts: parseCsv(data.HTTP_ALLOWED_HOSTS),
  },
  operationsDatabaseUrl: (() => {
    const value = data.OPERATIONS_DATABASE_URL?.trim();
    return value && value.length > 0 ? value : null;
  })(),
  mcpApiKey: (() => {
    const value = data.MCP_API_KEY?.trim();
    return value && value.length > 0 ? value : null;
  })(),
  search: {
    fullText: {
      weights: fullTextWeights,
      minScore: fullTextMinScore,
      language: fullTextLanguage,
    },
    hybrid: {
      rrfK: hybridRrfK,
      vectorWeight: hybridWeights.vector,
      keywordWeight: hybridWeights.keyword,
    },
    memoryRouting: memoryRoutingConfig,
    autoMode: autoModeConfig,
    temporal: temporalConfig,
  },
  episodicMemory: episodicMemoryConfig,
  memoryGraph: memoryGraphConfig,
} as const;

export {
  featureFlagDefinitions,
  featureFlagNames,
  getFeatureFlagsSnapshot,
  isFeatureEnabled,
  resetAllFeatureFlags,
  resetFeatureFlag,
  setFeatureFlag,
} from './featureFlags';

export type { FeatureFlagName, FeatureFlagSnapshot } from './featureFlags';

function parseFullTextWeights(value?: string): Readonly<[number, number, number, number]> {
  if (!value || value.trim().length === 0) {
    return FULLTEXT_DEFAULT_WEIGHTS;
  }

  const segments = value
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length !== 4) {
    throw new Error(
      `FULLTEXT_SEARCH_WEIGHTS must contain exactly four comma-separated numbers. Received: "${value}".`,
    );
  }

  const weights = segments.map((segment) => {
    const parsed = Number.parseFloat(segment);
    if (!Number.isFinite(parsed)) {
      throw new Error(
        `FULLTEXT_SEARCH_WEIGHTS contains an invalid number "${segment}". Entire value: "${value}".`,
      );
    }
    return parsed;
  }) as [number, number, number, number];

  return Object.freeze(weights);
}

function parseFullTextMinScore(value?: string): number {
  if (!value || value.trim().length === 0) {
    return 0.1;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`FULLTEXT_MIN_SCORE must be a non-negative number. Received: "${value}".`);
  }

  return parsed;
}

function parseFullTextLanguage(value?: string): string {
  if (!value || value.trim().length === 0) {
    return 'english';
  }

  return value.trim().toLowerCase();
}

function parseHybridRrfK(value?: string): number {
  if (!value || value.trim().length === 0) {
    return 60;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`HYBRID_RRF_K must be a non-negative integer. Received: "${value}".`);
  }

  return parsed;
}

function parseHybridWeights(vectorRaw?: string, keywordRaw?: string) {
  const vector = parseHybridWeightValue(vectorRaw, HYBRID_DEFAULT_VECTOR_WEIGHT);
  const keyword = parseHybridWeightValue(keywordRaw, HYBRID_DEFAULT_KEYWORD_WEIGHT);

  const total = vector + keyword;
  if (total <= 0) {
    throw new Error('HYBRID_VECTOR_WEIGHT and HYBRID_KEYWORD_WEIGHT must sum to more than zero.');
  }

  return Object.freeze({
    vector: vector / total,
    keyword: keyword / total,
  }) as Readonly<{ vector: number; keyword: number }>;
}

function parseHybridWeightValue(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Hybrid search weight must be a non-negative number. Received: "${value}".`);
  }

  return parsed;
}

function parseAutoModeConfig(inputs: {
  enabled?: string;
  technicalPattern?: string;
  keywordWeight?: string;
  vectorWeight?: string;
  hybridWeight?: string;
}) {
  return Object.freeze({
    enabled: parseBooleanEnv(inputs.enabled, true),
    technicalPattern: parseTechnicalPattern(inputs.technicalPattern),
    keywordWeight: parseAutoModeWeight(inputs.keywordWeight, AUTO_MODE_DEFAULT_KEYWORD_WEIGHT),
    vectorWeight: parseAutoModeWeight(inputs.vectorWeight, AUTO_MODE_DEFAULT_VECTOR_WEIGHT),
    hybridWeight: parseAutoModeWeight(inputs.hybridWeight, AUTO_MODE_DEFAULT_HYBRID_WEIGHT),
  });
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim().length === 0) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value "${value}".`);
}

function parseAutoModeWeight(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`AUTO_MODE weight must be a positive number. Received: "${value}".`);
  }

  return parsed;
}

function parseTechnicalPattern(pattern?: string): RegExp {
  if (!pattern || pattern.trim().length === 0) {
    return new RegExp(AUTO_MODE_DEFAULT_PATTERN, 'i');
  }

  try {
    return new RegExp(pattern, 'i');
  } catch (error) {
    throw new Error(`Invalid TECHNICAL_PATTERN_REGEX value: "${pattern}".`);
  }
}

function parseTemporalConfig(inputs: {
  enabled?: string;
  strategy?: string;
  halfLife?: string;
  maxAge?: string;
}) {
  return Object.freeze({
    enabled: parseBooleanEnv(inputs.enabled, false),
    strategy: parseTemporalStrategy(inputs.strategy),
    halfLifeDays: parsePositiveNumber(inputs.halfLife, TEMPORAL_DEFAULT_HALFLIFE),
    maxAgeDays: parsePositiveNumber(inputs.maxAge, TEMPORAL_DEFAULT_MAX_AGE),
  });
}

function parseTemporalStrategy(strategy?: string): TemporalDecayStrategy {
  const value = (strategy ?? TEMPORAL_DEFAULT_STRATEGY).toLowerCase();

  if (value === 'exponential' || value === 'linear' || value === 'none') {
    return value;
  }

  throw new Error(
    `TEMPORAL_DECAY_FUNCTION must be one of exponential, linear, or none. Received: "${strategy}".`,
  );
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number. Received: "${value}".`);
  }

  return parsed;
}

function parseMemoryRoutingConfig(inputs: { enabled?: string; rolloutPct?: string }) {
  return Object.freeze({
    enabled: parseBooleanEnv(inputs.enabled, false),
    rolloutPct: parseRolloutPercentage(inputs.rolloutPct),
  });
}

function parseRolloutPercentage(value?: string): number {
  if (!value || value.trim().length === 0) {
    return MEMORY_ROUTING_DEFAULT_ROLLOUT;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error('MEMORY_ROUTING_ROLLOUT_PCT must be a number between 0 and 100.');
  }

  return parsed;
}

function parseEpisodicMemoryConfig(inputs: {
  enabled?: string;
  summaryThresholdDays?: string;
  summaryBatchLimit?: string;
}) {
  return Object.freeze({
    enabled: parseBooleanEnv(inputs.enabled, true),
    summaryThresholdDays: parsePositiveInteger(
      inputs.summaryThresholdDays,
      EPISODIC_SUMMARY_DEFAULT_DAYS,
    ),
    summaryBatchLimit: parsePositiveInteger(
      inputs.summaryBatchLimit,
      EPISODIC_SUMMARY_DEFAULT_BATCH,
    ),
  });
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer. Received: "${value}".`);
  }

  return parsed;
}

function parseMemoryGraphConfig(inputs: {
  maxNeighbors?: string;
  similarThreshold?: string;
  relatedThreshold?: string;
  minStrength?: string;
  bidirectional?: string;
}) {
  const maxNeighbors = parsePositiveIntegerWithDefault(
    inputs.maxNeighbors,
    MEMORY_GRAPH_DEFAULT_MAX_NEIGHBORS,
  );
  const similarThreshold = clamp01(
    parseOptionalFloat(inputs.similarThreshold, MEMORY_GRAPH_DEFAULT_SIMILAR_THRESHOLD),
  );
  const relatedThreshold = clamp01(
    parseOptionalFloat(inputs.relatedThreshold, MEMORY_GRAPH_DEFAULT_RELATED_THRESHOLD),
  );

  if (relatedThreshold > similarThreshold) {
    throw new Error(
      'MEMORY_GRAPH_RELATED_THRESHOLD must be less than or equal to MEMORY_GRAPH_SIMILAR_THRESHOLD.',
    );
  }

  const minStrength = Math.min(
    clamp01(parseOptionalFloat(inputs.minStrength, MEMORY_GRAPH_DEFAULT_MIN_STRENGTH)),
    relatedThreshold,
  );

  const bidirectional =
    inputs.bidirectional == null
      ? MEMORY_GRAPH_DEFAULT_BIDIRECTIONAL
      : parseBooleanEnv(inputs.bidirectional, MEMORY_GRAPH_DEFAULT_BIDIRECTIONAL);

  return Object.freeze({
    maxNeighbors,
    similarThreshold,
    relatedThreshold,
    minStrength,
    bidirectional,
  });
}

function parsePositiveIntegerWithDefault(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer. Received: "${value}".`);
  }

  return parsed;
}

function parseOptionalFloat(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a numeric value. Received: "${value}".`);
  }

  return parsed;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}
