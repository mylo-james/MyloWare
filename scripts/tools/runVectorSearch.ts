import 'dotenv/config';
import { PromptEmbeddingsRepository } from '../../src/db/repository';
import type { MemoryType } from '../../src/db/schema';
import { closePool } from '../../src/db/pool';
import { embedTexts } from '../../src/vector/embedTexts';

async function main(): Promise<void> {
  const [, , ...args] = process.argv;
  const query = args[0] ?? 'AISMR creative philosophy';
  const project = args[1] ?? 'aismr';
  const limit = args[2] ? Math.max(1, Number.parseInt(args[2], 10) || 5) : 5;
  const memoryTypeInput = args[3] ?? 'project';
  const memoryTypes = memoryTypeInput
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is MemoryType => isMemoryTypeValue(value));

  const repository = new PromptEmbeddingsRepository();
  const [embedding] = await embedTexts([query]);

  const results = await repository.search({
    embedding,
    project,
    limit,
    minSimilarity: 0.2,
    memoryTypes,
  });

  console.log(`Vector query: "${query}"`);
  console.log(`Project filter: ${project ?? 'none'} | memoryTypes=${memoryTypes.join(', ')}`);
  console.log(`Matches: ${results.length} (limit=${limit})`);

  for (const result of results) {
    const metadata = result.metadata as Record<string, unknown>;
    const tags = Array.isArray(metadata.tags) ? metadata.tags.join(', ') : '—';
    const excerpt = result.chunkText.replace(/\s+/g, ' ').slice(0, 160);
    console.log(
      `- ${result.promptKey} [memoryType=${result.memoryType}] similarity=${result.similarity.toFixed(4)} tags=${tags}`,
    );
    console.log(`  ${excerpt}${excerpt.length === 160 ? '…' : ''}`);
  }

  await closePool();
}

main().catch(async (error) => {
  console.error('Vector search failed', error);
  await closePool();
  process.exitCode = 1;
});

function isMemoryTypeValue(value: string): value is MemoryType {
  return ['persona', 'project', 'semantic', 'episodic', 'procedural'].includes(
    value as MemoryType,
  );
}
