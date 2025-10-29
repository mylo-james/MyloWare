import type { McpServer as McpServerType } from '@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import { registerSearchPromptsTool } from './tools/searchPromptsTool';
import { registerGetPromptTool } from './tools/getPromptTool';
import { registerListPromptsTool } from './tools/listPromptsTool';
import { registerFilterPromptsTool } from './tools/filterPromptsTool';
import { registerResources } from './resources';

export async function createMcpServer(): Promise<McpServerType> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/dist/cjs/server/mcp.js');
  const server = new McpServer({
    name: 'mcp-prompts',
    version: '0.1.0',
  });

  registerSearchPromptsTool(server);
  registerGetPromptTool(server);
  registerListPromptsTool(server);
  registerFilterPromptsTool(server);
  registerResources(server);

  return server;
}
