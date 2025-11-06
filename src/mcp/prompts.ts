import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

/**
 * Register all MCP prompts with the server
 */
export function registerMCPPrompts(server: McpServer): void {
  // AISMR video creation workflow prompt
  server.registerPrompt(
    'aismr-video-creation',
    {
      title: 'AISMR Video Creation',
      description: 'Create an AISMR video with full production workflow from idea to upload',
      argsSchema: {
        topic: z.string().describe('Video topic or theme (e.g., "rain sounds", "ocean waves")'),
        style: z.string().optional().describe('Video style/ambiance: rain, ocean, nature, urban, or ambient'),
        duration: z.string().optional().describe('Desired video duration in seconds (as string)'),
      }
    },
    ({ topic, style, duration }) => {
      const durationNum = duration ? parseInt(duration, 10) : undefined;
      return {
        messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create an AISMR video about "${topic}"${style ? ` with ${style} style` : ''}${durationNum ? ` (${durationNum} seconds)` : ''}. 

Follow the complete production workflow:
1. Generate 12 creative ideas for the video
2. Have the user select their favorite
3. Write a detailed screenplay following AISMR guardrails
4. Generate the video content
5. Upload to TikTok

Use the workflow_execute tool with the appropriate workflow ID and input parameters.`
          }
        }
      ]
    };
    }
  );

  // Memory-assisted conversation prompt
  server.registerPrompt(
    'memory-chat',
    {
      title: 'Memory-Assisted Chat',
      description: 'Start a conversation with context from memory search',
      argsSchema: {
        query: z.string().describe('Initial query or topic to discuss'),
        memoryTypes: z.string().optional().describe('Types of memories to search (comma-separated: episodic, semantic, procedural)'),
        project: z.string().optional().describe('Filter memories by project'),
        persona: z.string().optional().describe('Persona to use for the conversation'),
      }
    },
    ({ query, memoryTypes, project, persona }) => {
      const types = memoryTypes ? memoryTypes.split(',').map(t => t.trim()) : [];
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `I'd like to discuss: "${query}"

${persona ? `Please use the ${persona} persona. ` : ''}${project ? `Focus on the ${project} project context. ` : ''}

Before responding, search memories for relevant context using:
- Query: "${query}"
${types.length > 0 ? `- Memory types: ${types.join(', ')}` : ''}
${project ? `- Project: ${project}` : ''}

Use the retrieved memories to provide informed, context-aware responses.`
            }
          }
        ]
      };
    }
  );

  // Workflow discovery prompt
  server.registerPrompt(
    'discover-workflow',
    {
      title: 'Discover Workflow',
      description: 'Discover available workflows by describing what you want to accomplish',
      argsSchema: {
        intent: z.string().describe('What you want to accomplish (e.g., "create video", "search memories", "update project")'),
        project: z.string().optional().describe('Filter workflows by project'),
        persona: z.string().optional().describe('Filter workflows by persona'),
      }
    },
    ({ intent, project, persona }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `I want to: ${intent}

${project ? `This is for the ${project} project. ` : ''}${persona ? `Using the ${persona} persona. ` : ''}

Please discover workflows that match this intent. Once you find suitable workflows, explain what each one does and help me choose the best one to execute.`
          }
        }
      ]
    })
  );

  logger.info({
    msg: 'MCP prompts registered',
    count: 3,
    prompts: [
      'aismr-video-creation',
      'memory-chat',
      'discover-workflow',
    ],
  });
}

