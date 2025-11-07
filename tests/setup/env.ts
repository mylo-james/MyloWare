import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.MCP_AUTH_KEY = process.env.MCP_AUTH_KEY || '00000000-0000-0000-0000-000000000000';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-telegram-token';
process.env.N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://example.com/webhook';

// Let test containers choose a random host port by default. If POSTGRES_PORT came from
// the developer's .env (typically 6543), clear it so drizzle doesn't override our URL.
if (process.env.TEST_DB_USE_CONTAINER === '1') {
  delete process.env.POSTGRES_PORT;
}

const defaultTestDbUrl = 'postgresql://test:test@127.0.0.1:6543/mcp_v2_test';
process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DB_URL || defaultTestDbUrl;
process.env.OPERATIONS_DATABASE_URL =
  process.env.OPERATIONS_DATABASE_URL || process.env.DATABASE_URL;

function configureDockerSocket() {
  if (process.env.DOCKER_HOST) {
    return;
  }

  const SOCKETS: Array<{ hostPath: string; containerPath?: string }> = [
    {
      hostPath: path.join(os.homedir(), '.colima', 'default', 'docker.sock'),
      containerPath: '/var/run/docker.sock',
    },
    {
      hostPath: path.join(os.homedir(), '.docker', 'run', 'docker.sock'),
    },
    { hostPath: '/var/run/docker.sock' },
  ];

  for (const { hostPath, containerPath } of SOCKETS) {
    if (fs.existsSync(hostPath)) {
      process.env.DOCKER_HOST = `unix://${hostPath}`;
      if (!process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE && containerPath) {
        process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE = containerPath;
      }
      if (process.env.LOG_LEVEL === 'debug') {
        console.info(`[tests/setup/env] Using Docker socket at ${hostPath}`);
        if (containerPath) {
          console.info(
            `[tests/setup/env] Exposing socket to containers at ${containerPath}`
          );
        }
      }
      break;
    }
  }
}

configureDockerSocket();
