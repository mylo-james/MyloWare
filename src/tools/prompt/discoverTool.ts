import type { PromptDiscoveryParams, PromptDiscoveryResult } from '../../types/prompt.js';
import { MemoryRepository } from '../../db/repositories/memory-repository.js';
import { embedText } from '../../utils/embedding.js';

/**
 * Discover available prompts for a persona and project
 */
export async function discoverPrompts(
  params: PromptDiscoveryParams
): Promise<PromptDiscoveryResult> {
  const repository = new MemoryRepository();
  
  // Build query for procedural memories matching persona/project
  const queryText = params.intent || `${params.persona} ${params.project} workflows`;
  const embedding = await embedText(queryText);
  
  const memories = await repository.vectorSearch(embedding, {
    query: queryText,
    memoryTypes: ['procedural'],
    persona: params.persona,
    project: params.project,
    limit: params.limit || 10,
  });

  const prompts = memories
    .map(memory => {
      const workflow = (memory.metadata as any)?.workflow;
      if (!workflow?.name) return null;
      
      return {
        id: `${params.persona}/${params.project}/${workflow.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: workflow.name,
        description: workflow.description || '',
        steps: workflow.steps?.length || 0,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return {
    prompts,
    totalFound: prompts.length,
  };
}
