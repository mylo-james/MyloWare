import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpTools, generateRequestId } from './tools.js';
import { registerMCPResources } from './resources.js';
import { registerMCPPrompts } from './prompts.js';
import { logger } from '../utils/logger.js';
import { toolCallDuration, toolCallErrors } from '../utils/metrics.js';

/**
 * Register all MCP tools with the server
 */
export function registerMCPTools(server: McpServer): void {
  for (const tool of mcpTools) {
    const toolSpec: any = {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema.shape,
    };
    
    if (tool.outputSchema) {
      toolSpec.outputSchema = tool.outputSchema.shape;
    }
    
    server.registerTool(
      tool.name,
      toolSpec,
      (async (params: unknown) => {
        const requestId = generateRequestId();
        const timer = toolCallDuration.startTimer({ tool_name: tool.name });
        try {
          logger.info({
            msg: 'Tool execution started',
            tool: tool.name,
            requestId,
          });

          const result = await tool.handler(params, requestId);
          timer({ status: result.isError ? 'error' : 'success' });

          logger.info({
            msg: 'Tool execution completed',
            tool: tool.name,
            requestId,
            success: !result.isError,
          });

          return result as any;
        } catch (error) {
          timer({ status: 'error' });
          toolCallErrors.inc({
            tool_name: tool.name,
            error_type: error instanceof Error ? error.constructor.name : 'UnknownError',
          });

          logger.error({
            msg: 'Tool execution failed',
            tool: tool.name,
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : String(error),
                }),
              },
            ],
            isError: true,
          } as any;
        }
      }) as any
    );
  }

  logger.info({
    msg: 'MCP tools registered',
    count: mcpTools.length,
    tools: mcpTools.map((t) => t.name),
  });
}

// Re-export resource and prompt registration functions
export { registerMCPResources } from './resources.js';
export { registerMCPPrompts } from './prompts.js';
