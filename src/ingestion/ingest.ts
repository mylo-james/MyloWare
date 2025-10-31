import { createHash } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { McpEmbeddings } from '../types';
import { PromptEmbeddingsRepository, type EmbeddingRecord } from '../db/repository';
import type { MemoryType } from '../db/schema';
import { embedTexts } from '../vector/embedTexts';
import { MemoryLinkGenerator } from '../vector/linkDetector';
import { normaliseSlug } from '../utils/slug';

export type PromptType = 'persona' | 'project' | 'combination';

export interface IngestOptions {
  directory?: string;
  dryRun?: boolean;
  removeMissing?: boolean;
  repository?: PromptEmbeddingsRepository;
  embed?: McpEmbeddings['embedTexts'];
  linkGenerator?: Pick<MemoryLinkGenerator, 'generateForChunks'>;
}

export interface IngestResult {
  processed: Array<{ promptKey: string; chunks: number }>;
  removed: string[];
  skipped: string[];
}

interface PromptDocument {
  title?: string;
  activation_notice?: string | null;
  critical_notice?: string | null;
  closing_message?: string | null;
  agent?: {
    name?: string | null;
    id?: string | null;
    title?: string | null;
    icon?: string | null;
    whentouse?: string | null;
    customization?: string | null;
  };
  persona?: Record<string, unknown> | null;
  operating_notes?: Record<string, unknown> | null;
  workflow?: Record<string, unknown> | null;
  orientation?: Record<string, unknown> | null;
  additional_sections?: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface ParsedPrompt {
  promptKey: string;
  type: PromptType;
  personaSlug: string | null;
  projectSlug: string | null;
  metadata: Record<string, unknown>;
  content: string;
  chunkTexts: ChunkText[];
  checksum: string;
  memoryType: MemoryType;
}

interface ChunkText {
  granularity: 'document' | 'section';
  text: string;
  index: number;
}

const DEFAULT_PROMPTS_DIR = path.resolve(process.cwd(), 'prompts');

export async function ingestPrompts(options: IngestOptions = {}): Promise<IngestResult> {
  const directory = options.directory ? path.resolve(options.directory) : DEFAULT_PROMPTS_DIR;
  const dryRun = Boolean(options.dryRun);
  const removeMissing = options.removeMissing !== false;
  const repository = options.repository ?? new PromptEmbeddingsRepository();
  const embed = options.embed ?? embedTexts;
  const linkGenerator =
    options.linkGenerator ??
    (dryRun ? null : new MemoryLinkGenerator({ promptRepository: repository }));

  const files = await loadPromptFiles(directory);

  if (files.length === 0) {
    return {
      processed: [],
      removed: [],
      skipped: [],
    };
  }

  const parsed = await Promise.all(
    files.map(async (file) => {
      const document = await readPromptDocument(file.absolutePath);
      return parsePromptDocument(document, file.relativePath);
    }),
  );

  const desiredKeys = new Set(parsed.map((prompt) => prompt.promptKey));
  const removed: string[] = [];

  if (!dryRun && removeMissing) {
    const existing = await repository.listPrompts();
    for (const summary of existing) {
      if (!desiredKeys.has(summary.promptKey)) {
        await repository.deleteByPromptKey(summary.promptKey);
        removed.push(summary.promptKey);
      }
    }
  }

  const processed: Array<{ promptKey: string; chunks: number }> = [];
  const linkTasks: Promise<void>[] = [];

  for (const prompt of parsed) {
    if (dryRun) {
      processed.push({ promptKey: prompt.promptKey, chunks: prompt.chunkTexts.length });
      continue;
    }

    const records = await buildEmbeddingRecords(prompt, embed);
    await repository.deleteByPromptKey(prompt.promptKey);
    await repository.upsertEmbeddings(records);

    if (linkGenerator && records.length > 0) {
      const chunkIds = records.map((record) => record.chunkId);
      linkTasks.push(
        linkGenerator
          .generateForChunks(chunkIds)
          .then(() => undefined)
          .catch((error) => {
            console.error(
              `Failed to generate memory links for prompt "${prompt.promptKey}":`,
              error,
            );
          }),
      );
    }

    processed.push({ promptKey: prompt.promptKey, chunks: records.length });
  }

  if (!dryRun && linkTasks.length > 0) {
    await Promise.all(linkTasks);
  }

  return {
    processed,
    removed,
    skipped: [],
  };
}

interface PromptFile {
  absolutePath: string;
  relativePath: string;
}

async function loadPromptFiles(directory: string): Promise<PromptFile[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: PromptFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    files.push({
      absolutePath: path.join(directory, entry.name),
      relativePath: entry.name,
    });
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

async function readPromptDocument(filePath: string): Promise<PromptDocument> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as PromptDocument;
}

export function parsePromptDocument(document: PromptDocument, sourceName: string): ParsedPrompt {
  const promptKey = derivePromptKey(document, sourceName);
  const identity = derivePromptIdentity(document, promptKey, sourceName);
  const content = buildPromptContent(document, identity.promptTitle);
  const checksum = createHash('sha256').update(content).digest('hex');
  const chunkTexts = buildChunkTexts(content);

  const metadata = buildPromptMetadata(document, identity);
  const memoryType: MemoryType =
    identity.type === 'persona' ? 'persona' : identity.type === 'project' ? 'project' : 'semantic';

  return {
    promptKey,
    type: identity.type,
    personaSlug: identity.personaSlug,
    projectSlug: identity.projectSlug,
    metadata,
    content,
    chunkTexts,
    checksum,
    memoryType,
  };
}

function derivePromptKey(document: PromptDocument, sourceName: string): string {
  const agentId = document.agent?.id?.trim();
  if (agentId && agentId.length > 0) {
    return agentId.toLowerCase();
  }

  const base = path.basename(sourceName, path.extname(sourceName));
  return base.toLowerCase();
}

interface PromptIdentity {
  promptTitle: string;
  personaSlug: string | null;
  projectSlug: string | null;
  type: PromptType;
}

function derivePromptIdentity(
  document: PromptDocument,
  promptKey: string,
  sourceName: string,
): PromptIdentity {
  const promptKeySlug = ensureSlug(promptKey);
  const title = document.title?.trim() ?? promptKey;
  const lowerTitle = title.toLowerCase();
  const inferredFromTitle: PromptType | null = lowerTitle.includes('×')
    ? 'combination'
    : lowerTitle.includes('persona')
      ? 'persona'
      : lowerTitle.includes('project')
        ? 'project'
        : null;

  const keyParts = promptKey.split('-').filter(Boolean);

  if (inferredFromTitle === 'combination' || keyParts.length >= 2) {
    const personaSlug = ensureSlug(keyParts[0]);
    const projectSlug = ensureSlug(keyParts[keyParts.length - 1]);
    return {
      promptTitle: title,
      personaSlug,
      projectSlug,
      type: 'combination',
    };
  }

  if (inferredFromTitle === 'project') {
    return {
      promptTitle: title,
      personaSlug: null,
      projectSlug: promptKeySlug,
      type: 'project',
    };
  }

  if (inferredFromTitle === 'persona') {
    return {
      promptTitle: title,
      personaSlug: promptKeySlug,
      projectSlug: null,
      type: 'persona',
    };
  }

  // Fall back to persona unless title strongly indicates project.
  const likelyProject = lowerTitle.includes('project') || promptKey === 'project';

  if (likelyProject) {
    return {
      promptTitle: title,
      personaSlug: null,
      projectSlug: promptKeySlug,
      type: 'project',
    };
  }

  return {
    promptTitle: title,
    personaSlug: promptKeySlug,
    projectSlug: null,
    type: 'persona',
  };
}

function buildPromptMetadata(
  document: PromptDocument,
  identity: PromptIdentity,
): Record<string, unknown> {
  const persona = identity.personaSlug ? [identity.personaSlug] : [];
  const project = identity.projectSlug ? [identity.projectSlug] : [];

  const metadata: Record<string, unknown> = {
    type: identity.type,
    persona,
    project,
    title: identity.promptTitle,
  };

  if (document.activation_notice) {
    metadata.activationNotice = document.activation_notice;
  }

  if (document.critical_notice) {
    metadata.criticalNotice = document.critical_notice;
  }

  if (document.closing_message) {
    metadata.closingMessage = document.closing_message;
  }

  if (document.agent) {
    metadata.agent = document.agent;
  }

  if (document.persona) {
    metadata.personaDetails = document.persona;
  }

  if (document.operating_notes) {
    metadata.operatingNotes = document.operating_notes;
  }

  if (document.workflow) {
    metadata.workflow = document.workflow;
  }

  if (document.orientation) {
    metadata.orientation = document.orientation;
  }

  if (document.additional_sections) {
    metadata.additionalSections = document.additional_sections;
  }

  metadata.source = 'file';

  return metadata;
}

function buildPromptContent(document: PromptDocument, title: string): string {
  const lines: string[] = [];

  lines.push(`# ${title}`);

  appendSection(lines, 'Activation Notice', document.activation_notice);
  appendSection(lines, 'Critical Notice', document.critical_notice);

  if (document.agent) {
    appendAgentSection(lines, document.agent);
  }

  if (document.persona) {
    appendObjectSection(lines, 'Persona', document.persona);
  }

  if (document.operating_notes) {
    appendObjectSection(lines, 'Operating Notes', document.operating_notes);
  }

  if (document.workflow) {
    appendWorkflowSection(lines, document.workflow);
  }

  if (document.orientation) {
    appendObjectSection(lines, 'Orientation', document.orientation);
  }

  appendSection(lines, 'Closing Message', document.closing_message);

  const additional = extractAdditionalKeys(document);
  if (additional) {
    appendObjectSection(lines, 'Additional Sections', additional);
  }

  return lines.join('\n\n').trim();
}

function appendSection(lines: string[], heading: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  const content = formatValue(value);
  if (!content) {
    return;
  }

  lines.push(`## ${heading}`);
  lines.push(content);
}

function appendAgentSection(lines: string[], agent: Required<PromptDocument>['agent']): void {
  const details: string[] = [];

  if (agent?.title) {
    details.push(`Title: ${agent.title}`);
  }
  if (agent?.name) {
    details.push(`Name: ${agent.name}`);
  }
  if (agent?.id) {
    details.push(`ID: ${agent.id}`);
  }
  if (agent?.icon) {
    details.push(`Icon: ${agent.icon}`);
  }
  if (agent?.whentouse) {
    details.push(`When To Use: ${agent.whentouse}`);
  }
  if (agent?.customization) {
    details.push(`Customization: ${agent.customization}`);
  }

  if (details.length > 0) {
    lines.push(`## Agent`);
    lines.push(details.join('\n'));
  }
}

function appendObjectSection(lines: string[], heading: string, value: unknown): void {
  const content = formatStructuredValue(value, heading);
  if (!content) {
    return;
  }

  lines.push(`## ${heading}`);
  lines.push(content);
}

function appendWorkflowSection(lines: string[], value: unknown): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  const workflow = value as Record<string, unknown>;
  lines.push(`## Workflow`);

