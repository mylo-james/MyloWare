import { getChunk, split } from 'llm-splitter';

export type ChunkGranularity = 'document' | 'chunk';

export interface ChunkPromptParams {
  filePath: string;
  checksum: string;
  markdown: string;
  options?: Partial<ChunkOptions>;
}

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
}

export interface PromptChunk {
  id: string;
  index: number;
  granularity: ChunkGranularity;
  text: string;
  raw: string;
  start: number;
  end: number;
  filePath: string;
}

const DEFAULT_OPTIONS: ChunkOptions = {
  chunkSize: 700,
  chunkOverlap: 100,
};

export function chunkPrompt({
  filePath,
  checksum,
  markdown,
  options,
}: ChunkPromptParams): PromptChunk[] {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options } satisfies ChunkOptions;
  const chunks: PromptChunk[] = [];

  // Document level chunk provides a full-text search fallback and checksum anchor.
  chunks.push({
    id: buildChunkId(checksum, 'document', 0),
    index: 0,
    granularity: 'document',
    text: markdown,
    raw: markdown,
    start: 0,
    end: markdown.length,
    filePath,
  });

  const splitOptions = {
    chunkSize: mergedOptions.chunkSize,
    chunkOverlap: mergedOptions.chunkOverlap,
    chunkStrategy: 'paragraph',
    splitter: whitespaceSplitter,
  } satisfies NonNullable<Parameters<typeof split>[1]>;

  const splitChunks = split(markdown, splitOptions);

  let chunkIndex = 0;

  for (const part of splitChunks) {
    const text = normaliseChunkText(getChunk(markdown, part.start, part.end));
    if (!text) {
      continue;
    }

    chunks.push({
      id: buildChunkId(checksum, 'chunk', chunkIndex),
      index: chunkIndex,
      granularity: 'chunk',
      text,
      raw: text,
      start: part.start,
      end: part.end,
      filePath,
    });

    chunkIndex += 1;
  }

  return chunks;
}

function normaliseChunkText(value: string | string[]): string {
  if (Array.isArray(value)) {
    return value.join('');
  }

  return value;
}

function whitespaceSplitter(input: string): string[] {
  // Basic whitespace tokeniser. For semantic embeddings we only need rough token counts.
  return input.split(/(\s+)/).filter((token) => token.length > 0);
}

function buildChunkId(checksum: string, granularity: ChunkGranularity, index: number): string {
  return `${checksum}-${granularity}-${index}`;
}
