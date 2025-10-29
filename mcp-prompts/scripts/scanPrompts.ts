import 'dotenv/config';
import path from 'node:path';
import { walkPromptFiles } from '../src/ingestion/walker';
import { parsePromptMetadata } from '../src/ingestion/metadata';

async function main(): Promise<void> {
  const promptsDir = path.resolve(process.cwd(), '../prompts');
  const files = await walkPromptFiles({ promptsDir });

  console.log(`Discovered ${files.length} prompt file${files.length === 1 ? '' : 's'} in ${promptsDir}`);

  for (const file of files) {
    const parsed = parsePromptMetadata(file.relativePath);
    console.log(
      `- ${file.relativePath} | type=${parsed.type} | persona=${parsed.persona.join(',') || '∅'} | project=${parsed.project.join(',') || '∅'} | checksum=${file.checksum.slice(0, 8)}`,
    );
  }
}

main().catch((error) => {
  console.error('Failed to scan prompts:', error);
  process.exitCode = 1;
});
