import 'dotenv/config';
import { PromptEmbeddingsRepository, type PromptLookupFilters } from '../../src/db/repository';
import { closePool } from '../../src/db/pool';

async function main(): Promise<void> {
  const [, , ...args] = process.argv;
  const query = args[0] ?? 'whisper timing 3.0 seconds';
  const project = args[1] ?? 'aismr';
  const limit = args[2] ? Math.max(1, Number.parseInt(args[2], 10) || 5) : 5;

  const repository = new PromptEmbeddingsRepository();

  const filters: PromptLookupFilters = project ? { project } : {};
  const results = await repository.keywordSearch(query, filters, { limit });

  console.log(`Query: "${query}"`);
  console.log(`Project filter: ${project ?? 'none'}`);
  console.log(`Matches: ${results.length} (limit=${limit})`);

  for (const result of results) {
    const metadata = result.metadata as Record<string, unknown>;
    const tags = Array.isArray(metadata.tags) ? metadata.tags.join(', ') : '—';
    const excerpt = result.chunkText.replace(/\s+/g, ' ').slice(0, 160);
    console.log(
      `- ${result.promptKey} [memoryType=${result.memoryType}] score=${result.similarity.toFixed(4)} tags=${tags}`,
    );
    console.log(`  ${excerpt}${excerpt.length === 160 ? '…' : ''}`);
  }

  await closePool();
}

main().catch(async (error) => {
  console.error('Keyword search failed', error);
  await closePool();
  process.exitCode = 1;
});
