#!/usr/bin/env tsx
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { FetchClientTransport } from '@modelcontextprotocol/sdk/client/fetch.js';

async function testMCPClient() {
  console.log('🧪 Testing MCP Client...\n');

  const client = new Client({
    name: 'test-client',
    version: '1.0.0',
  });

  // Connect via HTTP (server should be running)
  const serverUrl = process.env.MCP_SERVER_URL || 'http://localhost:3000';
  const transport = new FetchClientTransport(new URL(`${serverUrl}/mcp`));

  try {
    await client.connect(transport);
    console.log(`✅ Connected to MCP server at ${serverUrl}\n`);

    // List available tools
    console.log('📋 Listing tools...');
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tools:`);
    tools.tools.forEach((tool) => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
    console.log('');

    // Test memory_search
    console.log('🔍 Testing memory_search...');
    try {
      const searchResult = await client.callTool({
        name: 'memory_search',
        arguments: {
          query: 'generate AISMR ideas',
          project: 'aismr',
          limit: 5,
        },
      });
      console.log('✅ memory_search result:', JSON.stringify(searchResult, null, 2));
    } catch (error) {
      console.error('❌ memory_search failed:', error);
    }
    console.log('');

    // Test workflow_discover
    console.log('🔍 Testing workflow_discover...');
    try {
      const workflows = await client.callTool({
        name: 'workflow_discover',
        arguments: {
          intent: 'generate video ideas',
          project: 'aismr',
        },
      });
      console.log('✅ workflow_discover result:', JSON.stringify(workflows, null, 2));
    } catch (error) {
      console.error('❌ workflow_discover failed:', error);
    }
    console.log('');

    // Test context_get_persona
    console.log('🔍 Testing context_get_persona...');
    try {
      const persona = await client.callTool({
        name: 'context_get_persona',
        arguments: {
          personaName: 'chat',
        },
      });
      console.log('✅ context_get_persona result:', JSON.stringify(persona, null, 2));
    } catch (error) {
      console.error('❌ context_get_persona failed:', error);
    }
    console.log('');

    console.log('✅ All tests completed');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

testMCPClient();

