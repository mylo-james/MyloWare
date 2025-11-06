#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProjectRepository } from '../../src/db/repositories/project-repository.js';
import { pool } from '../../src/db/client.js';

interface V1Project {
  title: string;
  workflows?: string[];
  guardrails?: Record<string, unknown>;
  orientation?: {
    what_we_are?: string[];
    key_metrics?: string[];
  };
  operating_notes?: {
    uniqueness_enforcement_strategy?: any;
    specification_loading_strategy?: string[];
  };
}

async function migrateProjects() {
  console.log('🔄 Migrating projects from V1...');

  const repository = new ProjectRepository();
  const dataDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'data',
    'projects'
  );

  try {
    // Migrate AISMR project
    console.log('  - Migrating AISMR project...');
    const existingAismr = await repository.findByName('aismr');
    if (existingAismr) {
      console.log('    ⏭️  AISMR project already exists, skipping');
    } else {
      const aismrJson = await readFile(path.join(dataDir, 'aismr.json'), 'utf-8');
      const aismr: V1Project = JSON.parse(aismrJson);

      await repository.insert({
        name: 'aismr',
        description: aismr.title,
        workflows: [
          'idea-generation',
          'screenplay-generation',
          'video-generation',
          'publishing',
        ],
        guardrails: {
          runtime: '8.0 seconds',
          whisperTiming: '3.0 seconds',
          maxHands: 2,
          noMusic: true,
          aspectRatio: '9:16',
        },
        settings: {
          outputPlatforms: ['tiktok', 'youtube'],
          defaultPlatform: 'tiktok',
          uniquenessThreshold: 0.85,
          qualityMetrics: aismr.orientation?.key_metrics || [],
        },
        metadata: {
          v1Source: 'project-aismr.json',
          whatWeAre: aismr.orientation?.what_we_are || [],
          uniquenessStrategy:
            aismr.operating_notes?.uniqueness_enforcement_strategy || {},
        },
      });

      console.log('    ✓ AISMR project migrated');
    }

    // Create general project
    console.log('  - Creating general project...');
    const existingGeneral = await repository.findByName('general');
    if (existingGeneral) {
      console.log('    ⏭️  General project already exists, skipping');
    } else {
      const generalJson = await readFile(path.join(dataDir, 'general.json'), 'utf-8');
      const general = JSON.parse(generalJson) as V1Project;

      await repository.insert({
        name: 'general',
        description: general.title,
        workflows: general.workflows || ['conversation'],
        guardrails: general.guardrails || {},
        settings: {
          defaultPersona: 'chat',
          orientation: general.orientation || {},
        },
        metadata: {
          v1Source: 'general.json',
        },
      });

      console.log('    ✓ General project created');
    }

    console.log('✅ Project migration complete');
  } catch (error) {
    console.error('❌ Project migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrateProjects();
