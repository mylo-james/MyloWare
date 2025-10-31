import 'dotenv/config';
import { PromptEmbeddingsRepository } from '../../src/db/repository';
import { closePool } from '../../src/db/pool';

async function main(): Promise<void> {
  const [, , promptKeyArg] = process.argv;
  const promptKey = promptKeyArg ?? 'aismr-specifications';

  const repository = new PromptEmbeddingsRepository();
  const chunks = await repository.getChunksByPromptKey(promptKey);

  if (chunks.length === 0) {
    console.log(`No chunks found for prompt key "${promptKey}".`);
  } else {
    console.log(`Prompt key "${promptKey}" has ${chunks.length} chunk(s).`);
    for (const chunk of chunks) {
      console.log(`- ${chunk.chunkId} granularity=${chunk.granularity} memoryType=${chunk.memoryType}`);
      console.log(`  ${chunk.chunkText.replace(/\s+/g, ' ').slice(0, 160)}${chunk.chunkText.length > 160 ? '…' : ''}`);
    }
  }

  await closePool();
}

main().catch(async (error) => {
  console.error(`Failed to load prompt "${process.argv[2]}"`, error);
  await closePool();
  process.exitCode = 1;
});
