import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { db } from '@/db/client.js';
import {
  memories as memoriesTable,
  personas as personasTable,
  projects as projectsTable,
  sessions as sessionsTable,
  workflowRuns as workflowRunsTable,
} from '@/db/schema.js';
import { PersonaRepository } from '@/db/repositories/persona-repository.js';
import { ProjectRepository } from '@/db/repositories/project-repository.js';
import { storeMemory } from '@/tools/memory/storeTool.js';
import { cleanForAI } from '@/utils/validation.js';
import { testMemories } from '../../scripts/db/seed-data/memories.ts';

interface V1Persona {
  agent: {
    name: string;
    id: string;
    title: string;
    whentouse: string;
  };
  persona: {
    role: string;
    style: string;
    identity: string;
    focus: string;
    core_principles?: string[];
  };
  workflow?: {
    definition_of_success?: string;
  };
}

interface V1Project {
  title: string;
  workflows?: string[];
  guardrails?: Record<string, unknown>;
  orientation?: {
    what_we_are?: string[];
    key_metrics?: string[];
  };
  operating_notes?: Record<string, unknown>;
}

interface V1Workflow {
  title: string;
  memoryType: string;
  project: string[];
  persona: string[];
  workflow: {
    name: string;
    description: string;
    steps: any[];
    output_format?: any;
    guardrails?: any[];
  };
  version?: string;
}

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const dataDir = (folder: string) => path.join(repoRoot, 'data', folder);

export async function seedBaseData(): Promise<void> {
  await clearTables();
  await seedPersonas();
  await seedProjects();
  await seedWorkflows();
  await seedMemories();
}

async function clearTables() {
  await db.delete(workflowRunsTable);
  await db.delete(sessionsTable);
  await db.delete(memoriesTable);
  await db.delete(personasTable);
  await db.delete(projectsTable);
}

async function seedPersonas() {
  const personaRepository = new PersonaRepository();
  const files = ['casey.json', 'ideagenerator.json', 'screenwriter.json'];
  const capabilityMap: Record<string, string[]> = {
    casey: ['conversation', 'workflow-discovery', 'orchestration'],
    ideagenerator: ['idea-generation', 'uniqueness-verification', 'memory-search'],
    screenwriter: ['screenplay-writing', 'timing-precision', 'spec-compliance'],
  };

  for (const file of files) {
    const raw = await readFile(path.join(dataDir('personas'), file), 'utf-8');
    const persona = JSON.parse(raw) as V1Persona;

    const systemPrompt = cleanForAI(`
You are ${persona.agent.name}, a ${persona.persona.role}.
Your style: ${persona.persona.style}.
Your identity: ${persona.persona.identity}.
Your focus areas: ${persona.persona.focus}.

Core principles:
${(persona.persona.core_principles || []).map((p, i) => `${i + 1}. ${p}`).join(' ')}

When to use you: ${persona.agent.whentouse}
${persona.workflow?.definition_of_success ? `Definition of success: ${persona.workflow.definition_of_success}` : ''}
    `.trim());

    await personaRepository.insert({
      name: persona.agent.id,
      description: persona.agent.title,
      capabilities: capabilityMap[persona.agent.id] || ['conversation'],
      tone: persona.persona.style,
      defaultProject: 'aismr',
      systemPrompt,
      metadata: {
        v1Source: file,
      },
    });
  }
}

async function seedProjects() {
  const projectRepository = new ProjectRepository();
  const files = ['aismr.json', 'general.json'];

  for (const file of files) {
    const raw = await readFile(path.join(dataDir('projects'), file), 'utf-8');
    const project = JSON.parse(raw) as V1Project;
    const name = file.startsWith('aismr') ? 'aismr' : 'general';

    await projectRepository.insert({
      name,
      description: project.title,
      workflows: project.workflows || ['conversation'],
      guardrails: project.guardrails || project.operating_notes || {},
      settings: {
        keyMetrics: project.orientation?.key_metrics || [],
        whatWeAre: project.orientation?.what_we_are || [],
      },
      metadata: {
        v1Source: file,
      },
    });
  }
}

async function seedWorkflows() {
  const workflowFiles = [
    'aismr-idea-generation-workflow.json',
    'aismr-screenplay-workflow.json',
    'aismr-video-generation-workflow.json',
    'aismr-publishing-workflow.json',
  ];

  for (const file of workflowFiles) {
    const raw = await readFile(path.join(dataDir('workflows'), file), 'utf-8');
    const workflow = JSON.parse(raw) as V1Workflow;

    const content = cleanForAI(
      `${workflow.workflow.name}: ${workflow.workflow.description}. Steps: ${workflow.workflow.steps
        .map((step) => step.description || step.id)
        .join(', ')}`
    );

    await storeMemory({
      content,
      memoryType: 'procedural',
      persona: workflow.persona,
      project: workflow.project,
      tags: ['workflow', ...workflow.project, ...(workflow.persona || [])],
      metadata: {
        workflow: workflow.workflow,
        v1Source: file,
        version: workflow.version || '1.0.0',
      },
    });
  }
}

async function seedMemories() {
  for (const memory of testMemories) {
    await storeMemory({
      content: memory.content,
      memoryType: memory.memoryType,
      persona: memory.persona,
      project: memory.project,
      tags: memory.tags,
      metadata: memory.metadata,
    });
  }
}
