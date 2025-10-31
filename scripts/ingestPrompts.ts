import 'dotenv/config';
import path from 'node:path';
import { ingestPrompts } from '../src/ingestion/ingest';

interface CliOptions {
  directory?: string;
  dryRun: boolean;
  keepMissing: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let directory: string | undefined;
  let dryRun = false;
  let keepMissing = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--keep-missing') {
      keepMissing = true;
    } else if (arg.startsWith('--dir=')) {
      directory = arg.slice('--dir='.length);
    }
  }

  return {
    directory,
    dryRun,
    keepMissing,
  };
}

async function main(): Promise<void> {
  const options = parseArgs();
  const result = await ingestPrompts({
    directory: options.directory,
    dryRun: options.dryRun,
    removeMissing: !options.keepMissing,
  });

  if (result.processed.length === 0) {
    console.info('No prompts were ingested.');
    return;
  }

  console.info(
    `Processed ${result.processed.length} prompt(s)${options.dryRun ? ' (dry run)' : ''}.`,
  );

  for (const entry of result.processed) {
    console.info(`- ${entry.promptKey} | chunks=${entry.chunks}`);
  }

  if (result.removed.length > 0) {
    console.info(
      `Removed ${result.removed.length} prompt(s) no longer present: ${result.removed.join(', ')}`,
    );
  }
}

main().catch((error) => {
  console.error('Prompt ingestion failed', error);
  process.exitCode = 1;
});
