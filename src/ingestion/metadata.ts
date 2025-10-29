import path from 'node:path';

export type PromptType = 'persona' | 'project' | 'combination';

export interface ParsePromptMetadataParams {
  filePath: string;
  contents: string;
}

export interface PromptAgent {
  name?: string;
  id?: string;
  title?: string;
  icon?: string;
  whentouse?: string;
  customization?: string;
}

export interface PromptPersona {
  role?: string;
  style?: string;
  identity?: string;
  focus?: string;
  corePrinciples?: string[];
}

export interface WorkflowStep {
  order?: number;
  instruction: string;
}

export interface PromptWorkflow {
  definitionOfSuccess?: string;
  inputs?: string[];
  steps?: WorkflowStep[];
  outputSchema?: unknown;
  outputNotes?: string[];
  vibeGuardrails?: string[];
  surrealDirective?: string[];
  example?: Record<string, unknown>;
  additionalSections?: Record<string, unknown>;
}

export interface ParsedPromptMetadata {
  type: PromptType;
  persona: string[];
  project: string[];
  filename: string;
  title?: string;
  activationNotice?: string;
  criticalNotice?: string;
  agent?: PromptAgent;
  personaDetails?: PromptPersona;
  operatingNotes?: Record<string, string[]>;
  workflow?: PromptWorkflow;
  orientation?: Record<string, unknown>;
  closingMessage?: string;
  additionalSections?: Record<string, unknown>;
  document: PromptJsonDocument;
}

export interface PromptJsonDocument extends Record<string, unknown> {
  title?: unknown;
  activation_notice?: unknown;
  critical_notice?: unknown;
  agent?: unknown;
  persona?: unknown;
  operating_notes?: unknown;
  workflow?: unknown;
  orientation?: unknown;
  closing_message?: unknown;
}

const PERSONA_PREFIX = 'persona-';
const PROJECT_PREFIX = 'project-';
const EXTENSION = '.json';

export function parsePromptMetadata(params: ParsePromptMetadataParams): ParsedPromptMetadata {
  const baseMetadata = inferFilenameMetadata(params.filePath);
  const document = parsePromptDocument(params.contents, baseMetadata.filename);

  const agent = normaliseAgent(document.agent);
  const personaDetails = normalisePersona(document.persona);
  const operatingNotes = normaliseOperatingNotes(document.operating_notes);
  const workflow = normaliseWorkflow(document.workflow);
  const orientation = normaliseOrientation(document.orientation);
  const closingMessage = stringOrUndefined(document.closing_message);

  const metadata: ParsedPromptMetadata = {
    ...baseMetadata,
    title: stringOrUndefined(document.title),
    activationNotice: stringOrUndefined(document.activation_notice),
    criticalNotice: stringOrUndefined(document.critical_notice),
    agent,
    personaDetails,
    operatingNotes,
    workflow,
    orientation,
    closingMessage,
    document,
  };

  const additionalSections = extractAdditionalSections(document);
  if (Object.keys(additionalSections).length > 0) {
    metadata.additionalSections = additionalSections;
  }

  return metadata;
}

export function buildMetadataRecord(metadata: ParsedPromptMetadata): Record<string, unknown> {
  const record: Record<string, unknown> = {
    type: metadata.type,
    persona: metadata.persona,
    project: metadata.project,
    filename: metadata.filename,
  };

  if (metadata.title) {
    record.title = metadata.title;
  }

  if (metadata.activationNotice) {
    record.activationNotice = metadata.activationNotice;
  }

  if (metadata.criticalNotice) {
    record.criticalNotice = metadata.criticalNotice;
  }

  if (metadata.agent) {
    record.agent = metadata.agent;
  }

  if (metadata.personaDetails) {
    record.personaDetails = metadata.personaDetails;
  }

  if (metadata.operatingNotes) {
    record.operatingNotes = metadata.operatingNotes;
  }

  if (metadata.workflow) {
    record.workflow = metadata.workflow;
  }

  if (metadata.orientation) {
    record.orientation = metadata.orientation;
  }

  if (metadata.closingMessage) {
    record.closingMessage = metadata.closingMessage;
  }

  if (metadata.additionalSections) {
    record.additional = metadata.additionalSections;
  }

  return record;
}

