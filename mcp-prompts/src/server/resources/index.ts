import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPromptInfoResource } from './promptInfoResource';
import { registerStatusResource } from './statusResource';

export function registerResources(server: McpServer): void {
  registerPromptInfoResource(server);
  registerStatusResource(server);
}

export { registerPromptInfoResource, registerStatusResource };
