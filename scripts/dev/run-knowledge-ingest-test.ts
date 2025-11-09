import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { knowledgeIngest } from '../../src/tools/knowledge/ingestTool.js';

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, '../..');
  const args = process.argv.slice(2);

  let fileArg: string | undefined;
  let chunkLimit: number | undefined;
  let minSimilarity: number | undefined;

  for (const arg of args) {
    if (arg.startsWith('--file=')) {
      fileArg = arg.slice('--file='.length);
    } else if (arg.startsWith('--chunks=')) {
      const parsed = Number(arg.slice('--chunks='.length));
      if (!Number.isNaN(parsed)) {
        chunkLimit = parsed;
      }
    } else if (arg.startsWith('--similarity=')) {
      const parsed = Number(arg.slice('--similarity='.length));
      if (!Number.isNaN(parsed)) {
        minSimilarity = parsed;
      }
    } else if (!fileArg) {
      fileArg = arg;
    } else if (chunkLimit === undefined) {
      const parsed = Number(arg);
      if (!Number.isNaN(parsed)) {
        chunkLimit = parsed;
      }
    }
  }

  const resolveDefaultFile = (): string => {
    if (fileArg) {
      return path.resolve(projectRoot, fileArg);
    }

    const kbPreDir = path.resolve(projectRoot, 'data/kb/pre');
    if (existsSync(kbPreDir)) {
      const candidates = readdirSync(kbPreDir)
        .map((entry) => path.join(kbPreDir, entry))
        .filter((entryPath) => {
          try {
            return statSync(entryPath).isFile();
          } catch {
            return false;
          }
        });
      if (candidates.length > 0) {
        return candidates[0];
      }
    }

    return path.resolve(projectRoot, 'knowledge_dump/editor-knowledge.md');
  };

  const knowledgePath = resolveDefaultFile();

  if (!existsSync(knowledgePath)) {
    throw new Error(
      `Knowledge source file not found. Provide a path with --file=… or add files to data/kb/pre.`
    );
  }

  const fullText = readFileSync(knowledgePath, 'utf-8');

  const maxChunks = chunkLimit ?? 2;
  const similarity = minSimilarity ?? 0.97;

  console.log('Running knowledge_ingest TEST on', knowledgePath);
  console.log(`Total characters available: ${fullText.length}`);
  console.log(`Processing up to ${maxChunks} chunk(s) with minSimilarity=${similarity}`);

  const result = await knowledgeIngest({
    text: fullText,
    maxChunks,
    minSimilarity: similarity,
  });

  console.log('\nIngestion result:', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('Error during knowledge_ingest run:', err);
  process.exit(1);
});