  if (workflow.definition_of_success) {
    lines.push(`### Definition of Success`);
    const definition = formatValue(workflow.definition_of_success);
    if (definition) {
      lines.push(definition);
    }
  }

  if (Array.isArray(workflow.inputs)) {
    lines.push(`### Inputs`);
    lines.push(formatList(workflow.inputs));
  }

  if (workflow.tooling) {
    lines.push(`### Tooling`);
    const tooling = formatValue(workflow.tooling);
    if (tooling) {
      lines.push(tooling);
    }
  }

  if (Array.isArray(workflow.steps)) {
    lines.push(`### Steps`);
    const formattedSteps = workflow.steps
      .map((step, index) => formatWorkflowStep(step, index))
      .filter(Boolean)
      .join('\n');
    if (formattedSteps) {
      lines.push(formattedSteps);
    }
  }

  if (Array.isArray(workflow.validation_checklist)) {
    lines.push(`### Validation Checklist`);
    lines.push(formatList(workflow.validation_checklist));
  }

  if (Array.isArray(workflow.risk_fallbacks)) {
    lines.push(`### Risk Fallbacks`);
    lines.push(formatList(workflow.risk_fallbacks));
  }

  if (Array.isArray(workflow.faqs)) {
    lines.push(`### FAQs`);
    const faqs = workflow.faqs
      .map((faq) => formatFaqItem(faq))
      .filter(Boolean)
      .join('\n');
    if (faqs) {
      lines.push(faqs);
    }
  }
}

