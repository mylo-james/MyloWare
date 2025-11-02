#!/usr/bin/env node
import { spawn } from 'node:child_process';

interface ParsedArgs {
  command: 'up' | 'down' | 'restart' | 'logs' | 'status' | 'clean';
  service?: string;
  follow?: boolean;
  detach?: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const command = (args[0] ?? 'up') as ParsedArgs['command'];
  
  const parsed: ParsedArgs = {
    command,
    follow: args.includes('-f') || args.includes('--follow'),
    detach: args.includes('-d') || args.includes('--detach'),
  };

  // Find service name (non-flag argument after command)
  const serviceIndex = args.findIndex((arg, i) => i > 0 && !arg.startsWith('-'));
  if (serviceIndex !== -1) {
    parsed.service = args[serviceIndex];
  }

  return parsed;
}

function runCommand(command: string, commandArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[dev-stack] Running: ${command} ${commandArgs.join(' ')}`);
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
      cwd: process.cwd(),
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

      const message = `${command} exited with code ${code}`;
      reject(new Error(message));
    });
  });
}

async function checkHealth(): Promise<void> {
  console.log('\n[dev-stack] Health Check\n');
  
  // Check if containers are running
  await runCommand('docker', [
    'compose',
    '-f',
    'docker-compose.dev.yml',
    'ps',
  ]);

  console.log('\n[dev-stack] Testing n8n accessibility...');
  try {
    await runCommand('curl', ['-I', '-s', 'http://localhost:5678']);
    console.log('✅ n8n is accessible on http://localhost:5678');
  } catch {
    console.log('❌ n8n is NOT accessible on http://localhost:5678');
  }
}

async function main(): Promise<void> {
  const { command, service, follow, detach } = parseArgs();
  const composeFile = 'docker-compose.dev.yml';

  switch (command) {
    case 'up': {
      console.log('[dev-stack] Starting development environment...');
      const upArgs = ['compose', '-f', composeFile, 'up'];
      if (detach) {
        upArgs.push('-d');
      }
      if (service) {
        upArgs.push(service);
      }
      await runCommand('docker', upArgs);
      
      if (detach) {
        console.log('\n[dev-stack] Waiting for services to be ready...');
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await checkHealth();
      }
      break;
    }

    case 'down': {
      console.log('[dev-stack] Stopping development environment...');
      await runCommand('docker', ['compose', '-f', composeFile, 'down']);
      console.log('✅ Development environment stopped');
      break;
    }

    case 'restart': {
      console.log('[dev-stack] Restarting development environment...');
      const restartArgs = ['compose', '-f', composeFile, 'restart'];
      if (service) {
        restartArgs.push(service);
      }
      await runCommand('docker', restartArgs);
      
      console.log('\n[dev-stack] Waiting for services to be ready...');
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await checkHealth();
      break;
    }

    case 'logs': {
      const logsArgs = ['compose', '-f', composeFile, 'logs'];
      if (follow) {
        logsArgs.push('-f');
      }
      logsArgs.push('--tail', '50');
      if (service) {
        logsArgs.push(service);
      }
      await runCommand('docker', logsArgs);
      break;
    }

    case 'status': {
      await checkHealth();
      break;
    }

    case 'clean': {
      console.log('[dev-stack] Cleaning up development environment...');
      await runCommand('docker', ['compose', '-f', composeFile, 'down', '-v']);
      console.log('✅ Development environment cleaned (volumes removed)');
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.log('\nUsage:');
      console.log('  npm run dev:up [-d]              - Start dev environment');
      console.log('  npm run dev:down                 - Stop dev environment');
      console.log('  npm run dev:restart [service]    - Restart all or specific service');
      console.log('  npm run dev:logs [-f] [service]  - View logs');
      console.log('  npm run dev:status               - Check health');
      console.log('  npm run dev:clean                - Clean up (remove volumes)');
      process.exitCode = 1;
      return;
    }
  }
}

main().catch((error) => {
  console.error('[dev-stack] Failed:', error);
  process.exitCode = 1;
});

