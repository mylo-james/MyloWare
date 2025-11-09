#!/usr/bin/env tsx
/**
 * Interactive Workflow Test Runner
 * 
 * Run a single workflow and display the results for manual evaluation.
 * 
 * Usage:
 *   npm run workflow:test "your message here"
 *   
 *   # Or directly:
 *   tsx scripts/run-workflow-test.ts "Create AISMR video about rain"
 */

import { readFileSync } from 'fs';
import { config } from '../../src/config/index.js';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

type TraceMemory = {
  persona: string[];
  memoryType: string;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

type TraceData = {
  traceId: string;
  status?: string;
  currentOwner?: string;
  workflowStep?: number;
  projectId?: string | null;
  instructions?: string | null;
  createdAt?: string;
  completedAt?: string;
  memories: TraceMemory[];
  [key: string]: unknown;
};

function log(message: string, color?: keyof typeof colors) {
  const colorCode = color ? colors[color] : '';
  console.log(`${colorCode}${message}${colors.reset}`);
}

async function invokeWorkflow(message: string, sessionId: string = 'test-manual'): Promise<string> {
  // Use env var directly (can be overridden at runtime)
  const webhookUrl = `${process.env.N8N_WEBHOOK_URL || config.n8n.webhookUrl}/webhook/myloware/ingest`;
  
  log('\n📤 Invoking workflow...', 'blue');
  log(`   URL: ${webhookUrl}`);
  log(`   Message: "${message}"`);
  log(`   Session: ${sessionId}`);
  log(`   Mode: Wait for completion (responseMode: lastNode)\n`, 'cyan');

  log('⏳ Waiting for workflow to complete...', 'yellow');
  log('   (Webhook will return when workflow finishes)\n');

  const startTime = Date.now();
  
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'manual-test',
      sessionId,
      message,
    }),
  });

  const duration = Math.round((Date.now() - startTime) / 1000);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Webhook failed: ${response.status} ${response.statusText}\n${errorText}`);
  }

  const responseText = await response.text();
  log(`\n✅ Workflow completed in ${duration}s\n`, 'green');
  log(`   Response preview: ${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}\n`, 'cyan');
  
  let result: unknown;
  try {
    result = JSON.parse(responseText);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`   Warning: Response is not JSON, treating as text (${errorMessage})`, 'yellow');
    // Try to extract traceId from text
    const match = responseText.match(/trace-[\w-]+/);
    if (match) {
      log(`   Extracted trace ID from text: ${match[0]}`, 'cyan');
      return match[0];
    }
    return `session:${sessionId}`;
  }

  // Try to find traceId in the response
  const parsedResult = result as Record<string, unknown>;
  const traceId =
    (parsedResult.traceId as string | undefined) ||
    ((parsedResult.trace as Record<string, unknown> | undefined)?.traceId as string | undefined) ||
    ((parsedResult.data as Record<string, unknown> | undefined)?.traceId as string | undefined);
  
  if (!traceId) {
    log(`   Response structure: ${JSON.stringify(result, null, 2).substring(0, 500)}...`, 'yellow');
    // Try to extract from any nested structure
    const extracted = extractTraceId(parsedResult);
    if (extracted) {
      log(`   Extracted trace ID: ${extracted}`, 'cyan');
      return extracted;
    }
    
    // Last resort: search by session
    log(`   No traceId in response, will search by session...`, 'yellow');
    return `session:${sessionId}`;
  }

  log(`   Trace ID: ${traceId}\n`, 'cyan');
  return traceId;
}

function extractTraceId(obj: unknown, depth = 0): string | null {
  if (depth > 5) return null;
  if (typeof obj === 'string' && obj.startsWith('trace-')) return obj;
  if (typeof obj !== 'object' || obj === null) return null;

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key.toLowerCase().includes('trace') && typeof value === 'string' && value.startsWith('trace-')) {
      return value;
    }
    const nested = extractTraceId(value, depth + 1);
    if (nested) {
      return nested;
    }
  }
  return null;
}

async function getTraceData(traceIdOrSession: string): Promise<TraceData> {
  const mcpUrl = 'http://localhost:3456'; // MCP server always localhost
  let actualTraceId = traceIdOrSession;
  
  // If it's a session reference, we need to search for recent traces
  if (traceIdOrSession.startsWith('session:')) {
    const sessionId = traceIdOrSession.replace('session:', '');
    
    // Search for memories with this session
    const searchResponse = await fetch(`${mcpUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.mcp.authKey,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'memory_search',
          arguments: {
            query: sessionId,
            limit: 10,
            memoryTypes: ['episodic'],
          },
        },
      }),
    });
    
    const searchResult = (await searchResponse.json()) as Record<string, unknown>;
    const searchContent = (searchResult.result as Record<string, unknown> | undefined)?.content;
    let memories: TraceMemory[] = [];

    if (Array.isArray(searchContent)) {
      const firstItem = searchContent[0] as Record<string, unknown> | undefined;
      const text = firstItem?.text;
      if (typeof text === 'string') {
        const parsed = JSON.parse(text) as { memories?: TraceMemory[] };
        if (Array.isArray(parsed.memories)) {
          memories = parsed.memories;
        }
      }
    }

    // Find the most recent trace
    const recentMemory = memories.find((memory) => memory.metadata?.traceId);
    if (!recentMemory?.metadata?.traceId || typeof recentMemory.metadata.traceId !== 'string') {
      throw new Error('No trace found yet for this session');
    }
    
    actualTraceId = recentMemory.metadata.traceId;
  }
  
  const response = await fetch(`${mcpUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.mcp.authKey,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'trace_prepare',
        arguments: { traceId: actualTraceId },
      },
    }),
  });

  const result = (await response.json()) as {
    error?: { message: string };
    result?: { content?: Array<{ text?: string }> };
  };
  
  if (result.error) {
    throw new Error(`MCP error: ${result.error.message}`);
  }

  let traceData: Record<string, unknown> = {};
  const traceContent = result.result?.content;
  if (Array.isArray(traceContent)) {
    const firstItem = traceContent[0];
    if (firstItem?.text) {
      traceData = JSON.parse(firstItem.text);
    }
  }

  // Also fetch memories
  const memoriesResponse = await fetch(`${mcpUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.mcp.authKey,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'memory_search',
        arguments: {
          query: `traceId:${actualTraceId}`,
          traceId: actualTraceId,
          limit: 50,
        },
      },
    }),
  });

  const memoriesResult = (await memoriesResponse.json()) as {
    result?: { content?: Array<{ text?: string }> };
  };
  const memoryContent = memoriesResult.result?.content;
  let memories: TraceMemory[] = [];

  if (Array.isArray(memoryContent)) {
    const firstItem = memoryContent[0];
    if (firstItem?.text) {
      const parsed = JSON.parse(firstItem.text) as { memories?: TraceMemory[] };
      if (Array.isArray(parsed.memories)) {
        memories = parsed.memories;
      }
    }
  }

  return {
    ...(traceData as Record<string, unknown>),
    traceId: actualTraceId,
    memories,
  } as TraceData;
}

