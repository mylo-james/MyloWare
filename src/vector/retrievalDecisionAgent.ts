import OpenAI from 'openai';
import { config } from '../config';
import type { QueryIntent } from './queryClassifier';
import type { SearchResult } from '../db/repository';

export interface AgentContext {
  query: string;
  intent?: QueryIntent;
  summary?: string;
  knownFacts?: string[];
  missingInformation?: string[];
  safetyCritical?: boolean;
  lastRetrievedAt?: Date | string | null;
  ambiguitySignals?: string[];
}

export type RetrievalDecisionOutcome = 'yes' | 'no' | 'maybe';

export interface RetrievalDecision {
  decision: RetrievalDecisionOutcome;
  confidence: number;
  rationale: string;
  safetyOverride: boolean;
  metrics: {
    knowledgeSufficiency: number;
    freshnessRisk: number;
    ambiguity: number;
  };
}

export interface ShouldRetrieveOptions {
  client?: OpenAI;
  model?: string;
  maxSummaryLength?: number;
}

export interface QueryFormulationContext {
  summary?: string;
  intent?: QueryIntent;
  missingInformation?: string[];
  keywords?: string[];
  temporalFocus?: 'recent' | 'historical' | 'any';
}

export interface QueryFormulationOptions {
  client?: OpenAI;
  model?: string;
  useLLM?: boolean;
  maxContextLength?: number;
}

export interface UtilityOptions {
  expectedResults?: number;
  similarityWeight?: number;
  coverageWeight?: number;
  diversityWeight?: number;
  requireMinimumSimilarity?: number;
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const FALLBACK_DECISION: RetrievalDecision = {
  decision: 'maybe',
  confidence: 0.4,
  rationale: 'Unable to determine need for retrieval; defaulting to cautious maybe.',
  safetyOverride: false,
  metrics: {
    knowledgeSufficiency: 0.5,
    freshnessRisk: 0.5,
    ambiguity: 0.5,
  },
};

const defaultClient = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

const DECISION_SYSTEM_PROMPT = [
  'You evaluate whether an AI assistant should perform retrieval before answering.',
  'Respond with valid JSON containing the fields:',
  'decision ("yes", "no", or "maybe"), rationale (string), confidence (0-1),',
  'knowledgeSufficiency (0-1), freshnessRisk (0-1), ambiguity (0-1).',
  'A higher knowledgeSufficiency means existing context is enough.',
  'A higher freshnessRisk means information might be outdated and requires new retrieval.',
  'A higher ambiguity means the query is unclear and could benefit from additional evidence.',
  'Confidence reflects your certainty in the decision.',
].join(' ');

const FORMULATION_SYSTEM_PROMPT = [
  'You help craft retrieval queries for a hybrid vector + metadata search engine.',
  'Return ONLY the final query string that should be executed.',
  'Keep it under 240 characters and prefer descriptive phrasing with key noun phrases.',
].join(' ');

export async function shouldRetrieve(
  context: AgentContext,
  options: ShouldRetrieveOptions = {},
): Promise<RetrievalDecision> {
  const trimmedQuery = context.query?.trim() ?? '';
  if (!trimmedQuery) {
    return FALLBACK_DECISION;
  }

  const client = options.client ?? defaultClient;
  const model = options.model ?? DEFAULT_MODEL;
  const maxSummaryLength = options.maxSummaryLength ?? 1200;

  const payload = buildDecisionPayload(context, maxSummaryLength);

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: DECISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: payload,
        },
      ],
    });

    const parsed = parseDecision(completion.choices[0]?.message?.content);
    const decision = applyOverrides(parsed, context.safetyCritical === true);
    return decision;
  } catch (error) {
    return buildHeuristicDecision(context);
  }
}

