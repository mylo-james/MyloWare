import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodRawShape, ZodTypeAny } from 'zod';
import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { mcpTools, generateRequestId } from './tools.js';
// import { registerMCPResources } from './resources.js';
// import { registerMCPPrompts } from './prompts.js';
import { logger } from '../utils/logger.js';
import { toolCallDuration, toolCallErrors } from '../utils/metrics.js';

type JsonSchema = ReturnType<typeof zodToJsonSchema>;

interface ExtendedToolAnnotations extends ToolAnnotations {
  ui?: {
    inputType?: string;
    [key: string]: unknown;
  };
  jsonSchema?: {
    input?: JsonSchema;
    output?: JsonSchema;
  };
}

interface ToolSpecConfig {
  title: string;
  description: string;
  inputSchema?: ZodRawShape;
  outputSchema?: ZodRawShape;
  annotations?: ExtendedToolAnnotations;
}

function buildJsonSchema(schema: ZodTypeAny, name: string): JsonSchema {
  return zodToJsonSchema(schema, {
    name,
    target: 'jsonSchema7',
    $refStrategy: 'none',
  });
}

/**
 * Register all MCP tools with the server
 */
export function registerMCPTools(server: McpServer): void {
  for (const tool of mcpTools) {
    logger.debug({
      msg: 'Preparing tool for registration',
      tool: tool.name,
      hasInputSchema: Boolean(tool.inputSchema),
      hasOutputSchema: Boolean(tool.outputSchema),
    });

    const inputShape = tool.inputSchema
      ? (tool.inputSchema.shape as ZodRawShape)
      : undefined;
    const outputShape = tool.outputSchema
      ? (tool.outputSchema.shape as ZodRawShape)
      : undefined;
    const inputJsonSchema = tool.inputSchema
      ? buildJsonSchema(tool.inputSchema, `${tool.name}Input`)
      : undefined;
    const outputJsonSchema = tool.outputSchema
      ? buildJsonSchema(tool.outputSchema, `${tool.name}Output`)
      : undefined;

    const toolSpec: ToolSpecConfig = {
      title: tool.title,
      description: tool.description,
      inputSchema: inputShape,
    };

    if (tool.outputSchema) {
      toolSpec.outputSchema = outputShape;
    }

    if (inputJsonSchema || outputJsonSchema) {
      const existingAnnotations: ExtendedToolAnnotations =
        toolSpec.annotations || {};
      const existingUi = existingAnnotations.ui || {};

      logger.debug({
        msg: 'Attaching JSON schema annotations',
        tool: tool.name,
        hasInputJsonSchema: Boolean(inputJsonSchema),
        hasOutputJsonSchema: Boolean(outputJsonSchema),
      });

      toolSpec.annotations = {
        ...existingAnnotations,
        ui: {
          ...existingUi,
          inputType: existingUi.inputType || 'json',
        },
        jsonSchema: {
          input: inputJsonSchema,
          output: outputJsonSchema,
        },
      };
    }

    logger.debug({
      msg: 'Registering tool with MCP server',
      tool: tool.name,
      annotationsKeys: Object.keys(toolSpec.annotations ?? {}),
    });

    server.registerTool(tool.name, toolSpec, async (params: unknown) => {
      const requestId = generateRequestId();
      const timer = toolCallDuration.startTimer({ tool_name: tool.name });
      logger.debug({
        msg: 'Tool callback invoked',
        tool: tool.name,
        requestId,
        hasParams: params !== undefined && params !== null,
      });
      try {
        logger.info({
          msg: 'Tool execution started',
          tool: tool.name,
          requestId,
        });

        const result = await tool.handler(params, requestId);
        timer({ status: result.isError ? 'error' : 'success' });

        logger.debug({
          msg: 'Tool handler resolved',
          tool: tool.name,
          requestId,
          isError: Boolean(result.isError),
          hasStructuredContent: Boolean(result.structuredContent),
        });

        logger.info({
          msg: 'Tool execution completed',
          tool: tool.name,
          requestId,
          success: !result.isError,
        });

        const response: CallToolResult = {
          content: result.content,
          structuredContent:
            result.structuredContent as CallToolResult['structuredContent'],
          isError: result.isError,
        };
        return response;
      } catch (error) {
        timer({ status: 'error' });
        toolCallErrors.inc({
          tool_name: tool.name,
          error_type:
            error instanceof Error ? error.constructor.name : 'UnknownError',
        });

        logger.error({
          msg: 'Tool execution failed',
          tool: tool.name,
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });

        const response: CallToolResult = {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
        return response;
      }
    });

    logger.debug({
      msg: 'Tool registration complete',
      tool: tool.name,
    });
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
