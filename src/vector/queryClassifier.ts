import crypto from 'node:crypto';
import OpenAI from 'openai';
import { config } from '../config';
import { normaliseSlugOptional } from '../utils/slug';

export type QueryIntent =
  | 'persona_lookup'
  | 'project_lookup'
  | 'combination_lookup'
  | 'general_knowledge'
  | 'workflow_step'
  | 'example_request';

export interface QueryClassification {
  intent: QueryIntent;
  extractedPersona?: string;
  extractedProject?: string;
  confidence: number;
}

export interface QueryClassifierOptions {
  client?: OpenAI;
}

export interface ClassifierMetrics {
  hits: number;
  misses: number;
}

type CacheEntry = {
  value: QueryClassification;
  expiresAt: number;
};

type IntentFilterStrategy = {
  requiresPersona: boolean;
  requiresProject: boolean;
  description: string;
};

export const INTENT_FILTER_STRATEGIES: Record<QueryIntent, IntentFilterStrategy> = {
  persona_lookup: {
    requiresPersona: true,
    requiresProject: false,
    description: 'Prefer persona metadata; fall back to general prompts when persona missing.',
  },
  project_lookup: {
    requiresPersona: false,
    requiresProject: true,
    description: 'Filter by project metadata to highlight project-specific prompts.',
  },
  combination_lookup: {
    requiresPersona: true,
    requiresProject: true,
    description: 'Require both persona and project filters for combined prompts.',
  },
  general_knowledge: {
    requiresPersona: false,
    requiresProject: false,
    description: 'Use broad semantic search without additional filters.',
  },
  workflow_step: {
    requiresPersona: false,
    requiresProject: false,
    description: 'Bias towards prompts tagged as workflow steps in metadata.',
  },
  example_request: {
    requiresPersona: false,
    requiresProject: false,
    description: 'Prioritise prompts marked as examples or demonstrations.',
  },
};

const MODEL_NAME = 'gpt-4o-mini';
export const QUERY_CLASSIFIER_MAX_INPUT_LENGTH = 1200;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

const defaultClient = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

const cache = new Map<string, CacheEntry>();
const metrics: ClassifierMetrics = { hits: 0, misses: 0 };

const CLASSIFIER_SYSTEM_PROMPT = [
  'You are an assistant that classifies user queries about prompt libraries.',
  'Return a JSON object with fields: intent, extractedPersona, extractedProject, confidence (0-1).',
  'Only use the allowed intents: persona_lookup, project_lookup, combination_lookup, general_knowledge, workflow_step, example_request.',
  'When extracting persona or project names, return the canonical slug (lowercase, hyphen separated).',
  'If unsure, respond with general_knowledge and confidence 0.3 or lower.',
].join(' ');

const FEW_SHOT_EXAMPLES: Array<{ query: string; response: QueryClassification }> = [
  {
    query: 'What does the Screenwriter persona do?',
    response: { intent: 'persona_lookup', extractedPersona: 'screenwriter', confidence: 0.92 },
  },
  {
    query: 'Give me AISMR-specific talking points.',
    response: { intent: 'project_lookup', extractedProject: 'aismr', confidence: 0.88 },
  },
  {
    query: 'How should the screenwriter persona collaborate with AISMR?',
    response: {
      intent: 'combination_lookup',
      extractedPersona: 'screenwriter',
      extractedProject: 'aismr',
      confidence: 0.9,
    },
  },
  {
    query: 'Show me an example prompt for onboarding workshops.',
    response: { intent: 'example_request', confidence: 0.75 },
  },
];

const FALLBACK_CLASSIFICATION: QueryClassification = {
  intent: 'general_knowledge',
  confidence: 0.1,
};

export async function classifyQueryIntent(
  query: string,
  options: QueryClassifierOptions = {},
): Promise<QueryClassification> {
  const normalizedQuery = query.trim();

  if (normalizedQuery.length === 0) {
    return FALLBACK_CLASSIFICATION;
  }

  const truncatedQuery =
    normalizedQuery.length > QUERY_CLASSIFIER_MAX_INPUT_LENGTH
      ? normalizedQuery.slice(0, QUERY_CLASSIFIER_MAX_INPUT_LENGTH)
      : normalizedQuery;

  const cacheKey = hashQuery(truncatedQuery);
  const cached = getFromCache(cacheKey);
  if (cached) {
    metrics.hits += 1;
    return cached;
  }

  metrics.misses += 1;

  const client = options.client ?? defaultClient;
  const completion = await client.chat.completions.create({
    model: MODEL_NAME,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: buildPromptMessages(truncatedQuery),
  });

  const parsed = parseClassification(completion);
  setCache(cacheKey, parsed);
  return parsed;
}

export function getQueryClassifierMetrics(): ClassifierMetrics {
  return { ...metrics };
}

export function clearQueryClassifierCache(): void {
  cache.clear();
  metrics.hits = 0;
  metrics.misses = 0;
}

function buildPromptMessages(query: string) {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
  ];

  for (const example of FEW_SHOT_EXAMPLES) {
    messages.push({
      role: 'user',
      content: `Classify the following query:\n"""${example.query}"""`,
    });
    messages.push({
      role: 'assistant',
      content: JSON.stringify(example.response),
    });
  }

  messages.push({
    role: 'user',
    content: `Classify the following query:\n"""${query}"""`,
  });

  return messages;
}

function parseClassification(
  response: OpenAI.Chat.Completions.ChatCompletion,
): QueryClassification {
  const content = response.choices[0]?.message?.content;
  if (!content) {
    return FALLBACK_CLASSIFICATION;
  }

  try {
    const payload = JSON.parse(content) as {
      intent?: string;
      extractedPersona?: string | null;
      extractedProject?: string | null;
      confidence?: number;
    };

    const intent = isValidIntent(payload.intent) ? payload.intent : FALLBACK_CLASSIFICATION.intent;
    const confidence =
      typeof payload.confidence === 'number' && !Number.isNaN(payload.confidence)
        ? clamp(payload.confidence, 0, 1)
        : FALLBACK_CLASSIFICATION.confidence;

    const extractedPersona =
      normaliseSlugOptional(payload.extractedPersona ?? undefined) ?? undefined;
    const extractedProject =
      normaliseSlugOptional(payload.extractedProject ?? undefined) ?? undefined;

    return {
      intent,
      extractedPersona,
      extractedProject,
      confidence,
    };
  } catch (error) {
    console.warn('Failed to parse query intent classification response', error);
    return FALLBACK_CLASSIFICATION;
  }
}

function getFromCache(cacheKey: string): QueryClassification | null {
  const cached = cache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt < Date.now()) {
    cache.delete(cacheKey);
    return null;
  }

  cache.delete(cacheKey);
  cache.set(cacheKey, cached);
  return cached.value;
}

function setCache(cacheKey: string, value: QueryClassification): void {
  cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });

  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
}

function hashQuery(query: string): string {
  return crypto.createHash('sha256').update(query).digest('hex');
}

function isValidIntent(intent: unknown): intent is QueryIntent {
  return (
    intent === 'persona_lookup' ||
    intent === 'project_lookup' ||
    intent === 'combination_lookup' ||
    intent === 'general_knowledge' ||
    intent === 'workflow_step' ||
    intent === 'example_request'
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
