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

interface WorkflowResult {
  success: boolean;
  executionId?: string;
  duration: number;
  trace: {
    traceId: string;
    status: string;
    currentOwner: string;
    workflowStep: number;
    projectId: string;
    instructions: string;
    memories: Array<{
      content: string;
      persona: string[];
      memoryType: string;
      createdAt: string;
    }>;
  };
  error?: string;
}

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
  
  let result;
  try {
    result = JSON.parse(responseText);
  } catch (e) {
    log(`   Warning: Response is not JSON, treating as text`, 'yellow');
    // Try to extract traceId from text
    const match = responseText.match(/trace-[\w-]+/);
    if (match) {
      log(`   Extracted trace ID from text: ${match[0]}`, 'cyan');
      return match[0];
    }
    return `session:${sessionId}`;
  }

  // Try to find traceId in the response
  const traceId = result.traceId || result.trace?.traceId || result.data?.traceId;
  
  if (!traceId) {
    log(`   Response structure: ${JSON.stringify(result, null, 2).substring(0, 500)}...`, 'yellow');
    // Try to extract from any nested structure
    const extracted = extractTraceId(result);
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

function extractTraceId(obj: any, depth = 0): string | null {
  if (depth > 5) return null;
  if (typeof obj === 'string' && obj.startsWith('trace-')) return obj;
  if (typeof obj !== 'object' || obj === null) return null;
  
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase().includes('trace')) {
      const val = obj[key];
      if (typeof val === 'string' && val.startsWith('trace-')) {
        return val;
      }
    }
    const result = extractTraceId(obj[key], depth + 1);
    if (result) return result;
  }
  return null;
}

async function pollForCompletion(traceId: string, timeout: number = 120000): Promise<string> {
  const startTime = Date.now();
  const pollInterval = 3000; // 3 seconds
  let attempts = 0;
  let lastError: string | null = null;
  
  log('⏳ Waiting for workflow to complete...', 'yellow');
  log(`   Timeout: ${Math.round(timeout / 1000)}s | Poll interval: ${pollInterval / 1000}s\n`);
  
  while (Date.now() - startTime < timeout) {
    attempts++;
    
    try {
      const trace = await getTraceData(traceId);
      
      // Check if workflow completed
      if (trace.status === 'completed') {
        const duration = Math.round((Date.now() - startTime) / 1000);
        log(`\n✅ Workflow completed in ${duration}s (${attempts} checks)\n`, 'green');
        return trace.traceId;
      }
      
      // Check if workflow failed
      if (trace.status === 'failed') {
        const duration = Math.round((Date.now() - startTime) / 1000);
        log(`\n❌ Workflow failed after ${duration}s (${attempts} checks)\n`, 'red');
        log(`   Error details will be shown below...\n`, 'yellow');
        return trace.traceId; // Return it anyway so we can display the failure details
      }
      
      // Still active or pending - show progress
      if (attempts === 1) {
        log(`   Found trace: ${trace.traceId}`, 'cyan');
        log(`   Status: ${trace.status} | Owner: ${trace.currentOwner} | Step: ${trace.workflowStep}\n`);
      }
      
      process.stdout.write('.');
      lastError = null; // Clear error if we got a trace
      
    } catch (error) {
      // Trace might not exist yet, keep polling
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Only log if this is a new error
      if (errorMsg !== lastError) {
        if (attempts > 1) {
          log(`\n   Still waiting... (${errorMsg})`, 'yellow');
        }
        lastError = errorMsg;
      }
      
      process.stdout.write('.');
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // Timeout reached
  log(`\n\n⏱️  Timeout reached after ${Math.round(timeout / 1000)}s`, 'red');
  log(`   Total attempts: ${attempts}`, 'yellow');
  log(`   Last error: ${lastError || 'No trace found'}\n`, 'yellow');
  
  throw new Error(`Timeout waiting for workflow (${timeout / 1000}s, ${attempts} attempts)`);
}

async function getTraceData(traceIdOrSession: string): Promise<any> {
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
    
    const searchResult = await searchResponse.json();
    const memories = searchResult.result?.content?.[0]?.text 
      ? JSON.parse(searchResult.result.content[0].text).memories 
      : [];
    
    // Find the most recent trace
    const recentMemory = memories.find((m: any) => m.metadata?.traceId);
    if (!recentMemory?.metadata?.traceId) {
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

  const result = await response.json();
  
  if (result.error) {
    throw new Error(`MCP error: ${result.error.message}`);
  }

  const traceData = result.result?.content?.[0]?.text 
    ? JSON.parse(result.result.content[0].text)
    : {};

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

  const memoriesResult = await memoriesResponse.json();
  const memories = memoriesResult.result?.content?.[0]?.text 
    ? JSON.parse(memoriesResult.result.content[0].text).memories 
    : [];

  return {
    ...traceData,
    traceId: actualTraceId,
    memories,
  };
}

function displayResults(trace: any) {
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
    trace.memories.forEach((memory: any, index: number) => {
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
    log('⚠️  Unable to load workflow fixtures (tests/e2e/fixtures/workflow-fixtures.json)', 'yellow');
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


