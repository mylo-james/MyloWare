import { createHash } from 'node:crypto';
import type { EmbeddingRecord } from '../db/repository';
import type { MemoryType } from '../db/schema';
import { normaliseSlug } from '../utils/slug';

export interface VideoArchiveRecord {
  videoId: string;
  runId: string;
  concept: string | null;
  userIdea?: string | null;
  vibe?: string | null;
  environment?: string | null;
  screenplayExcerpt?: string | null;
  prompt?: string | null;
  status: string;
  runStatus: string;
  createdAt?: string | null;
  completedAt?: string | null;
  performanceNotes?: string | null;
  averageWatchTimeSeconds?: number | null;
  completionRate?: number | null;
  additionalMetadata?: Record<string, unknown>;
}

export interface VideoMemoryChunk {
  chunkId: string;
  promptKey: string;
  chunkText: string;
  metadata: Record<string, unknown>;
  memoryType: MemoryType;
}

const ARCHIVE_TAGS = ['video', 'aismr', 'archive', 'video_execution'];

export function buildVideoMemoryChunk(record: VideoArchiveRecord): VideoMemoryChunk {
  const concept = sanitizeText(record.concept) ?? sanitizeText(record.userIdea) ?? 'unknown concept';
  const vibe = sanitizeText(record.vibe) ?? 'unspecified vibe';
  const environment = sanitizeText(record.environment) ?? 'unspecified environment';
  const status = sanitizeText(record.status) ?? 'unknown';
  const runStatus = sanitizeText(record.runStatus) ?? 'unknown';
  const screenplayExcerpt = summariseExcerpt(
    record.screenplayExcerpt ?? record.prompt ?? record.performanceNotes ?? '',
  );
  const performanceNotes = summariseExcerpt(record.performanceNotes ?? '');
  const watchTime =
    typeof record.averageWatchTimeSeconds === 'number' && Number.isFinite(record.averageWatchTimeSeconds)
      ? `${record.averageWatchTimeSeconds.toFixed(1)}s`
      : null;
  const completionRate =
    typeof record.completionRate === 'number' && Number.isFinite(record.completionRate)
      ? `${Math.round(record.completionRate * 100)}%`
      : null;

  const summaryLine = `${concept} - ${vibe} - ${screenplayExcerpt || 'No screenplay excerpt recorded.'}`;

  const lines = [
    summaryLine,
    `Video ID: ${record.videoId}`,
    `Run ID: ${record.runId}`,
    `Video Status: ${status}`,
    `Run Status: ${runStatus}`,
    `Environment: ${environment}`,
  ];

  if (performanceNotes) {
    lines.push(`Performance Notes: ${performanceNotes}`);
  }

  if (watchTime || completionRate) {
    lines.push(
      `Performance Metrics: watch_time=${watchTime ?? 'n/a'} | completion_rate=${completionRate ?? 'n/a'}`,
    );
  }

  if (record.createdAt) {
    lines.push(`Created At: ${record.createdAt}`);
  }

  if (record.completedAt) {
    lines.push(`Completed At: ${record.completedAt}`);
  }

  const chunkId = `video_${record.videoId}`;
  const promptKey = chunkId;

  const metadata = buildVideoMetadata({
    concept,
    vibe,
    environment,
    status,
    runStatus,
    videoId: record.videoId,
    runId: record.runId,
    screenplayExcerpt,
    performanceNotes,
    watchTime,
    completionRate,
    createdAt: record.createdAt ?? null,
    completedAt: record.completedAt ?? null,
    additionalMetadata: record.additionalMetadata ?? {},
  });

  return {
    chunkId,
    promptKey,
    chunkText: lines.join('\n'),
    metadata,
    memoryType: 'semantic',
  };
}

export function buildEmbeddingRecord(chunk: VideoMemoryChunk, embedding: number[]): EmbeddingRecord {
  return {
    chunkId: chunk.chunkId,
    promptKey: chunk.promptKey,
    chunkText: chunk.chunkText,
    rawSource: chunk.chunkText,
    granularity: 'document',
    embedding,
    metadata: chunk.metadata,
    checksum: createHash('sha256').update(chunk.chunkText).digest('hex'),
    memoryType: chunk.memoryType,
  };
}

function buildVideoMetadata(details: {
  concept: string;
  vibe: string;
  environment: string;
  status: string;
  runStatus: string;
  videoId: string;
  runId: string;
  screenplayExcerpt: string;
  performanceNotes: string | null;
  watchTime: string | null;
  completionRate: string | null;
  createdAt: string | null;
  completedAt: string | null;
  additionalMetadata: Record<string, unknown>;
}): Record<string, unknown> {
  const conceptSlug = normaliseSlug(details.concept) ?? null;

  const tags = new Set(ARCHIVE_TAGS);
  tags.add('aismr');
  tags.add('video_execution');

  if (conceptSlug) {
    tags.add(`concept-${conceptSlug}`);
  }

  if (details.vibe) {
    const vibeSlug = normaliseSlug(details.vibe);
    if (vibeSlug) {
      tags.add(`vibe-${vibeSlug}`);
    }
  }

  const metadata: Record<string, unknown> = {
    type: 'video_execution',
    project: ['aismr'],
    tags: Array.from(tags),
    concept: details.concept,
    vibe: details.vibe,
    environment: details.environment,
    status: details.status,
    runStatus: details.runStatus,
    videoId: details.videoId,
    runId: details.runId,
    screenplayExcerpt: details.screenplayExcerpt,
    performanceNotes: details.performanceNotes,
    metrics: {
      watchTime: details.watchTime,
      completionRate: details.completionRate,
    },
    timestamps: {
      createdAt: details.createdAt,
      completedAt: details.completedAt,
    },
  };

  if (Object.keys(details.additionalMetadata).length > 0) {
    metadata.additionalMetadata = details.additionalMetadata;
  }

  return metadata;
}

function sanitizeText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }

  return null;
}

function summariseExcerpt(raw: string): string {
  const cleaned = sanitizeText(raw);
  if (!cleaned) {
    return '';
  }

  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}...` : cleaned;
}