export function buildPromptText(metadata: ParsedPromptMetadata): string {
  const sections: string[] = [];

  sections.push(`# ${metadata.title ?? metadata.filename}`);

  if (metadata.activationNotice) {
    sections.push(`Activation Notice:\n${metadata.activationNotice}`);
  }

  if (metadata.criticalNotice) {
    sections.push(`Critical Notice:\n${metadata.criticalNotice}`);
  }

  if (metadata.agent) {
    sections.push(
      [
        'Agent:',
        metadata.agent.title ? `Title: ${metadata.agent.title}` : null,
        metadata.agent.name ? `Name: ${metadata.agent.name}` : null,
        metadata.agent.id ? `ID: ${metadata.agent.id}` : null,
        metadata.agent.icon ? `Icon: ${metadata.agent.icon}` : null,
        metadata.agent.whentouse ? `When To Use: ${metadata.agent.whentouse}` : null,
        metadata.agent.customization ? `Customization: ${metadata.agent.customization}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (metadata.personaDetails) {
    const personaLines = [
      'Persona:',
      metadata.personaDetails.role ? `Role: ${metadata.personaDetails.role}` : null,
      metadata.personaDetails.style ? `Style: ${metadata.personaDetails.style}` : null,
      metadata.personaDetails.identity ? `Identity: ${metadata.personaDetails.identity}` : null,
      metadata.personaDetails.focus ? `Focus: ${metadata.personaDetails.focus}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const principles =
      metadata.personaDetails.corePrinciples?.map((value) => `- ${value}`) ?? [];

    sections.push(
      principles.length ? `${personaLines}\nCore Principles:\n${principles.join('\n')}` : personaLines,
    );
  }

  if (metadata.operatingNotes) {
    const notes = Object.entries(metadata.operatingNotes)
      .map(([key, values]) => `${formatHeading(key)}:\n${values.map((value) => `- ${value}`).join('\n')}`)
      .join('\n\n');

    if (notes) {
      sections.push(`Operating Notes:\n${notes}`);
    }
  }

  if (metadata.workflow) {
    const workflowText = formatWorkflow(metadata.workflow).trim();
    if (workflowText.length > 0) {
      sections.push(`Workflow:\n${workflowText}`);
    }
  }

  if (metadata.orientation) {
    const orientationText = formatRecordOfArrays(metadata.orientation).trim();
    if (orientationText.length > 0) {
      sections.push(`Orientation:\n${orientationText}`);
    }
  }

  if (metadata.closingMessage) {
    sections.push(`Closing Message:\n${metadata.closingMessage}`);
  }

  if (metadata.additionalSections) {
    const extras = formatRecordOfArrays(metadata.additionalSections);
    if (extras.trim().length > 0) {
      sections.push(`Additional:\n${extras.trim()}`);
    }
  }

  return sections.join('\n\n');
}

function inferFilenameMetadata(filePath: string): {
  type: PromptType;
  persona: string[];
  project: string[];
  filename: string;
} {
  const filename = path.basename(filePath);

  if (!filename.endsWith(EXTENSION)) {
    throw new Error(`Unsupported file type for prompt: ${filename}`);
  }

  const basename = filename.slice(0, -EXTENSION.length);

  if (basename.startsWith(PERSONA_PREFIX)) {
    const personaSlug = basename.slice(PERSONA_PREFIX.length);
    if (!personaSlug) {
      throw new Error(`Persona filename missing identifier: ${filename}`);
    }
    const persona = slugToList(personaSlug);
    return {
      type: 'persona',
      persona,
      project: [],
      filename,
    };
  }

  if (basename.startsWith(PROJECT_PREFIX)) {
    const projectSlug = basename.slice(PROJECT_PREFIX.length);
    if (!projectSlug) {
      throw new Error(`Project filename missing identifier: ${filename}`);
    }
    const project = slugToList(projectSlug);
    return {
      type: 'project',
      persona: [],
      project,
      filename,
    };
  }

  const separatorIndex = basename.lastIndexOf('-');
  if (separatorIndex === -1) {
    throw new Error(`Unable to infer prompt type from filename: ${filename}`);
  }

  const personaSlug = basename.slice(0, separatorIndex);
  const projectSlug = basename.slice(separatorIndex + 1);

  if (!personaSlug || !projectSlug) {
    throw new Error(`Invalid combination filename: ${filename}`);
  }

  return {
    type: 'combination',
    persona: slugToList(personaSlug),
    project: slugToList(projectSlug),
    filename,
  };
}

function parsePromptDocument(contents: string, filename: string): PromptJsonDocument {
  try {
    const parsed = JSON.parse(contents) as unknown;
    if (!isPlainObject(parsed)) {
      throw new Error('Prompt JSON must be an object');
    }

    return parsed as PromptJsonDocument;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse error';
    throw new Error(`Failed to parse JSON prompt "${filename}": ${message}`);
  }
}

function normaliseAgent(value: unknown): PromptAgent | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const agent: PromptAgent = {};

  if (typeof value.name === 'string') {
    agent.name = value.name;
  }

  if (typeof value.id === 'string') {
    agent.id = value.id;
  }

  if (typeof value.title === 'string') {
    agent.title = value.title;
  }

  if (typeof value.icon === 'string') {
    agent.icon = value.icon;
  }

  if (typeof value.whentouse === 'string') {
    agent.whentouse = value.whentouse;
  }

  if (typeof value.customization === 'string') {
    agent.customization = value.customization;
  }

  return Object.keys(agent).length > 0 ? agent : undefined;
}

function normalisePersona(value: unknown): PromptPersona | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const persona: PromptPersona = {};

  if (typeof value.role === 'string') {
    persona.role = value.role;
  }

  if (typeof value.style === 'string') {
    persona.style = value.style;
  }

  if (typeof value.identity === 'string') {
    persona.identity = value.identity;
  }

  if (typeof value.focus === 'string') {
    persona.focus = value.focus;
  }

  if (Array.isArray(value.core_principles)) {
    const principles = value.core_principles
      .map((item) => (typeof item === 'string' ? item : null))
      .filter(Boolean) as string[];

    if (principles.length > 0) {
      persona.corePrinciples = principles;
    }
  }

  return Object.keys(persona).length > 0 ? persona : undefined;
}

