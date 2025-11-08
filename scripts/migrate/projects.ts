#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProjectRepository } from '../../src/db/repositories/project-repository.js';
import { pool } from '../../src/db/client.js';
import { Client } from 'pg';
import { config } from '../../src/config/index.js';

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
    uniqueness_enforcement_strategy?: unknown;
    specification_loading_strategy?: string[];
  };
  specs?: {
    videoCount?: number;
    videoDuration?: number;
    generations?: string[];
  };
}

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

async function migrateProjects() {
  console.log('🔄 Migrating projects from V1...');

  // Wait for database to be available (with retries)
  try {
    await waitForDatabase();
    console.log('  ✓ Database connection established');
  } catch (error) {
    console.error('❌ Database connection failed:', error instanceof Error ? error.message : String(error));
    console.error('   Make sure your database is running and DATABASE_URL is set correctly.');
    console.error('   💡 Tips:');
    console.error('      - Local: Check if PostgreSQL is running (`pg_isready` or `psql`)');
    console.error('      - Docker: Run `npm run dev:docker` or check container status');
    console.error('      - Remote: Verify DATABASE_URL is correct and accessible');
    process.exit(1);
  }

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
      } catch {
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

    // Create Test Video Gen project
    console.log('  - Creating Test Video Gen project...');
    const existingTestVideoGen = await repository.findByName('test_video_gen');
    if (existingTestVideoGen) {
      console.log('    ⏭️  Test Video Gen project already exists, skipping');
    } else {
      const testVideoGenPath = path.join(dataDir, 'test_video_gen.json');
      let testVideoGen: V1Project | null = null;
      try {
        const testVideoGenJson = await readFile(testVideoGenPath, 'utf-8');
        testVideoGen = JSON.parse(testVideoGenJson) as V1Project;
      } catch {
        // File doesn't exist, use defaults
        testVideoGen = {
          title: 'Test Video Generation',
          workflow: ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'],
          optionalSteps: [],
          specs: {
            videoCount: 2,
            videoDuration: 10.0,
          },
        };
      }

      await repository.insert({
        name: 'test_video_gen',
        description: testVideoGen.title,
        workflow: testVideoGen.workflow || testVideoGen.workflows || ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'],
        optionalSteps: testVideoGen.optionalSteps || [],
        guardrails: testVideoGen.guardrails || {},
        settings: {
          videoCount: testVideoGen.specs?.videoCount || 2,
          videoDuration: testVideoGen.specs?.videoDuration || 10.0,
          testAccount: true,
          outputPlatforms: ['tiktok'],
          defaultPlatform: 'tiktok',
        },
        metadata: {
          v1Source: 'test_video_gen.json',
        },
      });

      console.log('    ✓ Test Video Gen project created');
    }

    console.log('✅ Project migration complete');
  } catch (error) {
    console.error('❌ Project migration failed:', error);
    if (error instanceof Error && error.message.includes('Connection')) {
      console.error('   💡 Tip: Make sure your database is running:');
      console.error('      - Local: Check if PostgreSQL is running');
      console.error('      - Docker: Run `npm run dev:docker` or check container status');
      console.error('      - Remote: Verify DATABASE_URL is correct and accessible');
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrateProjects();
