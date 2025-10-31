#!/usr/bin/env node
import { spawn } from 'node:child_process';

interface ParsedArgs {
  profile: string;
  passThrough: string[];
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let profile = process.env.DOCKER_PROFILE ?? 'dev';
  const passThrough: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;

    if (arg === '--profile') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('Expected value after --profile');
      }
      profile = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--profile=')) {
      profile = arg.split('=')[1] ?? profile;
      continue;
    }

    passThrough.push(arg);
  }

  return { profile, passThrough };
}

function runCommand(command: string, commandArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (signal) {
        const message = `${command} exited due to signal ${signal}`;
        reject(new Error(message));
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      const message = `${command} ${commandArgs.join(' ')} exited with code ${code}`;
      reject(new Error(message));
    });
  });
}

function captureCommand(command: string, commandArgs: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const chunks: Buffer[] = [];

    child.stdout.on('data', (data: Buffer) => {
      chunks.push(data);
    });

    child.on('error', (error) => reject(error));

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${commandArgs.join(' ')} exited with code ${code}`));
        return;
      }

      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

async function ensurePortIsFree(port: string): Promise<void> {
  try {
    const rawOutput = await captureCommand('docker', [
      'ps',
      '-a',
      '--filter',
      `publish=${port}`,
      '--format',
      '{{json .}}',
    ]);

    const lines = rawOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return;
    }

    const containers = lines
      .map((line) => {
        try {
          return JSON.parse(line) as { ID: string; Names: string };
        } catch (error) {
          return null;
        }
      })
      .filter((value): value is { ID: string; Names: string } => Boolean(value));

    if (containers.length === 0) {
      return;
    }

    const ids = containers.map((container) => container.ID);
    const names = containers.map((container) => container.Names).join(', ');

    console.log(`[stack] Releasing port ${port} from containers: ${names}`);
    await runCommand('docker', ['rm', '-f', ...ids]);
  } catch (error) {
    console.warn(`[stack] Unable to verify port usage for ${port}:`, error);
  }
}

async function main(): Promise<void> {
  const { profile, passThrough } = parseArgs();
  const port = process.env.SERVER_PORT ?? '3456';

  console.log(`[stack] Stopping existing containers for profile "${profile}"...`);
  await runCommand('docker', ['compose', '--profile', profile, 'down', '--remove-orphans']);

  console.log(`[stack] Ensuring port ${port} is available...`);
  await ensurePortIsFree(port);

  console.log(`[stack] Starting compose profile "${profile}"...`);
  await runCommand('docker', ['compose', '--profile', profile, 'up', ...passThrough]);
}

main().catch((error) => {
  console.error('[stack] Failed to manage compose stack:', error);
  process.exitCode = 1;
});
