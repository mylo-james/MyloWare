#!/usr/bin/env tsx
/**
 * Knowledge Ingestion CLI
 *
 * Processes files from data/kb/ directory:
 * 1. Reads markdown/text files
 * 2. Chunks and classifies content
 * 3. Deduplicates and stores in memory system
 * 4. Moves processed files to data/kb/ingested/
 *
 * Usage:
 *   npm run knowledge:ingest
 *   npm run knowledge:ingest -- --dry-run
 *   npm run knowledge:ingest -- --max-chunks=10
 *   npm run knowledge:ingest -- --similarity=0.95
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { knowledgeIngest } from '../../src/tools/knowledge/ingestTool.js';

/**
 * CLI configuration
 */
interface CLIConfig {
  dryRun: boolean;
  maxChunks?: number;
  minSimilarity?: number;
}

/**
 * File processing result
 */
interface FileProcessingResult {
  fileName: string;
  success: boolean;
  traceId?: string;
  inserted?: number;
  updated?: number;
  skipped?: number;
  error?: string;
}

/**
 * Statistics for batch processing
 */
interface BatchStats {
  processed: number;
  successes: number;
  failures: number;
}

/**
 * Parse numeric CLI argument
 *
 * @param args - CLI arguments
 * @param flag - Flag name (e.g., '--max-chunks')
 * @returns Parsed number or undefined
 */
function parseNumericArg(args: string[], flag: string): number | undefined {
    const prefix = `${flag}=`;
    const raw = args.find((arg) => arg.startsWith(prefix));
    if (!raw) return undefined;

    const parsed = Number.parseFloat(raw.slice(prefix.length));
    return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parse CLI configuration from arguments
 *
 * @param args - CLI arguments
 * @returns CLI configuration
 */
function parseCLIConfig(args: string[]): CLIConfig {
  const dryRun = args.includes('--dry-run');
  const cliMaxChunks = parseNumericArg(args, '--max-chunks');
  const cliMinSimilarity = parseNumericArg(args, '--similarity');

  // Check environment variable for max chunks
  const envMaxChunksRaw = process.env.KNOWLEDGE_MAX_CHUNKS;
  const envMaxChunks =
    envMaxChunksRaw !== undefined && envMaxChunksRaw !== ''
      ? Number.parseInt(envMaxChunksRaw, 10)
      : undefined;

  // Priority: CLI arg > env var
  const maxChunks =
    cliMaxChunks !== undefined && cliMaxChunks > 0
      ? Math.floor(cliMaxChunks)
      : envMaxChunks !== undefined && Number.isInteger(envMaxChunks) && envMaxChunks > 0
        ? envMaxChunks
        : undefined;

  const minSimilarity =
    cliMinSimilarity !== undefined &&
    cliMinSimilarity > 0 &&
    cliMinSimilarity <= 1
      ? cliMinSimilarity
      : undefined;

  return {
    dryRun,
    maxChunks,
    minSimilarity,
  };
}

/**
 * Ensure directories exist
 *
 * @param kbDir - Knowledge base directory
 * @param ingestedDir - Post-ingestion directory
 */
async function ensureDirectories(
  kbDir: string,
  ingestedDir: string
): Promise<void> {
  await fs.mkdir(kbDir, { recursive: true });
  await fs.mkdir(ingestedDir, { recursive: true });
}

/**
 * Find unique destination path (handles naming conflicts)
 *
 * @param dir - Target directory
 * @param fileName - Original file name
 * @returns Unique destination path
 */
async function findDestinationPath(
  dir: string,
  fileName: string
): Promise<string> {
  const parsed = path.parse(fileName);
  let candidate = path.join(dir, fileName);
  let counter = 1;

  for (;;) {
    try {
      await fs.access(candidate);
      // File exists, try next candidate
      candidate = path.join(dir, `${parsed.name}.${counter}${parsed.ext}`);
      counter++;
    } catch (error: unknown) {
      // File doesn't exist (ENOENT), use this path
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'ENOENT'
      ) {
        return candidate;
      }
      // Other error, throw
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code !== 'EEXIST'
      ) {
        throw error;
      }
    }
  }
}

/**
 * Process a single file
 *
 * @param fileName - Name of file to process
 * @param sourcePath - Full path to source file
 * @param ingestedDir - Post-processing directory
 * @param config - CLI configuration
 * @returns Processing result
 */
