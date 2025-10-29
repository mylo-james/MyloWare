import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';

export interface PromptFileMetadata {
  /** Absolute path to the prompt file */
  absolutePath: string;
  /** Path relative to the prompts directory */
  relativePath: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  modifiedAt: Date;
  /** SHA-256 checksum of the file contents */
  checksum: string;
  /** Raw markdown cached when available */
  rawMarkdown?: string;
}

export interface WalkOptions {
  /**
   * Absolute path to the prompts directory. Defaults to resolving
   * `../prompts` from the project root.
   */
  promptsDir?: string;
}

const DEFAULT_PROMPTS_DIR = path.resolve(process.cwd(), '../prompts');

export async function walkPromptFiles(options: WalkOptions = {}): Promise<PromptFileMetadata[]> {
  const promptsDir = options.promptsDir ?? DEFAULT_PROMPTS_DIR;
  const entries = await readDirectoryRecursive(promptsDir);

  const markdownFiles = entries.filter((entry) => entry.isFile && entry.absolutePath.endsWith('.md'));

  const results: PromptFileMetadata[] = [];

  for (const entry of markdownFiles) {
    const checksum = await computeChecksum(entry.absolutePath);
    results.push({
      absolutePath: entry.absolutePath,
      relativePath: path.relative(promptsDir, entry.absolutePath),
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      checksum,
    });
  }

  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

interface DirectoryEntry {
  absolutePath: string;
  size: number;
  modifiedAt: Date;
  isFile: boolean;
}

async function readDirectoryRecursive(dir: string): Promise<DirectoryEntry[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const entries: DirectoryEntry[] = [];

  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) {
      continue;
    }

    const absolutePath = path.join(dir, dirent.name);

    if (dirent.isDirectory()) {
      const nested = await readDirectoryRecursive(absolutePath);
      entries.push(...nested);
    } else if (dirent.isFile()) {
      const stats = await fs.stat(absolutePath);
      entries.push({
        absolutePath,
        size: stats.size,
        modifiedAt: stats.mtime,
        isFile: true,
      });
    }
  }

  return entries;
}

async function computeChecksum(filePath: string): Promise<string> {
  const file = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(file).digest('hex');
}