function displayResults(trace: TraceData) {
  log('═══════════════════════════════════════════════════════════', 'bright');
  log('                    WORKFLOW RESULTS                        ', 'bright');
  log('═══════════════════════════════════════════════════════════\n', 'bright');

  // Trace Info
  log('📋 TRACE INFORMATION', 'cyan');
  log(`   Trace ID:      ${trace.traceId}`);
  log(`   Status:        ${trace.status}`, trace.status === 'completed' ? 'green' : 'red');
  log(`   Current Owner: ${trace.currentOwner}`);
  log(`   Workflow Step: ${trace.workflowStep}`);
  log(`   Project:       ${trace.projectId || 'unknown'}`);
  log(`   Instructions:  ${trace.instructions || 'N/A'}`);
  
  // Show timing
  if (trace.createdAt) {
    log(`   Created:       ${new Date(trace.createdAt).toLocaleString()}`);
  }
  if (trace.completedAt) {
    log(`   Completed:     ${new Date(trace.completedAt).toLocaleString()}`);
    if (trace.createdAt) {
      const duration = Math.round((new Date(trace.completedAt).getTime() - new Date(trace.createdAt).getTime()) / 1000);
      log(`   Duration:      ${duration}s`);
    }
  }
  log('');

  // Memories
  log('💭 MEMORIES (Persona Outputs)', 'cyan');
  if (trace.memories && trace.memories.length > 0) {
    trace.memories.forEach((memory, index) => {
      log(`\n   [${index + 1}] ${memory.persona.join(', ')}`, 'yellow');
      log(`   Type: ${memory.memoryType}`);
      log(`   Created: ${new Date(memory.createdAt).toLocaleString()}`);
      log(`   Content:\n   ${'-'.repeat(60)}`);
      
      // Pretty print content
      const content = memory.content;
      const lines = content.split('\n');
      lines.forEach((line: string) => {
        log(`   ${line}`);
      });
      log(`   ${'-'.repeat(60)}`);
    });
  } else {
    log('   No memories found', 'yellow');
  }

  // Outputs
  if (trace.outputs && Object.keys(trace.outputs).length > 0) {
    log('\n\n📤 OUTPUTS', 'cyan');
    log(JSON.stringify(trace.outputs, null, 2));
  }

  log('\n═══════════════════════════════════════════════════════════\n', 'bright');
}