function formatWorkflowStep(step: unknown, index: number): string | null {
  if (!step || typeof step !== 'object') {
    return null;
  }

  const data = step as Record<string, unknown>;
  const order = Number.isFinite(data.order) ? Number(data.order) : index + 1;
  const instruction = typeof data.instruction === 'string' ? data.instruction : null;

  if (!instruction) {
    return null;
  }

  const lines = [`${order}. ${instruction}`];

  if (Array.isArray(data.sections) && data.sections.length > 0) {
    const sections = data.sections
      .map((section) => formatWorkflowSectionDetails(section))
      .filter(Boolean);
    if (sections.length > 0) {
      lines.push(sections.join('\n'));
    }
  }

  return lines.join('\n');
}

function formatWorkflowSectionDetails(section: unknown): string | null {
  if (!section || typeof section !== 'object') {
    return null;
  }

  const data = section as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name : null;
  const details = typeof data.details === 'string' ? data.details : null;

  if (!name && !details) {
    return null;
  }

  if (name && details) {
    return `   - ${name}: ${details}`;
  }

  return `   - ${name ?? details}`;
}

function formatFaqItem(faq: unknown): string | null {
  if (!faq || typeof faq !== 'object') {
    return null;
  }

  const data = faq as Record<string, unknown>;
  const question = typeof data.question === 'string' ? data.question : null;
  const answer = typeof data.answer === 'string' ? data.answer : null;

  if (!question && !answer) {
    return null;
  }

  return question && answer ? `- Q: ${question}\n  A: ${answer}` : `- ${question ?? answer}`;
}

