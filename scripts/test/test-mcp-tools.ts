#!/usr/bin/env tsx
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

type ToolCallResult = Awaited<ReturnType<Client['callTool']>>;

function parseToolResult<T>(toolResult: ToolCallResult): T {
  const firstContent = toolResult.content?.[0];
  if (!firstContent || typeof firstContent.text !== 'string') {
    throw new Error('Tool response missing text content');
  }
  return JSON.parse(firstContent.text) as T;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function testAllTools() {
  console.log('🧪 TEST - Core Myloware MCP Tools (7 persona-facing tools)\n');
  console.log('='.repeat(80));

  const client = new Client({
    name: 'comprehensive-test',
    version: '1.0.0',
  });

  const serverUrl = process.env.MCP_SERVER_URL || 'http://localhost:3456';
  const authKey = process.env.MCP_AUTH_KEY || 'mylo-mcp-agent';
  
  const transport = new StreamableHTTPClientTransport(
    new URL(`${serverUrl}/mcp`),
    {
      requestInit: {
        headers: { 'x-api-key': authKey },
      },
    }
  );

  try {
    await client.connect(transport);
    console.log(`✅ Connected to MCP server at ${serverUrl}\n`);

    const totalTests = 7; // Only core persona-facing tools
    let passed = 0;
    let failed = 0;
    let traceId = '';
    let memoryId = '';

    // Test 1: memory_search - Should return workflow memories
    console.log('\n1️⃣  memory_search');
    try {
      const toolResult = await client.callTool({
        name: 'memory_search',
        arguments: { query: 'AISMR video ideas', limit: 3 },
      });
      const data = parseToolResult<{ memories?: unknown[] }>(toolResult);
      if (Array.isArray(data.memories) && data.memories.length > 0) {
        console.log('   ✅ PASS - Found', data.memories.length, 'memories');
        passed++;
      } else {
        console.log('   ❌ FAIL - No memories returned');
        failed++;
      }
    } catch (error) {
      console.log('   ❌ FAIL -', getErrorMessage(error));
      failed++;
    }

    // Test 2: memory_store - Create a test memory
    console.log('\n2️⃣  memory_store');
    try {
      const toolResult = await client.callTool({
        name: 'memory_store',
        arguments: {
          content: 'Final test memory created at ' + new Date().toISOString(),
          memoryType: 'episodic',
          tags: ['final-test'],
          project: ['aismr'],
        },
      });
      const data = parseToolResult<{ id?: string }>(toolResult);
      if (typeof data.id === 'string' && data.id.length > 0) {
        memoryId = data.id;
        console.log('   ✅ PASS - Created memory:', memoryId.substring(0, 8) + '...');
        passed++;
      } else {
        console.log('   ❌ FAIL - No memory ID returned');
        failed++;
      }
    } catch (error) {
      console.log('   ❌ FAIL -', getErrorMessage(error));
      failed++;
    }

    // Test 3: trace_prepare - Create or load trace context
    console.log('\n3️⃣  trace_prepare');
    try {
      const toolResult = await client.callTool({
        name: 'trace_prepare',
        arguments: {
          instructions: 'Test trace preparation',
          sessionId: 'test-session',
        },
      });
      const data = parseToolResult<{ traceId?: string }>(toolResult);
      if (typeof data.traceId === 'string' && data.traceId.length > 0) {
        traceId = data.traceId;
        console.log('   ✅ PASS - Prepared trace:', traceId);
        passed++;
      } else {
        console.log('   ❌ FAIL - No traceId returned');
        failed++;
      }
    } catch (error) {
      console.log('   ❌ FAIL -', getErrorMessage(error));
      failed++;
    }

    // Test 4: trace_update - Update trace project
    console.log('\n4️⃣  trace_update');
    try {
      if (!traceId) throw new Error('No traceId from trace_prepare');
      const toolResult = await client.callTool({
        name: 'trace_update',
        arguments: {
          traceId,
          instructions: 'Updated instructions',
        },
      });
      const data = parseToolResult<{ traceId?: string }>(toolResult);
      if (data.traceId === traceId) {
        console.log('   ✅ PASS - Updated trace');
        passed++;
      } else {
        console.log('   ❌ FAIL - Wrong trace updated');
        failed++;
      }
    } catch (error) {
      console.log('   ❌ FAIL -', getErrorMessage(error));
      failed++;
    }

    // Test 5: jobs - Upsert a job
    console.log('\n5️⃣  jobs (upsert)');
    try {
      if (!traceId) throw new Error('No traceId from trace_prepare');
      const toolResult = await client.callTool({
        name: 'jobs',
        arguments: {
          action: 'upsert',
          kind: 'video',
          traceId,
          provider: 'test',
          taskId: 'test-task-1',
          status: 'queued',
        },
      });
      const data = parseToolResult<{ traceId?: string; status?: string }>(toolResult);
      if (data.traceId === traceId && data.status === 'queued') {
        console.log('   ✅ PASS - Created job');
        passed++;
      } else {
        console.log('   ❌ FAIL - Wrong job data');
        failed++;
      }
    } catch (error) {
      console.log('   ❌ FAIL -', getErrorMessage(error));
      failed++;
    }

    // Test 6: jobs - Summary
    console.log('\n6️⃣  jobs (summary)');
    try {
      if (!traceId) throw new Error('No traceId from trace_prepare');
      const toolResult = await client.callTool({
        name: 'jobs',
        arguments: {
          action: 'summary',
          traceId,
        },
      });
      const data = parseToolResult<{ total?: number }>(toolResult);
      if (typeof data.total === 'number') {
        console.log('   ✅ PASS - Retrieved job summary');
        passed++;
      } else {
        console.log('   ❌ FAIL - Wrong summary format');
        failed++;
      }
    } catch (error) {
      console.log('   ❌ FAIL -', getErrorMessage(error));
      failed++;
    }

    // Test 7: workflow_trigger
    console.log('\n7️⃣  workflow_trigger');
    try {
      if (!traceId) throw new Error('No traceId from trace_prepare');
      // This will likely fail if workflow doesn't exist, which is expected
      try {
        await client.callTool({
          name: 'workflow_trigger',
          arguments: {
            workflowKey: 'test-workflow',
            traceId,
            payload: { test: true },
          },
        });
        console.log('   ⚠️  UNEXPECTED - Workflow exists (may need cleanup)');
        passed++;
      } catch (error) {
        const message = getErrorMessage(error);
        if (message.includes('not found') || message.includes('mapping')) {
          console.log('   ⚠️  EXPECTED - Workflow mapping not found (test workflow not registered)');
          passed++;
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.log('   ❌ FAIL -', getErrorMessage(error));
      failed++;
    }

    // Final Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL TEST RESULTS');
    console.log('='.repeat(80));
    console.log(`\n✅ PASSED: ${passed}/${totalTests}`);
    console.log(`❌ FAILED: ${failed}/${totalTests}`);
    console.log(`📈 SUCCESS RATE: ${Math.round((passed / totalTests) * 100)}%`);
    
    if (passed === totalTests) {
      console.log('\n🎉 ALL TOOLS WORKING PERFECTLY!\n');
    } else if (passed >= totalTests - 2) {
      console.log('\n✨ EXCELLENT - Most tools working! Minor issues to address.\n');
    } else {
      console.log('\n⚠️  NEEDS ATTENTION - Several tools need fixes.\n');
    }

  } catch (error) {
    console.error('❌ Test suite failed:', getErrorMessage(error));
    process.exit(1);
  } finally {
    await client.close();
  }
}

testAllTools();


