// Prepare the dev server by clearing occupied ports and stale tsx IPC sockets.
import { execSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function log(message: string): void {
  console.log(`[dev:prep] ${message}`);
}

function sleep(milliseconds: number): void {
  if (milliseconds <= 0) {
    return;
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function killProcessesOnPort(port: number): void {
  if (!Number.isFinite(port)) {
    log(`skipping port cleanup; invalid port "${port}"`);
    return;
  }

  try {
    const result = execSync(`lsof -ti tcp:${port}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();

    if (!result) {
      log(`no existing process found on port ${port}`);
      return;
    }

    const pids = Array.from(new Set(result.split('\n').map((value) => value.trim()).filter(Boolean)));

    for (const pidString of pids) {
      const pid = Number.parseInt(pidString, 10);
      if (!Number.isInteger(pid) || pid === process.pid) {
        continue;
      }

      try {
        process.kill(pid, 'SIGTERM');
        log(`sent SIGTERM to process ${pid} (port ${port})`);
      } catch (error) {
        log(`failed to terminate process ${pid}: ${(error as Error).message}`);
      }
    }

    let attempts = 0;
    while (attempts < 5) {
      attempts += 1;
      sleep(100);
      try {
        const check = execSync(`lsof -ti tcp:${port}`, {
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .toString()
          .trim();

        if (!check) {
          log(`port ${port} is now free`);
          return;
        }
      } catch (error) {
        if ((error as { status?: number }).status === 1) {
          log(`port ${port} is now free`);
          return;
        }
      }
    }

    for (const pidString of pids) {
      const pid = Number.parseInt(pidString, 10);
      if (!Number.isInteger(pid) || pid === process.pid) {
        continue;
      }

      try {
        process.kill(pid, 'SIGKILL');
        log(`sent SIGKILL to stubborn process ${pid} (port ${port})`);
      } catch (error) {
        log(`failed to forcefully terminate process ${pid}: ${(error as Error).message}`);
      }
    }

    try {
      const check = execSync(`lsof -ti tcp:${port}`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();

      if (!check) {
        log(`port ${port} is now free`);
        return;
      }

      log(`unable to free port ${port}; still held by processes: ${check}`);
      process.exit(1);
    } catch (error) {
      if ((error as { status?: number }).status === 1) {
        log(`port ${port} is now free`);
        return;
      }

      log(`unexpected error while verifying port ${port}: ${(error as Error).message}`);
      process.exit(1);
    }
  } catch (error) {
    if ((error as { status?: number }).status === 1) {
      log(`no existing process found on port ${port}`);
      return;
    }

    log(`error checking port ${port}: ${(error as Error).message}`);
  }
}

function cleanupStaleTsxSockets(): void {
  const tempDirectory = tmpdir();

  try {
    const rootEntries = readdirSync(tempDirectory, { withFileTypes: true });

    for (const entry of rootEntries) {
      if (!entry.name.startsWith('tsx-')) {
        continue;
      }

      const entryPath = join(tempDirectory, entry.name);

      if (entry.isDirectory()) {
        const childEntries = readdirSync(entryPath, { withFileTypes: true });

        for (const child of childEntries) {
          if (!child.name.endsWith('.pipe')) {
            continue;
          }

          const pipePath = join(entryPath, child.name);

          try {
            rmSync(pipePath, { force: true });
            log(`removed stale tsx pipe ${pipePath}`);
          } catch (error) {
            log(`failed to remove ${pipePath}: ${(error as Error).message}`);
          }
        }

        try {
          if (readdirSync(entryPath).length === 0) {
            rmSync(entryPath, { force: true });
          }
        } catch (error) {
          log(`failed to clean directory ${entryPath}: ${(error as Error).message}`);
        }
      } else if (entry.name.endsWith('.pipe')) {
        try {
          rmSync(entryPath, { force: true });
          log(`removed stale tsx pipe ${entryPath}`);
        } catch (error) {
          log(`failed to remove ${entryPath}: ${(error as Error).message}`);
        }
      }
    }
  } catch (error) {
    log(`skipped tsx socket cleanup: ${(error as Error).message}`);
  }
}

function main(): void {
  const port = Number.parseInt(process.env.SERVER_PORT ?? '3456', 10);

  killProcessesOnPort(port);
  cleanupStaleTsxSockets();
}

main();
