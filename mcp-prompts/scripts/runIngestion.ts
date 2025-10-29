import 'dotenv/config';
import { spawn } from 'node:child_process';
import { SingleBar, Presets } from 'cli-progress';
import { ingestPrompts } from '../src/ingestion/ingest';
import { ensureDatabaseExists } from '../src/db/utils/ensureDatabaseExists';

interface CliOptions {
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): CliOptions {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: args.has('--dry-run'),
    force: args.has('--force'),
  };
}

async function main(): Promise<void> {
  const options = parseArgs();
  const rawArgs = process.argv.slice(2);
  const isChildProcess = process.env.MCP_INGEST_CHILD === '1';

  if (isChildProcess) {
    await ensureDatabaseExists();
    await runIngestion(options);
    return;
  }

  const exitCode = await runInDocker(rawArgs);
  process.exitCode = exitCode;
}

async function runIngestion(options: CliOptions): Promise<void> {
  let progressBar: SingleBar | undefined;
  let totalToProcess = 0;
  const failures: Array<{ filePath: string; error: unknown }> = [];

  const result = await ingestPrompts({
    dryRun: options.dryRun,
    force: options.force,
    onStart: ({ total }) => {
      totalToProcess = total;
      if (totalToProcess > 0) {
        progressBar = new SingleBar(
          {
            clearOnComplete: true,
            hideCursor: true,
            format: 'Ingesting |{bar}| {value}/{total}',
          },
          Presets.shades_classic,
        );
        progressBar.start(totalToProcess, 0);
      }
    },
    onProgress: ({ current, total, status, file, error }) => {
      if (progressBar) {
        progressBar.update(Math.min(current, total));
        if (current >= total) {
          progressBar.stop();
        }
      }

      if (status === 'error') {
        failures.push({ filePath: file.relativePath, error });
      }
    },
  });

  if (progressBar) {
    progressBar.stop();
  }

  const totalEmbeddings = result.processed.reduce((sum, item) => sum + item.embeddings, 0);
  const failureMessage =
    failures.length > 0
      ? ` Failures: ${failures.length} (${failures.map((entry) => entry.filePath).join(', ')}).`
      : '';

  if (options.dryRun) {
    console.info(
      `Dry run complete. Files processed: ${result.processed.length}, unchanged: ${result.skipped.length}, removed: ${result.removed.length}.${failureMessage} No database changes were made.`,
    );
  } else {
    console.info(
      `Ingestion complete. Files processed: ${result.processed.length}, skipped: ${result.skipped.length}, removed: ${result.removed.length}, embeddings upserted: ${totalEmbeddings}.${failureMessage}`,
    );
  }

  if (result.processed.length === 0 && totalToProcess === 0) {
    const suggestion = options.force
      ? 'No files were ingested; the repository already contains up-to-date embeddings.'
      : 'No files required ingestion. Use `--force` to reprocess all prompts.';
    console.info(suggestion);
  }
}

function runInDocker(args: string[]): Promise<number> {
  return (async () => {
    await runCommand('docker', ['compose', '--profile', 'dev', 'up', '-d', 'postgres']);

    const runArgs = [
      'compose',
      '--profile',
      'dev',
      'run',
      '--rm',
      '-e',
      'MCP_INGEST_CHILD=1',
      'server-dev',
      'npm',
      'run',
      'ingest',
    ];

    if (args.length) {
      runArgs.push('--', ...args);
    }

    return runCommand('docker', runArgs);
  })();
}

function runCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(code ?? 0);
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'null'}`));
      }
    });
  });
}

main().catch((error) => {
  console.error('Fatal ingestion error', error);
  process.exitCode = 1;
});
