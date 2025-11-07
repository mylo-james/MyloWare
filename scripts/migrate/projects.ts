#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProjectRepository } from '../../src/db/repositories/project-repository.js';
import { pool } from '../../src/db/client.js';

interface V1Project {
  title: string;
  workflow?: string[];
  workflows?: string[]; // Legacy support
  optionalSteps?: string[];
  guardrails?: Record<string, unknown>;
  orientation?: {
    what_we_are?: string[];
    key_metrics?: string[];
  };
  operating_notes?: {
    uniqueness_enforcement_strategy?: any;
    specification_loading_strategy?: string[];
  };
  specs?: {
    videoCount?: number;
    videoDuration?: number;
    generations?: string[];
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
        workflow: ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'],
        optionalSteps: [],
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
        workflow: general.workflows || ['conversation'],
        optionalSteps: [],
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

    // Create GenReact project
    console.log('  - Creating GenReact project...');
    const existingGenreact = await repository.findByName('genreact');
    if (existingGenreact) {
      console.log('    ⏭️  GenReact project already exists, skipping');
    } else {
      const genreactPath = path.join(dataDir, 'genreact.json');
      let genreact: V1Project | null = null;
      try {
        const genreactJson = await readFile(genreactPath, 'utf-8');
        genreact = JSON.parse(genreactJson) as V1Project;
      } catch (error) {
        // File doesn't exist, use defaults
        genreact = {
          title: 'GenReact Project',
          workflow: ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'],
          optionalSteps: ['alex'],
          specs: {
            videoCount: 6,
            videoDuration: 8.0,
            generations: ['Silent', 'Boomer', 'GenX', 'Millennial', 'GenZ', 'Alpha'],
          },
        };
      }

      await repository.insert({
        name: 'genreact',
        description: genreact.title,
        workflow: genreact.workflow || genreact.workflows || ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'],
        optionalSteps: genreact.optionalSteps || ['alex'],
        guardrails: genreact.guardrails || {},
        settings: {
          videoCount: genreact.specs?.videoCount || 6,
          videoDuration: genreact.specs?.videoDuration || 8.0,
          generations: genreact.specs?.generations || [],
        },
        metadata: {
          v1Source: 'genreact.json',
        },
      });

      console.log('    ✓ GenReact project created');
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
