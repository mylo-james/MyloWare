#!/usr/bin/env tsx
/**
 * Test MCP authentication and tool access
 * Usage: tsx scripts/test-mcp-auth.ts [api-key]
 */

import http from 'node:http';

const API_KEY = process.argv[2] || process.env.MCP_API_KEY || '';
const MCP_URL = process.env.MCP_URL || 'http://localhost:3456';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc?: '2.0';
  id?: number | string;
  result?: {
    tools?: Array<{ name: string; description?: string }>;
  };
  error?: {
    code: string | number;
    message: string;
  };
}

async function testMCPEndpoint(request: MCPRequest): Promise<MCPResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(MCP_URL);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? require('https') : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        Accept: 'application/json',
      },
    };

    const req = httpModule.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ...parsed, _statusCode: res.statusCode });
        } catch {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(request));
    req.end();
  });
}

async function main() {
  console.log('\n🔍 MCP Authentication Test\n');
  console.log(`📍 Server: ${MCP_URL}`);
  console.log(`🔑 API Key: ${API_KEY ? '****' + API_KEY.slice(-4) : '(none)'}\n`);

  // Test 1: Health check (no auth required)
  try {
    console.log('✓ Testing health endpoint...');
    const url = new URL(MCP_URL);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? require('https') : http;

    await new Promise((resolve, reject) => {
      httpModule.get(`${MCP_URL.replace('/mcp', '')}/health`, (res: any) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('  ✅ Server is healthy\n');
            resolve(true);
          } else {
            console.log(`  ❌ Health check failed: ${res.statusCode}\n`);
            reject(new Error(`Health check failed: ${res.statusCode}`));
          }
        });
      });
    });
  } catch (error) {
    console.error('  ❌ Cannot reach server:', error);
    process.exit(1);
  }

  // Test 2: MCP tools/list endpoint
  console.log('✓ Testing MCP tools/list...');
  try {
    const response = await testMCPEndpoint({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });

    if (response.error) {
      console.error('  ❌ Authentication failed:', response.error.message);
      console.error('  Code:', response.error.code);
      console.error('\n💡 Solutions:');
      console.error('  1. Check your .env file has MCP_API_KEY set');
      console.error('  2. Restart the MCP server: npm run dev:down && npm run dev:up');
      console.error('  3. Verify n8n has the same API key configured');
      console.error('  4. Check n8n HTTP Request node headers include: x-api-key');
      process.exit(1);
    }

    if (response.result?.tools) {
      console.log(`  ✅ Authenticated successfully!\n`);
      console.log(`📋 Available Tools (${response.result.tools.length}):\n`);
      response.result.tools.forEach((tool, i) => {
        console.log(`  ${i + 1}. ${tool.name}`);
      });
      console.log('\n✅ All systems operational!');
      console.log('\n💡 n8n Configuration:');
      console.log(`  - MCP URL: ${MCP_URL}`);
      console.log(`  - Header: x-api-key: ${API_KEY ? '****' + API_KEY.slice(-4) : '(required)'}`);
    } else {
      console.error('  ❌ Unexpected response format');
      console.error('  Response:', JSON.stringify(response, null, 2));
      process.exit(1);
    }
  } catch (error) {
    console.error('  ❌ Request failed:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
