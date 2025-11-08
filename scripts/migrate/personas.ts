#!/usr/bin/env tsx
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PersonaRepository, type Persona } from '../../src/db/repositories/persona-repository.js';
import { pool } from '../../src/db/client.js';
import { cleanForAI } from '../../src/utils/validation.js';
import { Client } from 'pg';
import { config } from '../../src/config/index.js';

type PersonaJson = {
  title?: string;
  agent?: {
    id?: string;
    name?: string;
    title?: string;
    role?: string;
    description?: string;
    defaultProject?: string | null;
    tone?: string;
  };
  capabilities?: string[];
  allowedTools?: string[];
  systemPrompt?: string;
  defaultProject?: string | null;
  tone?: string;
  memory?: unknown;
  identity?: {
    your_expertise?: string[];
    tone?: string;
  };
  workflow?: unknown;
  validation_checklist?: unknown;
  anti_patterns?: unknown;
  common_scenarios?: unknown;
  remember?: string;
};

const DEFAULT_TONE: Record<string, string> = {
  casey: 'confident',
  iggy: 'creative',
  riley: 'precise',
  veo: 'efficient',
  alex: 'meticulous',
  quinn: 'upbeat',
};

const DEFAULT_PROJECT: Record<string, string> = {
  casey: 'aismr',
  iggy: 'aismr',
  riley: 'aismr',
  veo: 'aismr',
  alex: 'aismr',
  quinn: 'aismr',
};

async function waitForDatabase(retries = 10, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = new Client({ connectionString: config.database.url });
      await client.connect();
      await client.end();
      return;
    } catch (error) {
      if (attempt === retries) {
        throw new Error(
          `Failed to connect to database after ${retries} attempts: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      console.log(`  ⏳ Waiting for database... (attempt ${attempt}/${retries})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  return [];
}

function buildMetadata(doc: PersonaJson, sourceFile: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    sourceFile,
  };

  if (doc.agent?.role) metadata.role = doc.agent.role;
  if (doc.agent?.description) metadata.description = doc.agent.description;
  if (doc.memory) metadata.memory = doc.memory;
  if (doc.workflow) metadata.workflow = doc.workflow;
  if (doc.validation_checklist) metadata.validationChecklist = doc.validation_checklist;
  if (doc.anti_patterns) metadata.antiPatterns = doc.anti_patterns;
  if (doc.common_scenarios) metadata.commonScenarios = doc.common_scenarios;
  if (doc.remember) metadata.remember = doc.remember;

  return metadata;
}

function toPersonaRecord(doc: PersonaJson, sourceFile: string): Omit<Persona, 'id' | 'createdAt' | 'updatedAt'> {
  const personaName = doc.agent?.id ?? path.basename(sourceFile, '.json');
  if (!personaName) {
    throw new Error(`Persona file ${sourceFile} is missing agent.id`);
  }

  const description = doc.agent?.title ?? doc.title ?? personaName;
  const capabilities = asStringArray(doc.capabilities).length > 0
    ? asStringArray(doc.capabilities)
    : asStringArray(doc.identity?.your_expertise).length > 0
    ? asStringArray(doc.identity?.your_expertise)
    : [doc.agent?.role ?? personaName];

  const tone = doc.tone ?? doc.agent?.tone ?? doc.identity?.tone ?? DEFAULT_TONE[personaName] ?? 'neutral';
  const defaultProject = doc.defaultProject ?? doc.agent?.defaultProject ?? DEFAULT_PROJECT[personaName] ?? null;
  const allowedTools = asStringArray(doc.allowedTools).length > 0
    ? Array.from(new Set(asStringArray(doc.allowedTools)))
    : ['memory_search', 'memory_store', 'handoff_to_agent'];

  const systemPrompt = doc.systemPrompt ? cleanForAI(doc.systemPrompt) : null;
  const metadata = buildMetadata(doc, sourceFile);

  return {
    name: personaName,
    description,
    capabilities,
    tone,
    defaultProject,
    systemPrompt,
    allowedTools,
    metadata,
  };
}

async function migratePersonas() {
  console.log('🔄 Migrating personas from local data/personas/*.json ...');

  try {
    await waitForDatabase();
    console.log('  ✓ Database connection established');
  } catch (error) {
    console.error('❌ Database connection failed:', error instanceof Error ? error.message : String(error));
    console.error('   Make sure your database is running and DATABASE_URL is set correctly.');
    process.exit(1);
  }

  const repository = new PersonaRepository();
  const dataDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'data',
    'personas'
  );

  try {
    const files = (await readdir(dataDir)).filter((file) => file.endsWith('.json')).sort();

    const deletedCount = await repository.deleteAll();
    console.log(`  🧹 Cleared ${deletedCount} existing personas`);

    for (const file of files) {
      const fullPath = path.join(dataDir, file);
      const raw = await readFile(fullPath, 'utf-8');
      const personaDoc = JSON.parse(raw) as PersonaJson;
      const record = toPersonaRecord(personaDoc, file);

      await repository.upsert(record);
      console.log(`    ✓ Upserted ${record.name}`);
    }

    console.log('✅ Persona migration complete');
  } catch (error) {
    console.error('❌ Persona migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void migratePersonas();