function normaliseOperatingNotes(value: unknown): Record<string, string[]> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const notes: Record<string, string[]> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const list = toStringArray(rawValue);
    if (list.length > 0) {
      notes[key] = list;
    }
  }

  return Object.keys(notes).length > 0 ? notes : undefined;
}

function normaliseWorkflow(value: unknown): PromptWorkflow | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const workflow: PromptWorkflow = {};

  if (typeof value.definition_of_success === 'string') {
    workflow.definitionOfSuccess = value.definition_of_success;
  }

  const inputs = toStringArray(value.inputs);
  if (inputs.length > 0) {
    workflow.inputs = inputs;
  }

  if (Array.isArray(value.steps)) {
    const steps = value.steps
      .map((item) => {
        if (!isPlainObject(item) || typeof item.instruction !== 'string') {
          return null;
        }

        const step: WorkflowStep = {
          instruction: item.instruction,
        };

        if (typeof item.order === 'number' && Number.isFinite(item.order)) {
          step.order = item.order;
        }

        return step;
      })
      .filter(Boolean) as WorkflowStep[];

    if (steps.length > 0) {
      workflow.steps = steps;
    }
  }

  if (value.output_schema !== undefined) {
    workflow.outputSchema = value.output_schema;
  }

  const outputNotes = toStringArray(value.output_notes);
  if (outputNotes.length > 0) {
    workflow.outputNotes = outputNotes;
  }

  const vibeGuardrails = toStringArray(value.vibe_guardrails);
  if (vibeGuardrails.length > 0) {
    workflow.vibeGuardrails = vibeGuardrails;
  }

  const surrealDirective = toStringArray(value.surreal_directive);
  if (surrealDirective.length > 0) {
    workflow.surrealDirective = surrealDirective;
  }

  if (isPlainObject(value.example)) {
    workflow.example = value.example as Record<string, unknown>;
  }

  const extras = extractUnknownKeys(value, [
    'definition_of_success',
    'inputs',
    'steps',
    'output_schema',
    'output_notes',
    'vibe_guardrails',
    'surreal_directive',
    'example',
  ]);

  if (Object.keys(extras).length > 0) {
    workflow.additionalSections = extras;
  }

  return Object.keys(workflow).length > 0 ? workflow : undefined;
}