function extractAdditionalKeys(document: PromptDocument): Record<string, unknown> | null {
  const reservedKeys = new Set([
    'title',
    'activation_notice',
    'critical_notice',
    'closing_message',
    'agent',
    'persona',
    'operating_notes',
    'workflow',
    'orientation',
    'additional_sections',
  ]);

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (reservedKeys.has(key)) {
      continue;
    }
    extra[key] = value;
  }

  return Object.keys(extra).length > 0 ? extra : null;
}

function formatValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0 ? value.trim() : null;
  }

  if (Array.isArray(value)) {
    return formatList(value);
  }

  if (typeof value === 'object') {
    return formatStructuredValue(value, 'value');
  }

  return String(value);
}

function formatStructuredValue(value: unknown, heading: string): string | null {
  if (!value || typeof value !== 'object') {
    return formatValue(value);
  }

  const lines: string[] = [];

  for (const [key, entry] of Object.entries(value)) {
    const formatted = formatValue(entry);
    if (!formatted) {
      continue;
    }

    const title = toTitleCase(key);
    lines.push(`### ${title}`);
    lines.push(formatted);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

function formatList(value: unknown[]): string {
  return value
    .map((item) => formatValue(item))
    .filter((item): item is string => Boolean(item))
    .map((item) => `- ${item}`)
    .join('\n');
}

function toTitleCase(input: string): string {
  return input
    .split(/[_\s]+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function buildChunkTexts(content: string): ChunkText[] {
  const chunks: ChunkText[] = [
    {
      granularity: 'document',
      text: content,
      index: 0,
    },
  ];

  const sections = content.split('\n## ').slice(1);

  sections.forEach((section, index) => {
    const text = `## ${section}`.trim();
    if (text.length > 0) {
      chunks.push({
        granularity: 'section',
        text,
        index: index,
      });
    }
  });

  return chunks;
}

async function buildEmbeddingRecords(
  prompt: ParsedPrompt,
  embed: McpEmbeddings['embedTexts'],
): Promise<EmbeddingRecord[]> {
  const chunkTexts = prompt.chunkTexts.map((chunk) => chunk.text);
  const embeddings = await embed(chunkTexts);

  return prompt.chunkTexts.map((chunk, index) => ({
    chunkId: `${prompt.checksum.slice(0, 16)}-${chunk.granularity}-${chunk.index}`,
    promptKey: prompt.promptKey,
    chunkText: chunk.text,
    rawSource: chunk.text,
    granularity: chunk.granularity,
    embedding: embeddings[index],
    metadata: prompt.metadata,
    checksum: prompt.checksum,
    memoryType: prompt.memoryType,
  }));
}

function ensureSlug(value?: string | null): string | null {
  const slug = normaliseSlug(value);
  if (slug) {
    return slug;
  }

  if (value === undefined || value === null) {
    return null;
  }

  const fallback = value.trim().toLowerCase();
  return fallback.length > 0 ? fallback : null;
}