async function processFile(
  fileName: string,
  sourcePath: string,
  ingestedDir: string,
  config: CLIConfig
): Promise<FileProcessingResult> {
  try {
    // Read file
    const text = await fs.readFile(sourcePath, 'utf-8');
    const traceId = randomUUID();

    console.log(`\n[${fileName}] Generated traceId: ${traceId}`);

    // Dry run - skip actual processing
    if (config.dryRun) {
      console.log(`[${fileName}] DRY RUN - skipping ingestion and file move.`);
      return {
        fileName,
        success: true,
        traceId,
      };
    }

    // Ingest knowledge
    const result = await knowledgeIngest({
      traceId,
      text,
      ...(config.maxChunks !== undefined ? { maxChunks: config.maxChunks } : {}),
      ...(config.minSimilarity !== undefined
        ? { minSimilarity: config.minSimilarity }
        : {}),
    });

    console.log(
      `[${fileName}] Ingestion result: inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}, total=${result.totalChunks}`
    );

    // Move file to ingested directory
    const destinationPath = await findDestinationPath(ingestedDir, fileName);
    await fs.rename(sourcePath, destinationPath);
    console.log(`[${fileName}] Moved to ${destinationPath}`);

    return {
      fileName,
      success: true,
      traceId,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[${fileName}] Failed to ingest:`, errorMsg);

    return {
      fileName,
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Print configuration summary
 *
 * @param config - CLI configuration
 * @param kbDir - Source directory
 */
function printConfig(config: CLIConfig, kbDir: string): void {
  console.log(`Starting knowledge ingestion from ${kbDir}`);

  if (config.dryRun) {
    console.log('🔍 DRY RUN enabled - no database writes or file moves will occur.');
  }

  if (config.maxChunks !== undefined) {
    console.log(`📊 Limiting ingestion to ${config.maxChunks} chunk(s) per file.`);
  }

  if (config.minSimilarity !== undefined) {
    console.log(`🎯 Using similarity threshold ${config.minSimilarity}.`);
  }

  console.log('');
}

/**
 * Print summary statistics
 *
 * @param stats - Batch statistics
 */
function printSummary(stats: BatchStats): void {
  console.log('\n' + '='.repeat(50));
  console.log('📋 Knowledge Ingestion Complete');
  console.log('='.repeat(50));
  console.log(`📁 Processed files: ${stats.processed}`);
  console.log(`✅ Successful ingests: ${stats.successes}`);
  console.log(`❌ Failed ingests: ${stats.failures}`);

  if (stats.failures > 0) {
    console.log('\n⚠️  Some files failed to process. Check logs above for details.');
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, '../..');
  const kbDir = path.resolve(projectRoot, 'data/kb');
  const ingestedDir = path.join(kbDir, 'ingested');

  // Parse CLI config
  const args = process.argv.slice(2);
  const config = parseCLIConfig(args);

  // Ensure directories exist
  await ensureDirectories(kbDir, ingestedDir);

  // Find files to process (exclude ingested subdirectory)
  const entries = await fs.readdir(kbDir, { withFileTypes: true });
  const files = entries.filter(
    (entry) =>
      entry.isFile() &&
      !entry.name.startsWith('.') &&
      entry.name !== '.gitkeep'
  );

  if (files.length === 0) {
    console.log(`📭 No files found in ${kbDir}.`);
    console.log(`   Add markdown or text files to ingest knowledge.`);
    return;
  }

  // Print configuration
  printConfig(config, kbDir);

  // Process files
  const stats: BatchStats = {
    processed: 0,
    successes: 0,
    failures: 0,
  };

  for (const entry of files) {
    const fileName = entry.name;
    const sourcePath = path.join(kbDir, fileName);

    stats.processed++;

    const result = await processFile(fileName, sourcePath, ingestedDir, config);

    if (result.success) {
      stats.successes++;
    } else {
      stats.failures++;
    }
  }

  // Print summary
  printSummary(stats);

  // Exit with error code if any failures
  if (stats.failures > 0) {
    process.exit(1);
  }
}

// Run main
main().catch((err) => {
  console.error('❌ Fatal error during knowledge ingestion:', err);
  process.exit(1);
});
