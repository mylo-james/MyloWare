import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { db } from '../db/client.js';
import { memories } from '../db/schema.js';
import { eq } from 'drizzle-orm';

interface PromptDefinition {
  name: string;
  description: string;
  steps: Array<{
    id: string;
    step: number;
    type: string;
    description: string;
    [key: string]: unknown;
  }>;
  output_format?: Record<string, unknown>;
  guardrails?: Array<{
    type: string;
    rule: Record<string, unknown>;
    onViolation: 'halt' | 'warn' | 'continue';
  }>;
}

/**
 * Register dynamic MCP prompts from procedural memories
 * 
 * Architecture:
 * - Prompts = Semantic/declarative guidance stored as procedural memories
 * - They tell the AI WHAT to accomplish and WHY
 * - The AI then decides HOW using n8n workflows or MCP tools
 */
export async function registerMCPPrompts(server: McpServer): Promise<void> {
  // Load all procedural memories that contain workflow/prompt definitions
  const proceduralMemories = await db
    .select()
    .from(memories)
    .where(eq(memories.memoryType, 'procedural'));

  const registeredPrompts: string[] = [];

  // Register each procedural memory as a prompt with persona/project scoping
  for (const memory of proceduralMemories) {
    // Check if this memory has a prompt definition in metadata
    const promptDef = (memory.metadata as any)?.workflow as PromptDefinition | undefined;
    
    if (!promptDef || !promptDef.name || !promptDef.description) {
      continue; // Skip memories without valid prompt definitions
    }

    // Get persona and project arrays from memory
    const personas = memory.persona && memory.persona.length > 0 ? memory.persona : ['general'];
    const projects = memory.project && memory.project.length > 0 ? memory.project : ['general'];

    // Format the steps as a readable guide
    const stepsText = promptDef.steps
      .map((step, idx) => `${idx + 1}. ${step.description}`)
      .join('\n');

    // Register prompt for each persona/project combination
    for (const persona of personas) {
      for (const project of projects) {
        const promptId = `${persona}/${project}/${promptDef.name.toLowerCase().replace(/\s+/g, '-')}`;

        // Register the prompt dynamically
        server.registerPrompt(
          promptId,
          {
            title: `${promptDef.name} (${persona} on ${project})`,
            description: promptDef.description,
            argsSchema: {
              input: z.string().optional(),
            }
          },
          ({ input }) => {
            // Build the prompt message with semantic guidance
            let text = `# ${promptDef.name}\n\n${promptDef.description}\n\n## Steps:\n\n${stepsText}`;

            // Add guardrails if present
            if (promptDef.guardrails && promptDef.guardrails.length > 0) {
              text += `\n\n## Guardrails:\n\n`;
              text += promptDef.guardrails
                .map((g, idx) => `${idx + 1}. ${g.type}: ${JSON.stringify(g.rule)}`)
                .join('\n');
            }

            // Add input parameters if provided
            if (input) {
              const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
              text += `\n\n## Input:\n\n${inputStr}`;
            }

            return {
              messages: [
                {
                  role: 'user',
                  content: {
                    type: 'text',
                    text,
                  }
                }
              ]
            };
          }
        );

        registeredPrompts.push(promptId);
      }
    }
  }

  // Also register a helper prompt for general memory-assisted chat
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

Before responding, search memories for relevant context using memory_search with:
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
  registeredPrompts.push('memory-chat');

  logger.info({
    msg: 'MCP prompts registered with persona/project scoping',
    count: registeredPrompts.length,
  });
}

