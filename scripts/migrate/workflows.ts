#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { storeMemory } from '../../src/tools/memory/storeTool.js';
import { pool } from '../../src/db/client.js';
import { cleanForAI } from '../../src/utils/validation.js';

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

async function migrateWorkflows() {
  console.log('🔄 Migrating workflows from V1...');

  const dataDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'data',
    'workflows'
  );

  const workflowFiles = [
    {
      path: path.join(dataDir, 'aismr-idea-generation-workflow.json'),
      name: 'AISMR Idea Generation',
    },
    {
      path: path.join(dataDir, 'aismr-screenplay-workflow.json'),
      name: 'AISMR Screenplay Generation',
    },
    {
      path: path.join(dataDir, 'aismr-video-generation-workflow.json'),
      name: 'AISMR Video Generation',
    },
    {
      path: path.join(dataDir, 'aismr-publishing-workflow.json'),
      name: 'AISMR Publishing',
    },
  ];

  try {
    for (const file of workflowFiles) {
      console.log(`  - Migrating ${file.name}...`);

      const workflowJson = await readFile(file.path, 'utf-8');
      const workflow: V1Workflow = JSON.parse(workflowJson);

      // Create content for semantic search
      const content = cleanForAI(
        `${workflow.workflow.name}: ${workflow.workflow.description}. Steps: ${workflow.workflow.steps.map((s) => s.description || s.id).join(', ')}`
      );

      // Store as procedural memory
      await storeMemory({
        content,
        memoryType: 'procedural',
        persona: workflow.persona,
        project: workflow.project,
        tags: ['workflow', ...workflow.project, ...(workflow.persona || [])],
        metadata: {
          workflow: workflow.workflow,
          v1Source: file.path.split('/').pop(),
          version: workflow.version || '1.0.0',
        },
      });

      console.log(`    ✓ ${file.name} migrated`);
    }

    console.log('✅ Workflow migration complete');
  } catch (error) {
    console.error('❌ Workflow migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrateWorkflows();
