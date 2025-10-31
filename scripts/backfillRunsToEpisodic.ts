#!/usr/bin/env tsx

import 'dotenv/config';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { sql, asc, inArray } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { closePool } from '../src/db/pool';
import { createOperationsDb } from '../src/db/operations/client';
import { closeOperationsPool } from '../src/db/operations/pool';
import {
  runs as runsTable,
  videos as videosTable,
  type Run,
  type Video,
} from '../src/db/operations/schema';
import { EpisodicMemoryRepository } from '../src/db/episodicRepository';

interface CliOptions {
  dryRun: boolean;
  limit?: number;
  runIds: Set<string>;
  force: boolean;
}

interface BackfillCandidate {
  run: Run;
  videos: Video[];
  sessionId: string;
  userId: string | null;
  userContent: string | null;
  assistantContent: string | null;
}

interface BackfillResult {
  runId: string;
  sessionId: string;
  insertedTurns: number;
  skippedReason?: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_BACKFILL_SOURCE = 'operations-backfill';
const BACKFILL_VERSION = '2025-10-31';

async function main() {
  const options = parseArgs(process.argv);
  const db = createDb();
  const operationsDb = createOperationsDb();
  const repository = new EpisodicMemoryRepository({ db });

  const existingRunIds = await loadExistingRunIds(db);
  const runsToProcess = await loadRuns(operationsDb, options);
  const videosByRun = await loadVideosByRun(operationsDb, runsToProcess.map((run) => run.id));

  const candidates = buildCandidates(runsToProcess, videosByRun, existingRunIds, options);
  const limitedCandidates =
    typeof options.limit === 'number' ? candidates.slice(0, options.limit) : candidates;

  if (limitedCandidates.length === 0) {
    console.info('No runs require backfill.');
    await shutdown();
    return;
  }

  console.info(
    `Found ${limitedCandidates.length} run${limitedCandidates.length === 1 ? '' : 's'} to process (dryRun=${options.dryRun}).`,
  );

  const results: BackfillResult[] = [];

  for (const candidate of limitedCandidates) {
    const result = options.dryRun
      ? simulateBackfill(candidate)
      : await applyBackfill(db, repository, candidate);
    results.push(result);
  }

  const inserted = results.filter((result) => result.insertedTurns > 0).length;
  const skipped = results.filter((result) => result.insertedTurns === 0).length;

  console.info(
    `Backfill complete. Inserted turns for ${inserted} run${inserted === 1 ? '' : 's'}, skipped ${skipped}.`,
  );

  for (const result of results) {
    if (result.skippedReason) {
      console.info(
        `- Run ${result.runId} (${result.sessionId}) skipped: ${result.skippedReason}`,
      );
    } else {
      console.info(
        `- Run ${result.runId} (${result.sessionId}): inserted ${result.insertedTurns} turn${result.insertedTurns === 1 ? '' : 's'}`,
      );
    }
  }

  await shutdown();

  async function shutdown() {
    await closeOperationsPool();
    await closePool();
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    limit: undefined,
    runIds: new Set<string>(),
    force: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = arg.slice('--limit='.length);
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value "${value}". Expected positive integer.`);
      }
      options.limit = parsed;
      continue;
    }

    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg.startsWith('--run=')) {
      const runId = arg.slice('--run='.length).trim();
      if (runId.length === 0) {
        throw new Error('Received empty value for --run.');
      }
      options.runIds.add(runId);
      continue;
    }

    if (arg.startsWith('--run-id=')) {
      const runId = arg.slice('--run-id='.length).trim();
      if (runId.length === 0) {
        throw new Error('Received empty value for --run-id.');
      }
      options.runIds.add(runId);
      continue;
    }

    throw new Error(`Unknown CLI argument "${arg}".`);
  }

  return options;
}

async function loadExistingRunIds(db: ReturnType<typeof createDb>): Promise<Set<string>> {
  const { rows } = await db.execute<{
    run_id: string | null;
  }>(
    sql`
      SELECT DISTINCT metadata->>'run_id' AS run_id
      FROM conversation_turns
      WHERE metadata ? 'run_id'
    `,
  );

  const runIds = rows
    .map((row) => row.run_id?.trim())
    .filter((value): value is string => Boolean(value));

  return new Set(runIds);
}

async function loadRuns(
  operationsDb: ReturnType<typeof createOperationsDb>,
  options: CliOptions,
): Promise<Run[]> {
  const baseRuns = await operationsDb
    .select()
    .from(runsTable)
    .orderBy(asc(runsTable.createdAt));

  if (options.runIds.size === 0) {
    return baseRuns;
  }

  return baseRuns.filter((run) => options.runIds.has(run.id));
}

async function loadVideosByRun(
  operationsDb: ReturnType<typeof createOperationsDb>,
  runIds: string[],
): Promise<Map<string, Video[]>> {
  const map = new Map<string, Video[]>();
  if (runIds.length === 0) {
    return map;
  }

  const videos = await operationsDb
    .select()
    .from(videosTable)
    .where(inArray(videosTable.runId, runIds))
    .orderBy(asc(videosTable.createdAt));

  for (const video of videos) {
    const list = map.get(video.runId) ?? [];
    list.push(video);
    map.set(video.runId, list);
  }

  return map;
}

function buildCandidates(
  runs: Run[],
  videosByRun: Map<string, Video[]>,
  existingRunIds: Set<string>,
  options: CliOptions,
): BackfillCandidate[] {
  const candidates: BackfillCandidate[] = [];

  for (const run of runs) {
    if (!options.force && existingRunIds.has(run.id)) {
      continue;
    }

    const sessionSeed = deriveSessionSeed(run);
    const sessionId = ensureUuid(sessionSeed, `operations-run:${run.id}`);
    const userId = deriveUserId(run);
    const userContent = extractUserContent(run);
    const assistantContent = buildAssistantContent(run, videosByRun.get(run.id) ?? []);

    if (!userContent && !assistantContent) {
      continue;
    }

    candidates.push({
      run,
      videos: videosByRun.get(run.id) ?? [],
      sessionId,
      userId,
      userContent,
      assistantContent,
    });
  }

  return candidates;
}

function deriveSessionSeed(run: Run): string {
  const chatId = run.chatId?.trim();
  if (chatId && chatId.length > 0) {
    return chatId.includes(':') ? chatId : `operations:${chatId}`;
  }

  const metadata = (run.metadata ?? {}) as Record<string, unknown>;
  const project = typeof metadata.projectSlug === 'string' ? metadata.projectSlug : 'unknown';
  return `${project}:run:${run.id}`;
}

function ensureUuid(candidate: string | null | undefined, fallbackSeed: string): string {
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (UUID_PATTERN.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    if (trimmed.length > 0) {
      return uuidFromString(trimmed);
    }
  }

  return uuidFromString(fallbackSeed);
}

function uuidFromString(input: string): string {
  const hash = createHash('sha1').update(String(input)).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20, 32)}`;
}

function deriveUserId(run: Run): string | null {
  const chatId = run.chatId?.trim();
  if (!chatId || chatId.length === 0) {
    return null;
  }

  if (chatId.includes(':')) {
    return chatId;
  }

  return `operations:${chatId}`;
}

function extractUserContent(run: Run): string | null {
  const input = (run.input ?? {}) as Record<string, unknown>;
  const userInputRaw = input.userInput ?? input.prompt ?? input.message;

  if (typeof userInputRaw === 'string') {
    const trimmed = userInputRaw.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

function buildAssistantContent(run: Run, videos: Video[]): string | null {
  const segments: string[] = [];

  if (videos.length > 0) {
    segments.push(
      `Generated ${videos.length} idea${videos.length === 1 ? '' : 's'} for project ${inferProjectSlug(run)}.`,
    );
    for (const [index, video] of videos.entries()) {
      const vibe = video.vibe ? ` • vibe: ${video.vibe}` : '';
      const status = video.status ? ` • status: ${video.status}` : '';
      const prompt =
        video.prompt && video.prompt.trim().length > 0
          ? `\n    Prompt: ${truncate(video.prompt.trim(), 200)}`
          : '';
      segments.push(
        `${index + 1}. ${video.idea}${vibe}${status}${prompt ? prompt : ''}${
          video.userIdea ? `\n    User idea: ${video.userIdea}` : ''
        }`,
      );
    }
  }

  const result = typeof run.result === 'string' ? run.result.trim() : '';
  if (result.length > 0) {
    segments.push(`Run result: ${result}`);
  } else if (segments.length === 0) {
    segments.push(`Run status: ${run.status}`);
  }

  if (segments.length === 0) {
    return null;
  }

  return segments.join('\n');
}

function inferProjectSlug(run: Run): string {
  const metadata = (run.metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata.projectSlug === 'string' && metadata.projectSlug.trim().length > 0) {
    return metadata.projectSlug.trim();
  }
  return run.projectId;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function simulateBackfill(candidate: BackfillCandidate): BackfillResult {
  const estimatedChars =
    (candidate.userContent?.length ?? 0) + (candidate.assistantContent?.length ?? 0);
  console.info(
    `[dry-run] Run ${candidate.run.id} (${candidate.sessionId}) would insert ${
      candidate.userContent ? 'user' : ''
    }${candidate.userContent && candidate.assistantContent ? ' + ' : ''}${
      candidate.assistantContent ? 'assistant' : ''
    } turn${candidate.assistantContent && candidate.userContent ? 's' : ''} (≈${estimatedChars} chars).`,
  );

  return {
    runId: candidate.run.id,
    sessionId: candidate.sessionId,
    insertedTurns: 0,
    skippedReason: undefined,
  };
}

async function applyBackfill(
  db: ReturnType<typeof createDb>,
  repository: EpisodicMemoryRepository,
  candidate: BackfillCandidate,
): Promise<BackfillResult> {
  const insertedIds: { turnId: string; chunkId: string; createdAt: string }[] = [];

  if (candidate.userContent) {
    const result = await repository.storeConversationTurn({
      sessionId: candidate.sessionId,
      role: 'user',
      content: candidate.userContent,
      userId: candidate.userId ?? undefined,
      metadata: buildUserMetadata(candidate),
      embeddingText: candidate.userContent,
    });

    const timestamp = selectTimestamp(candidate.run.createdAt ?? candidate.run.startedAt);
    if (timestamp) {
      await syncTurnTimestamps(db, result.turn.id, result.chunkId, timestamp);
    }
    insertedIds.push({
      turnId: result.turn.id,
      chunkId: result.chunkId,
      createdAt: timestamp ?? result.turn.createdAt ?? new Date().toISOString(),
    });
  }

  if (candidate.assistantContent) {
    const result = await repository.storeConversationTurn({
      sessionId: candidate.sessionId,
      role: 'assistant',
      content: candidate.assistantContent,
      userId: candidate.userId ?? undefined,
      metadata: buildAssistantMetadata(candidate),
      embeddingText: candidate.assistantContent,
    });

    const timestamp = selectTimestamp(candidate.run.completedAt ?? candidate.run.updatedAt);
    if (timestamp) {
      await syncTurnTimestamps(db, result.turn.id, result.chunkId, timestamp);
    }
    insertedIds.push({
      turnId: result.turn.id,
      chunkId: result.chunkId,
      createdAt: timestamp ?? result.turn.createdAt ?? new Date().toISOString(),
    });
  }

  return {
    runId: candidate.run.id,
    sessionId: candidate.sessionId,
    insertedTurns: insertedIds.length,
  };
}

function buildUserMetadata(candidate: BackfillCandidate): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    source: DEFAULT_BACKFILL_SOURCE,
    backfillVersion: BACKFILL_VERSION,
    runId: candidate.run.id,
    chatId: candidate.run.chatId ?? null,
    projectId: candidate.run.projectId,
    personaId: candidate.run.personaId ?? null,
    runStatus: candidate.run.status,
    runCreatedAt: candidate.run.createdAt ?? null,
    type: 'run_input',
  };

  const input = (candidate.run.input ?? {}) as Record<string, unknown>;
  if (Object.keys(input).length > 0) {
    metadata.runInput = input;
  }

  const runMetadata = (candidate.run.metadata ?? {}) as Record<string, unknown>;
  if (Object.keys(runMetadata).length > 0) {
    metadata.runMetadata = runMetadata;
  }

  return metadata;
}

function buildAssistantMetadata(candidate: BackfillCandidate): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    source: DEFAULT_BACKFILL_SOURCE,
    backfillVersion: BACKFILL_VERSION,
    runId: candidate.run.id,
    chatId: candidate.run.chatId ?? null,
    projectId: candidate.run.projectId,
    personaId: candidate.run.personaId ?? null,
    runStatus: candidate.run.status,
    runCreatedAt: candidate.run.createdAt ?? null,
    runCompletedAt: candidate.run.completedAt ?? null,
    type: 'run_summary',
    ideaCount: candidate.videos.length,
  };

  if (candidate.videos.length > 0) {
    metadata.videoIds = candidate.videos.map((video) => video.id);
  }

  const runMetadata = (candidate.run.metadata ?? {}) as Record<string, unknown>;
  if (Object.keys(runMetadata).length > 0) {
    metadata.runMetadata = runMetadata;
  }

  return metadata;
}

function selectTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function syncTurnTimestamps(
  db: ReturnType<typeof createDb>,
  turnId: string,
  chunkId: string,
  timestamp: string,
): Promise<void> {
  await db.execute(
    sql`
      UPDATE conversation_turns
      SET created_at = ${timestamp}::timestamptz, updated_at = ${timestamp}::timestamptz
      WHERE id = ${turnId}::uuid
    `,
  );

  await db.execute(
    sql`
      UPDATE prompt_embeddings
      SET
        metadata = metadata
          || jsonb_build_object(
            'created_at', ${timestamp}::text,
            'updated_at', ${timestamp}::text
          ),
        created_at = ${timestamp}::timestamptz,
        updated_at = ${timestamp}::timestamptz
      WHERE chunk_id = ${chunkId}
    `,
  );
}

main().catch((error) => {
  console.error('Backfill failed', error);
  void closeOperationsPool().finally(() => {
    void closePool().finally(() => {
      process.exit(1);
    });
  });
});