function normaliseOrientation(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const orientation: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    if (Array.isArray(rawValue)) {
      const values = toStringArray(rawValue);
      if (values.length > 0) {
        orientation[key] = values;
      }
    } else if (isPlainObject(rawValue)) {
      orientation[key] = rawValue;
    } else if (typeof rawValue === 'string') {
      orientation[key] = rawValue;
    }
  }

  return Object.keys(orientation).length > 0 ? orientation : undefined;
}

function extractAdditionalSections(document: PromptJsonDocument): Record<string, unknown> {
  const knownKeys = new Set([
    'title',
    'activation_notice',
    'critical_notice',
    'agent',
    'persona',
    'operating_notes',
    'workflow',
    'orientation',
    'closing_message',
  ]);

  const additional: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(document)) {
    if (knownKeys.has(key)) {
      continue;
    }

    additional[key] = value;
  }

  return additional;
}

function slugToList(slug: string): string[] {
  return slug
    .split(/\+|_/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? [value] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item : null))
    .filter((item): item is string => item !== null && item.trim().length > 0);
}

function extractUnknownKeys(
  value: Record<string, unknown>,
  knownKeys: string[],
): Record<string, unknown> {
  const unknown: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(value)) {
    if (!knownKeys.includes(key)) {
      unknown[key] = val;
    }
  }

  return unknown;
}

function formatHeading(raw: string): string {
  return raw
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function formatWorkflow(workflow: PromptWorkflow): string {
  const lines: string[] = [];

  if (workflow.definitionOfSuccess) {
    lines.push(`\nDefinition of Success: ${workflow.definitionOfSuccess}`);
  }

  if (workflow.inputs?.length) {
    lines.push(`\nInputs:\n${workflow.inputs.map((value) => `- ${value}`).join('\n')}`);
  }

  if (workflow.steps?.length) {
    const formattedSteps = workflow.steps
      .map((step) =>
        step.order !== undefined ? `${step.order}. ${step.instruction}` : `- ${step.instruction}`,
      )
      .join('\n');
    lines.push(`\nSteps:\n${formattedSteps}`);
  }

  if (workflow.outputNotes?.length) {
    lines.push(`\nOutput Notes:\n${workflow.outputNotes.map((value) => `- ${value}`).join('\n')}`);
  }

  if (workflow.vibeGuardrails?.length) {
    lines.push(
      `\nVibe Guardrails:\n${workflow.vibeGuardrails.map((value) => `- ${value}`).join('\n')}`,
    );
  }

  if (workflow.surrealDirective?.length) {
    lines.push(
      `\nSurreal Directive:\n${workflow.surrealDirective.map((value) => `- ${value}`).join('\n')}`,
    );
  }

  if (workflow.additionalSections && Object.keys(workflow.additionalSections).length > 0) {
    lines.push(`\nAdditional:\n${formatRecordOfArrays(workflow.additionalSections).trim()}`);
  }

  return lines.join('\n');
}

function formatRecordOfArrays(value: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [key, raw] of Object.entries(value)) {
    if (Array.isArray(raw)) {
      const values = toStringArray(raw);
      if (values.length > 0) {
        parts.push(`${formatHeading(key)}:\n${values.map((item) => `- ${item}`).join('\n')}`);
      }
    } else if (isPlainObject(raw)) {
      parts.push(`${formatHeading(key)}:\n${JSON.stringify(raw, null, 2)}`);
    } else if (typeof raw === 'string') {
      parts.push(`${formatHeading(key)}:\n${raw}`);
    }
  }

  return parts.join('\n\n');
}
