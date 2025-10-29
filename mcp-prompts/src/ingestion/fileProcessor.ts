import { promises as fs } from 'node:fs';
import { chunkPrompt, type ChunkPromptParams, type PromptChunk } from './chunker';
import { embedTexts } from './embedder';
import { parsePromptMetadata } from './metadata';
import type { PromptFileMetadata } from './walker';
import { PromptEmbeddingsRepository, type EmbeddingRecord } from '../db/repository';

export interface ProcessPromptOptions {
  batchSize?: number;
  retries?: number;
  retryDelayMs?: number;
  dryRun?: boolean;
}

export interface ProcessedChunk extends PromptChunk {
  embedding: number[];
}

export interface ProcessPromptResult {
  file: PromptFileMetadata;
  metadata: ReturnType<typeof parsePromptMetadata>;
  chunks: ProcessedChunk[];
  embeddingsSaved: number;
}

const repository = new PromptEmbeddingsRepository();

export async function processPrompt(
  file: PromptFileMetadata,
  options: ProcessPromptOptions = {},
): Promise<ProcessPromptResult> {
  const metadata = parsePromptMetadata(file.relativePath);
  const markdown = file.rawMarkdown ?? (await readFileContents(file.absolutePath));

  const chunkParams: ChunkPromptParams = {
    filePath: file.relativePath,
    checksum: file.checksum,
    markdown,
  };
  const chunks = chunkPrompt(chunkParams);
  const chunkTexts = chunks.map((chunk) => chunk.text);
  const embeddings = await embedTexts(chunkTexts, options);

  const processedChunks: ProcessedChunk[] = chunks.map((chunk, index) => ({
    ...chunk,
    embedding: embeddings[index],
  }));

  const records: EmbeddingRecord[] = processedChunks.map((chunk) => ({
    chunkId: chunk.id,
    filePath: chunk.filePath,
    chunkText: chunk.text,
    rawMarkdown: chunk.raw,
    granularity: chunk.granularity,
    embedding: chunk.embedding,
    metadata: {
      type: metadata.type,
      persona: metadata.persona,
      project: metadata.project,
      filename: metadata.filename,
    },
    checksum: file.checksum,
  }));

  const embeddingsSaved = options.dryRun ? 0 : await repository.upsertEmbeddings(records);

  return {
    file,
    metadata,
    chunks: processedChunks,
    embeddingsSaved,
  };
}

async function readFileContents(path: string): Promise<string> {
  return fs.readFile(path, 'utf-8');
}
