import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with {
  'resolution-mode': 'import',
};
import { registerPromptInfoResource } from './promptInfoResource';
import { registerStatusResource } from './statusResource';

export function registerResources(server: McpServer): void {
  registerPromptInfoResource(server);
  registerStatusResource(server);
}

export { registerPromptInfoResource, registerStatusResource };
