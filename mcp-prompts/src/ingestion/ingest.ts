import path from 'node:path';
import { walkPromptFiles, type PromptFileMetadata } from './walker';
import { selectDelta } from './deltaSelector';
import { processPrompt, type ProcessPromptOptions } from './fileProcessor';
import { PromptEmbeddingsRepository } from '../db/repository';

interface IngestCallbacks {
  onStart?(info: { total: number; skipped: number; removed: number }): void;
  onProgress?(info: {
    current: number;
    total: number;
    file: PromptFileMetadata;
    status: 'success' | 'error';
    error?: unknown;
  }): void;
}

export interface IngestOptions extends ProcessPromptOptions, Partial<IngestCallbacks> {
  promptsDir?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface IngestResult {
  processed: Array<{ file: PromptFileMetadata; chunks: number; embeddings: number }>;
  skipped: PromptFileMetadata[];
  removed: Array<{ filePath: string; removed: number }>;
}

export async function ingestPrompts(options: IngestOptions = {}): Promise<IngestResult> {
  const promptsDir = options.promptsDir
    ? path.resolve(options.promptsDir)
    : path.resolve(process.cwd(), '../prompts');

  const files = await walkPromptFiles({ promptsDir });
  const delta = await selectDelta(files);
  const toProcess = options.force ? files : delta.toIngest;
  const unchanged = options.force ? [] : delta.unchanged;
  const removedTargets = options.force ? [] : delta.removed;

  options.onStart?.({
    total: toProcess.length,
    skipped: unchanged.length,
    removed: removedTargets.length,
  });
  const repository = new PromptEmbeddingsRepository();

  const processed: Array<{ file: PromptFileMetadata; chunks: number; embeddings: number }> = [];
  const removed: Array<{ filePath: string; removed: number }> = [];

  if (!options.dryRun && removedTargets.length) {
    for (const filePath of removedTargets) {
      const count = await repository.removeEmbeddingsByFilePath(filePath);
      removed.push({ filePath, removed: count });
      console.info(`Removed ${count} embeddings for ${filePath}`);
    }
  }

  let progressIndex = 0;
  const totalToProcess = toProcess.length;

  for (const file of toProcess) {
    try {
      const result = await processPrompt(file, options);
      processed.push({
        file: result.file,
        chunks: result.chunks.length,
        embeddings: result.embeddingsSaved,
      });

      if (options.dryRun) {
        console.info(`Dry run: ${file.relativePath} | chunks=${result.chunks.length}`);
      } else {
        console.info(
          `Ingested ${file.relativePath} | chunks=${result.chunks.length} | embeddings=${result.embeddingsSaved}`,
        );
      }

      progressIndex += 1;
      options.onProgress?.({
        current: progressIndex,
        total: totalToProcess,
        file,
        status: 'success',
      });
    } catch (error) {
      console.error(`Failed to ingest ${file.relativePath}`, error);

      progressIndex += 1;
      options.onProgress?.({
        current: progressIndex,
        total: totalToProcess,
        file,
        status: 'error',
        error,
      });
    }
  }

  return {
    processed,
    skipped: unchanged,
    removed,
  };
}
