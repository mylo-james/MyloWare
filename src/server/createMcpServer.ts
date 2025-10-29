import type { McpServer as McpServerType } from '@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import { registerPromptGetTool } from './tools/promptGetTool';
import { registerPromptListTool } from './tools/promptListTool';
import { registerPromptSearchTool } from './tools/promptSearchTool';
import { registerResources } from './resources';

export async function createMcpServer(): Promise<McpServerType> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/dist/cjs/server/mcp.js');
  const server = new McpServer({
    name: 'mcp-prompts',
    version: '0.1.0',
  });

  registerPromptGetTool(server);
  registerPromptListTool(server);
  registerPromptSearchTool(server);
  registerResources(server);

  return server;
}
