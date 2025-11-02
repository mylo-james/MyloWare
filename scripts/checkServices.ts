#!/usr/bin/env node
import { spawn } from 'node:child_process';
import http from 'node:http';

interface ServiceCheck {
  name: string;
  url: string;
  expectedStatus?: number;
  container?: string;
}

const SERVICES: ServiceCheck[] = [
  {
    name: 'n8n (localhost)',
    url: 'http://localhost:5678',
    expectedStatus: 200,
    container: 'mcp-prompts-n8n-1',
  },
  {
    name: 'MCP Server (localhost)',
    url: 'http://localhost:3456/health',
    expectedStatus: 200,
    container: 'mcp-prompts-server',
  },
  {
    name: 'n8n Postgres',
    url: 'localhost:5433',
    container: 'mcp-prompts-n8n-postgres-1',
  },
  {
    name: 'MCP Postgres',
    url: 'localhost:5432',
    container: 'mcp-prompts-mcp-postgres-1',
  },
];

function checkHttp(url: string, expectedStatus: number = 200): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(url, (res) => {
      resolve(res.statusCode === expectedStatus);
    });

    request.on('error', () => {
      resolve(false);
    });

    request.setTimeout(5000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];

    child.stdout.on('data', (data: Buffer) => {
      chunks.push(data);
    });

    child.stderr.on('data', (data: Buffer) => {
      errors.push(data);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      } else {
        reject(new Error(Buffer.concat(errors).toString('utf8')));
      }
    });

    child.on('error', reject);
  });
}

async function checkContainer(name: string): Promise<'running' | 'stopped' | 'not found'> {
  try {
    const output = await runCommand('docker', ['ps', '-a', '--format', '{{.Names}}:{{.Status}}']);
    const lines = output.split('\n').filter(Boolean);
    
    for (const line of lines) {
      const [containerName, status] = line.split(':');
      if (containerName === name) {
        return status?.toLowerCase().includes('up') ? 'running' : 'stopped';
      }
    }
    
    return 'not found';
  } catch {
    return 'not found';
  }
}

async function checkAllServices(): Promise<void> {
  console.log('🔍 Checking service health...\n');

  const results: Array<{
    service: string;
    containerStatus: string;
    httpStatus: string;
  }> = [];

  for (const service of SERVICES) {
    const containerStatus = service.container
      ? await checkContainer(service.container)
      : 'n/a';

    let httpStatus = 'n/a';
    if (service.url.startsWith('http')) {
      const isHealthy = await checkHttp(service.url, service.expectedStatus);
      httpStatus = isHealthy ? '✅ OK' : '❌ FAIL';
    }

    results.push({
      service: service.name,
      containerStatus,
      httpStatus,
    });
  }

  // Print results
  console.log('Service Health Status:');
  console.log('━'.repeat(80));
  
  const maxServiceLength = Math.max(...results.map((r) => r.service.length));
  
  for (const result of results) {
    const service = result.service.padEnd(maxServiceLength);
    const container = result.containerStatus.padEnd(12);
    console.log(`${service}  Container: ${container}  HTTP: ${result.httpStatus}`);
  }
  
  console.log('━'.repeat(80));

  // Check Docker Compose stacks
  console.log('\n📦 Active Docker Compose Stacks:\n');
  
  try {
    const devStack = await runCommand('docker', [
      'compose',
      '-f',
      'docker-compose.dev.yml',
      'ps',
      '--format',
      'table {{.Name}}\t{{.Status}}',
    ]);
    console.log('Development Stack (docker-compose.dev.yml):');
    console.log(devStack || '  (none running)');
  } catch (error) {
    console.log('Development Stack: No containers running');
  }

  try {
    const prodStack = await runCommand('docker', [
      'compose',
      'ps',
      '--format',
      'table {{.Name}}\t{{.Status}}',
    ]);
    console.log('\nProduction Stack (docker-compose.yml):');
    console.log(prodStack || '  (none running)');
  } catch (error) {
    console.log('\nProduction Stack: No containers running');
  }

  console.log('\n💡 Quick Access:');
  console.log('  n8n:        http://localhost:5678');
  console.log('  n8n (web):  https://n8n.mjames.dev');
  console.log('  MCP Health: http://localhost:3456/health');
  console.log('  MCP (web):  https://mcp-vector.mjames.dev');
}

checkAllServices().catch((error) => {
  console.error('Error checking services:', error);
  process.exitCode = 1;
});

