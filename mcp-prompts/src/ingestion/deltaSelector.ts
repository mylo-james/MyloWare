import { PromptEmbeddingsRepository } from '../db/repository';
import type { PromptFileMetadata } from './walker';

const repository = new PromptEmbeddingsRepository();

export interface DeltaSelectionResult {
  toIngest: PromptFileMetadata[];
  unchanged: PromptFileMetadata[];
  removed: string[];
}

export async function selectDelta(
  files: PromptFileMetadata[],
): Promise<DeltaSelectionResult> {
  const existingFilePaths = await repository.listAllFilePaths();
  const existingSet = new Set(existingFilePaths);

  const toIngest: PromptFileMetadata[] = [];
  const unchanged: PromptFileMetadata[] = [];

  for (const file of files) {
    if (!existingSet.has(file.relativePath)) {
      toIngest.push(file);
      continue;
    }

    const repositoryRecords = await repository.getByFilePath(file.relativePath);
    const repositoryChecksum = repositoryRecords.length ? repositoryRecords[0].checksum : undefined;
    if (repositoryChecksum === file.checksum) {
      unchanged.push(file);
    } else {
      toIngest.push(file);
    }
  }

  const currentSet = new Set(files.map((file) => file.relativePath));
  const removed = existingFilePaths.filter((filePath) => !currentSet.has(filePath));

  return {
    toIngest,
    unchanged,
    removed,
  };
}