interface FixtureMap {
  [key: string]: {
    description?: string;
    instructions: string;
  };
}

function loadFixtures(): FixtureMap {
  try {
    const fixturesPath = new URL('../../tests/e2e/fixtures/workflow-fixtures.json', import.meta.url);
    const raw = readFileSync(fixturesPath, 'utf-8');
    return JSON.parse(raw) as FixtureMap;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(
      `⚠️  Unable to load workflow fixtures (tests/e2e/fixtures/workflow-fixtures.json) - ${errorMessage}`,
      'yellow',
    );
    return {};
  }
}

function printFixtureList(fixtures: FixtureMap) {
  const names = Object.keys(fixtures);
  if (names.length === 0) {
    log('No fixtures defined in tests/e2e/fixtures/workflow-fixtures.json', 'yellow');
    return;
  }
  log('\nAvailable fixtures:\n', 'cyan');
  names.forEach(name => {
    const desc = fixtures[name]?.description ?? '';
    log(`  - ${name}${desc ? `: ${desc}` : ''}`);
  });
  log('\nRun with: npm run workflow:test -- --fixture <name>\n', 'cyan');
}

async function main() {
  const args = process.argv.slice(2);
  const fixtures = loadFixtures();

  if (args.includes('--list-fixtures') || args.includes('--list')) {
    printFixtureList(fixtures);
    process.exit(0);
  }

  let message: string | undefined;
  if (args[0] === '--fixture' || args[0] === '-f') {
    const fixtureName = args[1];
    if (!fixtureName) {
      log('❌ Missing fixture name. Use --list-fixtures to see options.', 'red');
      process.exit(1);
    }
    const fixture = fixtures[fixtureName];
    if (!fixture) {
      log(`❌ Unknown fixture "${fixtureName}". Use --list-fixtures to view available options.`, 'red');
      process.exit(1);
    }
    log(`Using fixture "${fixtureName}"${fixture.description ? ` - ${fixture.description}` : ''}\n`, 'cyan');
    message = fixture.instructions;
  } else if (args.length > 0) {
    message = args.join(' ');
  }

  if (!message) {
    log('Usage: tsx scripts/run-workflow-test.ts "your message here"', 'yellow');
    log('   or: tsx scripts/run-workflow-test.ts --fixture <name>', 'yellow');
    log('\nExamples:', 'cyan');
    log('  tsx scripts/run-workflow-test.ts "Create AISMR video about rain sounds"');
    log('  tsx scripts/run-workflow-test.ts --fixture test-video-run\n');
    if (Object.keys(fixtures).length > 0) {
      printFixtureList(fixtures);
    }
    process.exit(1);
  }

  const sessionId = `test-${Date.now()}`;

  try {
    // Step 1: Invoke workflow (this now waits for completion!)
    const traceId = await invokeWorkflow(message, sessionId);

    // Step 2: Fetch and display results
    log('📊 Fetching complete trace data...\n', 'blue');
    const trace = await getTraceData(traceId);
    displayResults(trace);

    log('🎯 Ready for evaluation!', 'green');
    log('\nQuestions to consider:', 'cyan');
    log('  1. Did the workflow complete as expected?');
    log('  2. Are the persona outputs high quality?');
    log('  3. Did each agent pass appropriate context to the next?');
    log('  4. Are memories tagged correctly with personas?');
    log('  5. Is the final output what you expected?\n');

  } catch (error) {
    log(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`, 'red');
    
    // If we have a trace, try to show what we got
    if (error instanceof Error && error.message.includes('Timeout')) {
      log('\n💡 The workflow may still be running. You can check:', 'cyan');
      log('   1. n8n executions: https://crocs93.app.n8n.cloud/workflow', 'cyan');
      log('   2. Local database for traces', 'cyan');
      log('   3. Increase timeout with longer wait time\n', 'cyan');
    }
    
    process.exit(1);
  }
}

main();


