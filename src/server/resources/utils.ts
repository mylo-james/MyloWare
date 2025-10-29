import path from 'node:path';
import { promises as fs } from 'node:fs';

export interface DirectoryUsage {
  exists: boolean;
  totalBytes: number;
  fileCount: number;
  directoryCount: number;
}

export async function getDirectoryUsage(directory: string): Promise<DirectoryUsage> {
  const resolved = path.resolve(directory);

  const stats: DirectoryUsage = {
    exists: false,
    totalBytes: 0,
    fileCount: 0,
    directoryCount: 0,
  };

  try {
    const rootStat = await fs.stat(resolved);
    if (!rootStat.isDirectory()) {
      return stats;
    }

    stats.exists = true;
    stats.directoryCount = 1; // count root directory
    const stack: string[] = [resolved];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }

        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stats.directoryCount += 1;
          stack.push(entryPath);
        } else if (entry.isFile()) {
          const fileStat = await fs.stat(entryPath);
          stats.fileCount += 1;
          stats.totalBytes += fileStat.size;
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return stats;
    }

    throw error;
  }

  return stats;
}

export function buildJsonResourceResponse<T>(uri: URL, payload: T) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}
