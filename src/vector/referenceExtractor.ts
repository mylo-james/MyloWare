import type { PromptEmbeddingsRepository, SearchResult } from '../db/repository';

export type ReferenceType = 'persona' | 'project' | 'workflow' | 'link' | 'unknown';

export interface Reference {
  type: ReferenceType;
  raw: string;
  normalized: string;
  sourceChunkId: string;
  sourcePromptKey: string;
  confidence: number;
}

export interface ResolvedReference {
  reference: Reference;
  results: SearchResult[];
}

const PERSONA_KEYWORDS = ['persona', 'role', 'voice'];
const PROJECT_KEYWORDS = ['project', 'initiative', 'program'];
const WORKFLOW_KEYWORDS = ['workflow', 'step', 'checklist', 'process', 'stage'];

const PERSONA_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+persona\b/g;
const PROJECT_PATTERN = /\bproject\s+([A-Za-z0-9_-]{3,})\b/gi;
const WORKFLOW_PATTERN = /\bworkflow\s+step\s+(\d+)\b/gi;
const LINK_PATTERN = /\bhttps?:\/\/[\w./#?=&-]+/gi;

export function extractReferences(result: SearchResult): Reference[] {
  const references: Reference[] = [];
  const metadata = (result.metadata ?? {}) as Record<string, unknown>;
  const description = typeof metadata.description === 'string' ? metadata.description : '';
  const text = [result.chunkText ?? '', description].join('\n');

  references.push(
    ...extractWithPattern(text, PERSONA_PATTERN, 'persona', result, normalizePersona),
    ...extractWithPattern(text, PROJECT_PATTERN, 'project', result, normalizeProject),
    ...extractWithPattern(text, WORKFLOW_PATTERN, 'workflow', result, normalizeWorkflow),
    ...extractWithPattern(text, LINK_PATTERN, 'link', result, normalizeLink, 0.9),
  );

  const metadataReferences = extractFromMetadata(result);
  references.push(...metadataReferences);

  return dedupeReferences(references);
}

type ReferenceRepository = Pick<PromptEmbeddingsRepository, 'search' | 'keywordSearch'>;

export async function resolveReference(
  reference: Reference,
  repository: ReferenceRepository,
  embed: (inputs: string[]) => Promise<number[][]>,
): Promise<ResolvedReference> {
  switch (reference.type) {
    case 'persona': {
      const [embedding] = await embed([reference.normalized]);
      const results = await repository.search({
        embedding,
        limit: 10,
        minSimilarity: 0.2,
        memoryTypes: ['persona'],
        persona: reference.normalized,
      });
      return { reference, results };
    }
    case 'project': {
      const [embedding] = await embed([reference.normalized]);
      const results = await repository.search({
        embedding,
        limit: 10,
        minSimilarity: 0.2,
        memoryTypes: ['project', 'semantic'],
        project: reference.normalized,
      });
      return { reference, results };
    }
    case 'workflow': {
      const query = `workflow step ${reference.normalized}`;
      const results = await repository.keywordSearch(query, {}, { limit: 10 });
      return { reference, results };
    }
    case 'link': {
      const results = await repository.keywordSearch(reference.normalized, {}, { limit: 5 });
      return { reference, results };
    }
    default:
      return { reference, results: [] };
  }
}

function extractWithPattern(
  text: string,
  pattern: RegExp,
  type: ReferenceType,
  result: SearchResult,
  normalizer: (match: string) => string,
  baseConfidence = 0.6,
): Reference[] {
  const references: Reference[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(pattern);
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const normalized = normalizer(match[1] ?? raw);
    if (!normalized) {
      continue;
    }
    references.push({
      type,
      raw,
      normalized,
      sourceChunkId: result.chunkId,
      sourcePromptKey: result.promptKey,
      confidence: computeConfidence(type, raw, normalized, baseConfidence),
    });
  }
  return references;
}

function extractFromMetadata(result: SearchResult): Reference[] {
  const references: Reference[] = [];
  const metadata = result.metadata as Record<string, unknown>;
  if (!metadata) {
    return references;
  }

  if (Array.isArray(metadata.persona)) {
    for (const entry of metadata.persona) {
      if (typeof entry === 'string') {
        references.push(buildReference('persona', entry, result));
      }
    }
  }

  if (Array.isArray(metadata.project)) {
    for (const entry of metadata.project) {
      if (typeof entry === 'string') {
        references.push(buildReference('project', entry, result));
      }
    }
  }

  if (Array.isArray(metadata.tags)) {
    for (const tag of metadata.tags) {
      if (typeof tag !== 'string') {
        continue;
      }
      const lowered = tag.toLowerCase();
      if (WORKFLOW_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
        references.push(buildReference('workflow', tag, result));
      }
    }
  }

  return references;
}

function buildReference(type: ReferenceType, value: string, result: SearchResult): Reference {
  return {
    type,
    raw: value,
    normalized: type === 'link' ? normalizeLink(value) : value.trim().toLowerCase(),
    sourceChunkId: result.chunkId,
    sourcePromptKey: result.promptKey,
    confidence: 0.75,
  };
}

function dedupeReferences(references: Reference[]): Reference[] {
  const map = new Map<string, Reference>();
  for (const reference of references) {
    const key = `${reference.type}:${reference.normalized}`;
    if (!map.has(key) || map.get(key)!.confidence < reference.confidence) {
      map.set(key, reference);
    }
  }
  return Array.from(map.values());
}

function normalizePersona(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

function normalizeProject(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '');
}

function normalizeWorkflow(raw: string): string {
  return raw.trim();
}

function normalizeLink(raw: string): string {
  return raw.trim();
}

function computeConfidence(
  type: ReferenceType,
  raw: string,
  normalized: string,
  baseConfidence: number,
): number {
  let confidence = baseConfidence;
  const rawLower = raw.toLowerCase();

  if (type === 'persona' && PERSONA_KEYWORDS.some((keyword) => rawLower.includes(keyword))) {
    confidence += 0.1;
  }

  if (type === 'project' && PROJECT_KEYWORDS.some((keyword) => rawLower.includes(keyword))) {
    confidence += 0.1;
  }

  if (type === 'workflow' && WORKFLOW_KEYWORDS.some((keyword) => rawLower.includes(keyword))) {
    confidence += 0.1;
  }

  if (type === 'persona' && normalized.includes('-')) {
    confidence += 0.05;
  }

  if (type === 'link') {
    confidence = Math.max(confidence, 0.9);
  }

  return Math.min(confidence, 1);
}
