import 'dotenv/config';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getOperationsDb } from '../src/db/operations/client';
import { closeOperationsPool } from '../src/db/operations/pool';
import * as ops from '../src/db/operations/schema';
import { closePool } from '../src/db/pool';
import { PromptEmbeddingsRepository, type EmbeddingRecord } from '../src/db/repository';
import { embedTexts } from '../src/vector/embedTexts';
import { MemoryLinkGenerator } from '../src/vector/linkDetector';
import {
  buildEmbeddingRecord,
  buildVideoMemoryChunk,
  type VideoArchiveRecord,
} from '../src/ingestion/videoArchive';

interface CliOptions {
  dryRun: boolean;
  limit?: number;
  videoStatuses: string[];
  runStatuses: string[];
}

interface VideoRow {
  videoId: string;
  runId: string;
  idea: string | null;
  userIdea: string | null;
  vibe: string | null;
  prompt: string | null;
  videoMetadata: unknown;
  videoStatus: string;
  videoCreatedAt: string | null;
  videoCompletedAt: string | null;
  runStatus: string;
  runMetadata: unknown;
  runInput: unknown;
  runCompletedAt: string | null;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const rows = await fetchVideoRows(options);

  if (rows.length === 0) {
    console.log('No completed AISMR videos found for archival.');
    await shutdown();
    return;
  }

  const archiveRecords = rows.map(mapRowToArchiveRecord);
  const chunks = archiveRecords.map(buildVideoMemoryChunk);

  console.log(
    `Prepared ${chunks.length} video memory chunk(s) from ${rows.length} source record(s).${options.dryRun ? ' (dry run)' : ''}`,
  );

  if (options.dryRun) {
    const preview = chunks.slice(0, Math.min(chunks.length, 3));
    for (const chunk of preview) {
      console.log(`\n--- ${chunk.chunkId} ---\n${chunk.chunkText}\n`);
    }
    await shutdown();
    return;
  }

  const embeddingRecords = await createEmbeddingRecords(chunks);

  if (embeddingRecords.length === 0) {
    console.warn('No embeddings generated; aborting archive update.');
    await shutdown();
    return;
  }

  const repository = new PromptEmbeddingsRepository();
  await repository.upsertEmbeddings(embeddingRecords);

  const linkGenerator = new MemoryLinkGenerator({ promptRepository: repository });
  try {
    await linkGenerator.generateForChunks(embeddingRecords.map((record) => record.chunkId));
  } catch (error) {
    console.error('Failed to generate memory links for archived videos', error);
  }

  console.log(
    `Archived ${embeddingRecords.length} video memory chunk(s) and generated graph links for AISMR.`,
  );

  await shutdown();
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const videoStatuses: string[] = [];
  const runStatuses: string[] = [];
  let dryRun = false;
  let limit: number | undefined;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg.startsWith('--status=')) {
      const values = arg.slice('--status='.length).split(',');
      for (const value of values) {
        const normalized = normaliseStatus(value);
        if (isVideoStatus(normalized)) {
          videoStatuses.push(normalized);
        } else {
          console.warn(`Ignoring unknown video status: ${value}`);
        }
      }
      continue;
    }

    if (arg.startsWith('--run-status=')) {
      const values = arg.slice('--run-status='.length).split(',');
      for (const value of values) {
        const normalized = normaliseStatus(value);
        if (isRunStatus(normalized)) {
          runStatuses.push(normalized);
        } else {
          console.warn(`Ignoring unknown run status: ${value}`);
        }
      }
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      } else {
        console.warn(`Ignoring invalid limit: ${arg}`);
      }
    }
  }

  return {
    dryRun,
    limit,
    videoStatuses: videoStatuses.length > 0 ? videoStatuses : ['complete'],
    runStatuses: runStatuses.length > 0 ? runStatuses : ['complete'],
  };
}

async function fetchVideoRows(options: CliOptions): Promise<VideoRow[]> {
  const db = getOperationsDb();
  const conditions: SQL[] = [];

  if (options.videoStatuses.length > 0) {
    conditions.push(inArray(ops.videos.status, options.videoStatuses));
  }

  if (options.runStatuses.length > 0) {
    conditions.push(inArray(ops.runs.status, options.runStatuses));
  }

  const whereClause =
    conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);

  const query = db
    .select({
      videoId: ops.videos.id,
      runId: ops.videos.runId,
      idea: ops.videos.idea,
      userIdea: ops.videos.userIdea,
      vibe: ops.videos.vibe,
      prompt: ops.videos.prompt,
      videoMetadata: ops.videos.metadata,
      videoStatus: ops.videos.status,
      videoCreatedAt: ops.videos.createdAt,
      videoCompletedAt: ops.videos.completedAt,
      runStatus: ops.runs.status,
      runMetadata: ops.runs.metadata,
      runInput: ops.runs.input,
      runCompletedAt: ops.runs.completedAt,
    })
    .from(ops.videos)
    .innerJoin(ops.runs, eq(ops.videos.runId, ops.runs.id));

  if (whereClause) {
    query.where(whereClause);
  }

  query.orderBy(desc(ops.videos.completedAt), desc(ops.videos.createdAt));

  if (options.limit) {
    query.limit(Math.max(1, options.limit));
  }

  const rows = await query;

  return rows.map((row) => ({
    videoId: row.videoId,
    runId: row.runId,
    idea: row.idea,
    userIdea: row.userIdea,
    vibe: row.vibe,
    prompt: row.prompt,
    videoMetadata: row.videoMetadata,
    videoStatus: row.videoStatus,
    videoCreatedAt: row.videoCreatedAt,
    videoCompletedAt: row.videoCompletedAt,
    runStatus: row.runStatus,
    runMetadata: row.runMetadata,
    runInput: row.runInput,
    runCompletedAt: row.runCompletedAt,
  }));
}