export async function formulateRetrievalQuery(
  query: string,
  context: QueryFormulationContext = {},
  options: QueryFormulationOptions = {},
): Promise<string> {
  const normalizedQuery = query.trim();
  const summarySegment = (context.summary ?? '').trim();
  const missingSegment = (context.missingInformation ?? []).join('; ');
  const keywordsSegment = (context.keywords ?? []).join(', ');
  const temporalSegment = context.temporalFocus ?? 'any';

  if (normalizedQuery.length === 0) {
    throw new Error('Query must not be empty when formulating retrieval queries.');
  }

  const shouldUseLLM = options.useLLM ?? true;
  if (!shouldUseLLM) {
    return fallbackQueryFormulation({
      normalizedQuery,
      summarySegment,
      missingSegment,
      keywordsSegment,
      temporalSegment,
      intent: context.intent,
    });
  }

  const client = options.client ?? defaultClient;
  const model = options.model ?? DEFAULT_MODEL;
  const maxContextLength = options.maxContextLength ?? 1600;
  const contextPayload = buildFormulationPayload(
    {
      normalizedQuery,
      summarySegment,
      missingSegment,
      keywordsSegment,
      temporalSegment,
      intent: context.intent,
    },
    maxContextLength,
  );

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.3,
      max_tokens: 150,
      messages: [
        { role: 'system', content: FORMULATION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: contextPayload,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      return fallbackQueryFormulation({
        normalizedQuery,
        summarySegment,
        missingSegment,
        keywordsSegment,
        temporalSegment,
        intent: context.intent,
      });
    }

    return content.replace(/\s+/g, ' ').slice(0, 260).trim();
  } catch (error) {
    return fallbackQueryFormulation({
      normalizedQuery,
      summarySegment,
      missingSegment,
      keywordsSegment,
      temporalSegment,
      intent: context.intent,
    });
  }
}

export function evaluateResultUtility(
  results: SearchResult[],
  query: string,
  options: UtilityOptions = {},
): number {
  if (!Array.isArray(results) || results.length === 0) {
    return 0;
  }

  const expectedResults = options.expectedResults ?? 6;
  const similarityWeight = options.similarityWeight ?? 0.5;
  const coverageWeight = options.coverageWeight ?? 0.3;
  const diversityWeight = options.diversityWeight ?? 0.2;
  const minSimilarity = options.requireMinimumSimilarity ?? 0.15;

  const similarities = results.map((result) => clamp(result.similarity ?? 0, 0, 1));
  const averageSimilarity = similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
  const similarityScore = averageSimilarity < minSimilarity ? averageSimilarity * 0.5 : averageSimilarity;

  const coverageScore = clamp(results.length / expectedResults, 0, 1);
  const uniquePromptKeys = new Set(results.map((result) => result.promptKey)).size;
  const diversityScore = clamp(uniquePromptKeys / results.length, 0, 1);

  const rawScore =
    similarityWeight * similarityScore + coverageWeight * coverageScore + diversityWeight * diversityScore;

  const lengthPenalty = query.length > 160 ? 0.05 : 0;
  return clamp(rawScore - lengthPenalty, 0, 1);
}

function buildDecisionPayload(context: AgentContext, maxSummaryLength: number): string {
  const summary = (context.summary ?? '').slice(0, maxSummaryLength).trim();
  const knownFacts = (context.knownFacts ?? []).slice(0, 8);
  const missing = (context.missingInformation ?? []).slice(0, 8);
  const ambiguity = (context.ambiguitySignals ?? []).slice(0, 6);

  const components = [
    `Query: ${context.query.trim()}`,
    context.intent ? `Intent: ${context.intent}` : null,
    summary ? `Context Summary: ${summary}` : null,
    knownFacts.length > 0 ? `Known Facts: ${knownFacts.join(' | ')}` : null,
    missing.length > 0 ? `Missing Information: ${missing.join(' | ')}` : null,
    context.lastRetrievedAt ? `Last Retrieval: ${context.lastRetrievedAt}` : null,
    ambiguity.length > 0 ? `Ambiguity Signals: ${ambiguity.join(' | ')}` : null,
  ];

  return components.filter(Boolean).join('\n');
}

function parseDecision(content?: string | null): RetrievalDecision {
  if (!content) {
    return FALLBACK_DECISION;
  }

  try {
    const parsed = JSON.parse(content) as Partial<RetrievalDecision>;
    const decision = (parsed.decision ?? 'maybe') as RetrievalDecisionOutcome;
    const confidence = clamp(Number(parsed.confidence ?? 0.4), 0, 1);
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : FALLBACK_DECISION.rationale;
    const metrics = (parsed.metrics ?? {}) as Partial<RetrievalDecision['metrics']>;
    const knowledge = clamp(
      Number(metrics.knowledgeSufficiency ?? (parsed as Partial<Record<string, unknown>>).knowledgeSufficiency ?? 0.5),
      0,
      1,
    );
    const freshness = clamp(
      Number(metrics.freshnessRisk ?? (parsed as Partial<Record<string, unknown>>).freshnessRisk ?? 0.5),
      0,
      1,
    );
    const ambiguity = clamp(
      Number(metrics.ambiguity ?? (parsed as Partial<Record<string, unknown>>).ambiguity ?? 0.5),
      0,
      1,
    );

    return {
      decision,
      confidence,
      rationale,
      safetyOverride: false,
      metrics: {
        knowledgeSufficiency: knowledge,
        freshnessRisk: freshness,
        ambiguity,
      },
    };
  } catch (error) {
    return FALLBACK_DECISION;
  }
}

