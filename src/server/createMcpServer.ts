import type { McpServer as McpServerType } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { registerPromptGetTool } from './tools/promptGetTool';
import { registerPromptListTool } from './tools/promptListTool';
import { registerPromptSearchTool } from './tools/promptSearchTool';
import { registerConversationMemoryTool } from './tools/conversationMemoryTool';
import { registerConversationStoreTool } from './tools/conversationStoreTool';
import { registerResources } from './resources';

export async function createMcpServer(): Promise<McpServerType> {
  const { McpServer } = (await import(
    '@modelcontextprotocol/sdk/server/mcp.js'
  )) as unknown as typeof import('@modelcontextprotocol/sdk/dist/cjs/server/mcp.js');
  const server = new McpServer({
    name: 'mcp-prompts',
    version: '0.1.0',
  }) as unknown as McpServerType;

  registerPromptGetTool(server);
  registerPromptListTool(server);
  registerPromptSearchTool(server);
  registerConversationMemoryTool(server);
  registerConversationStoreTool(server);
  registerResources(server);

  return server;
}