function mapRowToArchiveRecord(row: VideoRow): VideoArchiveRecord {
  const videoMetadata = toRecord(row.videoMetadata);
  const runMetadata = toRecord(row.runMetadata);
  const runInput = toRecord(row.runInput);

  const concept =
    extractString(videoMetadata, ['concept', 'idea']) ??
    extractString(runMetadata, ['concept', 'idea']) ??
    row.idea;

  const vibe =
    extractString(videoMetadata, ['vibe', 'tone']) ??
    extractString(runMetadata, ['vibe', 'tone']) ??
    row.vibe;

  const environment =
    extractString(videoMetadata, ['environment', 'setting', 'location']) ??
    extractString(runMetadata, ['environment', 'setting', 'location']) ??
    extractString(runInput, ['environment', 'setting', 'location']);

  const screenplayExcerpt =
    extractString(videoMetadata, ['screenplayExcerpt', 'screenplay_excerpt', 'screenplay']) ??
    extractString(runMetadata, ['screenplayExcerpt', 'screenplay_excerpt', 'screenplay']) ??
    row.prompt ??
    extractString(runInput, ['screenplay']);

  const performanceNotes =
    extractString(videoMetadata, [
      'performanceNotes',
      'performance_notes',
      'qualityNotes',
      'quality_notes',
      'notes',
      'summary',
      'performance.summary',
    ]) ??
    extractString(runMetadata, [
      'performanceNotes',
      'performance_notes',
      'qualityNotes',
      'quality_notes',
      'notes',
      'summary',
      'performance.summary',
    ]);

  const watchTime =
    extractNumber(videoMetadata, [
      'averageWatchTimeSeconds',
      'avgWatchTimeSeconds',
      'performance.avg_watch_time_s',
      'metrics.watch_time_seconds',
    ]) ??
    extractNumber(runMetadata, [
      'averageWatchTimeSeconds',
      'avgWatchTimeSeconds',
      'performance.avg_watch_time_s',
      'metrics.watch_time_seconds',
    ]);

  const completionRate =
    extractNumber(videoMetadata, ['completionRate', 'performance.completion_rate', 'metrics.completion_rate']) ??
    extractNumber(runMetadata, ['completionRate', 'performance.completion_rate', 'metrics.completion_rate']);

  const additionalMetadata: Record<string, unknown> = {};
  if (Object.keys(videoMetadata).length > 0) {
    additionalMetadata.videoMetadata = videoMetadata;
  }
  if (Object.keys(runMetadata).length > 0) {
    additionalMetadata.runMetadata = runMetadata;
  }
  if (Object.keys(runInput).length > 0) {
    additionalMetadata.runInput = runInput;
  }

  return {
    videoId: row.videoId,
    runId: row.runId,
    concept: concept ?? row.idea,
    userIdea: row.userIdea,
    vibe,
    environment,
    screenplayExcerpt,
    prompt: row.prompt,
    status: row.videoStatus,
    runStatus: row.runStatus,
    createdAt: row.videoCreatedAt,
    completedAt: row.videoCompletedAt ?? row.runCompletedAt,
    performanceNotes,
    averageWatchTimeSeconds: watchTime,
    completionRate,
    additionalMetadata,
  };
}

async function createEmbeddingRecords(chunks: ReturnType<typeof buildVideoMemoryChunk>[]): Promise<EmbeddingRecord[]> {
  const records: EmbeddingRecord[] = [];
  const batchSize = 20;

  for (let index = 0; index < chunks.length; index += batchSize) {
    const batch = chunks.slice(index, index + batchSize);
    const embeddings = await embedTexts(batch.map((chunk) => chunk.chunkText));

    if (embeddings.length !== batch.length) {
      throw new Error('Embedding service returned unexpected number of vectors.');
    }

    for (let i = 0; i < batch.length; i += 1) {
      records.push(buildEmbeddingRecord(batch[i], embeddings[i]));
    }
  }

  return records;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && !Array.isArray(parsed) && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function extractString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = resolvePath(source, key);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

function extractNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = resolvePath(source, key);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function resolvePath(source: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = source;

  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function normaliseStatus(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'completed') {
    return 'complete';
  }
  return trimmed;
}

function isVideoStatus(value: string): value is (typeof ops.videoStatusEnum.enumValues)[number] {
  return (ops.videoStatusEnum.enumValues as readonly string[]).includes(value);
}

function isRunStatus(value: string): value is (typeof ops.runStatusEnum.enumValues)[number] {
  return (ops.runStatusEnum.enumValues as readonly string[]).includes(value);
}

async function shutdown(): Promise<void> {
  await Promise.all([closePool(), closeOperationsPool()]);
}

main().catch(async (error) => {
  console.error('Failed to archive AISMR videos', error);
  await shutdown();
  process.exitCode = 1;
});