function applyOverrides(decision: RetrievalDecision, safetyCritical: boolean): RetrievalDecision {
  if (!safetyCritical) {
    return decision;
  }

  if (decision.decision === 'yes' && decision.confidence >= 0.6) {
    return { ...decision, safetyOverride: true };
  }

  return {
    decision: 'yes',
    confidence: Math.max(decision.confidence, 0.8),
    rationale: `${decision.rationale} (safety override engaged)`,
    safetyOverride: true,
    metrics: {
      ...decision.metrics,
      knowledgeSufficiency: Math.min(decision.metrics.knowledgeSufficiency, 0.4),
    },
  };
}

function buildHeuristicDecision(context: AgentContext): RetrievalDecision {
  const lowered = context.query.toLowerCase();
  const keywords = ['latest', 'update', 'today', 'recent', 'current', 'new'];
  const requiresFresh = keywords.some((token) => lowered.includes(token));
  const missingInfo = (context.missingInformation ?? []).length > 0;
  const ambiguitySignals = (context.ambiguitySignals ?? []).length > 0;

  if (context.safetyCritical) {
    return {
      decision: 'yes',
      confidence: 0.82,
      rationale: 'Safety-critical context requires retrieval despite heuristic fallback.',
      safetyOverride: true,
      metrics: {
        knowledgeSufficiency: 0.4,
        freshnessRisk: requiresFresh ? 0.9 : 0.6,
        ambiguity: ambiguitySignals ? 0.7 : 0.5,
      },
    };
  }

  if (requiresFresh || missingInfo) {
    return {
      decision: 'yes',
      confidence: 0.68,
      rationale: 'Heuristic indicates recent information or missing details; retrieval recommended.',
      safetyOverride: false,
      metrics: {
        knowledgeSufficiency: missingInfo ? 0.45 : 0.55,
        freshnessRisk: requiresFresh ? 0.85 : 0.6,
        ambiguity: ambiguitySignals ? 0.65 : 0.4,
      },
    };
  }

  return {
    decision: 'maybe',
    confidence: 0.4,
    rationale: 'Heuristic fallback unable to confirm need for retrieval.',
    safetyOverride: false,
    metrics: {
      knowledgeSufficiency: 0.55,
      freshnessRisk: 0.45,
      ambiguity: ambiguitySignals ? 0.6 : 0.4,
    },
  };
}

function fallbackQueryFormulation(input: {
  normalizedQuery: string;
  summarySegment: string;
  missingSegment: string;
  keywordsSegment: string;
  temporalSegment: string;
  intent?: QueryIntent;
}): string {
  const segments = [
    input.normalizedQuery,
    input.keywordsSegment ? `keywords: ${input.keywordsSegment}` : null,
    input.summarySegment ? `context: ${truncate(input.summarySegment, 180)}` : null,
    input.missingSegment ? `need: ${input.missingSegment}` : null,
    input.intent ? `intent:${input.intent}` : null,
    input.temporalSegment !== 'any' ? `time:${input.temporalSegment}` : null,
  ];

  return segments
    .filter(Boolean)
    .join(' | ')
    .slice(0, 260)
    .trim();
}

function buildFormulationPayload(
  input: {
    normalizedQuery: string;
    summarySegment: string;
    missingSegment: string;
    keywordsSegment: string;
    temporalSegment: string;
    intent?: QueryIntent;
  },
  maxLength: number,
): string {
  const pieces = [
    `Original query: ${input.normalizedQuery}`,
    input.summarySegment ? `Relevant context: ${truncate(input.summarySegment, 400)}` : null,
    input.missingSegment ? `Information gaps: ${truncate(input.missingSegment, 200)}` : null,
    input.keywordsSegment ? `Important keywords: ${truncate(input.keywordsSegment, 160)}` : null,
    `Temporal focus: ${input.temporalSegment}`,
    input.intent ? `Intent classification: ${input.intent}` : null,
  ];

  return truncate(pieces.filter(Boolean).join('\n'), maxLength);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
