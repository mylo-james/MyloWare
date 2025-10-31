import type { QueryClassification, QueryClassifierOptions } from './queryClassifier';
import { INTENT_FILTER_STRATEGIES, classifyQueryIntent } from './queryClassifier';
import { PromptEmbeddingsRepository, type PromptSummary } from '../db/repository';
import { normaliseSlugOptional } from '../utils/slug';
import { config } from '../config';

export interface EnhancedQueryOptions {
  repository?: PromptEmbeddingsRepository;
  classifierOptions?: QueryClassifierOptions;
  now?: () => Date;
}

export interface EnhancedQuery {
  intent: QueryClassification['intent'];
  confidence: number;
  persona?: string;
  project?: string;
  appliedPersona: boolean;
  appliedProject: boolean;
  notes: string[];
}

const KNOWN_METADATA_TTL_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 200;
const MAX_RETRIES = 1;
type SearchMode = 'vector' | 'keyword' | 'hybrid';

type KnownMetadataCache = {
  personas: Set<string>;
  projects: Set<string>;
  expiresAt: number;
};

let knownMetadataCache: KnownMetadataCache | null = null;

export async function enhanceQuery(
  query: string,
  options: EnhancedQueryOptions = {},
): Promise<EnhancedQuery> {
  const normalizedQuery = query.trim();

  if (normalizedQuery.length === 0) {
    return {
      intent: 'general_knowledge',
      confidence: 0,
      appliedPersona: false,
      appliedProject: false,
      notes: ['Query empty after trimming; skipped classification.'],
    };
  }

  const classification = await classifyWithRetry(normalizedQuery, options.classifierOptions);
  const strategy = INTENT_FILTER_STRATEGIES[classification.intent];
  const notes: string[] = [];

  const repository = options.repository ?? new PromptEmbeddingsRepository();
  const metadata = await getKnownMetadata(repository, options.now ?? (() => new Date()));

  const appliedPersona = applyPersonaFilter(classification, strategy, metadata, notes);
  const appliedProject = applyProjectFilter(classification, strategy, metadata, notes);

  return {
    intent: classification.intent,
    confidence: classification.confidence,
    persona: appliedPersona.value,
    project: appliedProject.value,
    appliedPersona: appliedPersona.applied,
    appliedProject: appliedProject.applied,
    notes,
  };
}

export function clearKnownMetadataCache(): void {
  knownMetadataCache = null;
}

async function classifyWithRetry(
  query: string,
  options?: QueryClassifierOptions,
): Promise<QueryClassification> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= MAX_RETRIES) {
    try {
      return await classifyQueryIntent(query, options);
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt > MAX_RETRIES) {
        break;
      }

      await delay(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Query classification failed.');
}

async function getKnownMetadata(
  repository: PromptEmbeddingsRepository,
  now: () => Date,
): Promise<{ personas: Set<string>; projects: Set<string> }> {
  if (knownMetadataCache && knownMetadataCache.expiresAt > now().getTime()) {
    return {
      personas: knownMetadataCache.personas,
      projects: knownMetadataCache.projects,
    };
  }

  const summaries = await repository.listPrompts();
  const personas = new Set<string>();
  const projects = new Set<string>();

  for (const summary of summaries) {
    collectMetadata(summary, 'persona', personas);
    collectMetadata(summary, 'project', projects);
  }

  knownMetadataCache = {
    personas,
    projects,
    expiresAt: now().getTime() + KNOWN_METADATA_TTL_MS,
  };

  return { personas, projects };
}

function collectMetadata(summary: PromptSummary, key: 'persona' | 'project', target: Set<string>) {
  const metadata = summary.metadata as Record<string, unknown>;
  const values = metadata[key];

  if (!Array.isArray(values)) {
    return;
  }

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const normalized = normaliseSlugOptional(value);
    if (normalized) {
      target.add(normalized);
    }
  }
}

function applyPersonaFilter(
  classification: QueryClassification,
  strategy: { requiresPersona: boolean },
  metadata: { personas: Set<string> },
  notes: string[],
) {
  const personaSlug = normaliseSlugOptional(classification.extractedPersona ?? undefined);

  if (!personaSlug) {
    if (strategy.requiresPersona) {
      notes.push('Classifier did not return a persona slug.');
    }
    return { applied: false, value: undefined };
  }

  if (!metadata.personas.has(personaSlug)) {
    notes.push(`Persona "${personaSlug}" not found in known metadata.`);
    return { applied: false, value: undefined };
  }

  notes.push(`Applied persona filter "${personaSlug}" from query classifier.`);
  return { applied: true, value: personaSlug };
}

function applyProjectFilter(
  classification: QueryClassification,
  strategy: { requiresProject: boolean },
  metadata: { projects: Set<string> },
  notes: string[],
) {
  const projectSlug = normaliseSlugOptional(classification.extractedProject ?? undefined);

  if (!projectSlug) {
    if (strategy.requiresProject) {
      notes.push('Classifier did not return a project slug.');
    }
    return { applied: false, value: undefined };
  }

  if (!metadata.projects.has(projectSlug)) {
    notes.push(`Project "${projectSlug}" not found in known metadata.`);
    return { applied: false, value: undefined };
  }

  notes.push(`Applied project filter "${projectSlug}" from query classifier.`);
  return { applied: true, value: projectSlug };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function selectSearchMode(query: string, intent: QueryClassification['intent']): SearchMode {
  const autoMode = config.search.autoMode;
  if (!autoMode.enabled) {
    return 'hybrid';
  }

  const normalized = query.trim();
  let keywordScore = autoMode.keywordWeight;
  let vectorScore = autoMode.vectorWeight;
  let hybridScore = autoMode.hybridWeight;

  if (autoMode.technicalPattern.test(normalized)) {
    keywordScore += autoMode.keywordWeight;
  }

  if (/"[^"]+"|'[^']+'/.test(normalized) || /::/.test(normalized)) {
    keywordScore += autoMode.keywordWeight * 0.5;
  }

  if (/(what|how|why|when|where|explain|describe|give me|show me)/i.test(normalized)) {
    vectorScore += autoMode.vectorWeight;
  }

  const wordCount = normalized.split(/\s+/).filter((word) => word.length > 0).length;
  if (wordCount >= 8) {
    vectorScore += autoMode.vectorWeight * 0.5;
  }

  if (
    intent === 'persona_lookup' ||
    intent === 'project_lookup' ||
    intent === 'combination_lookup'
  ) {
    hybridScore += autoMode.hybridWeight * 0.7;
  }

  if (intent === 'example_request' || intent === 'workflow_step') {
    vectorScore += autoMode.vectorWeight * 0.3;
    hybridScore += autoMode.hybridWeight * 0.3;
  }

  const scores: Array<{ mode: SearchMode; score: number }> = [
    { mode: 'vector', score: vectorScore },
    { mode: 'keyword', score: keywordScore },
    { mode: 'hybrid', score: hybridScore },
  ];

  scores.sort((a, b) => b.score - a.score);

  if (scores[0].score === scores[1].score) {
    return 'hybrid';
  }

  return scores[0].mode;
}
