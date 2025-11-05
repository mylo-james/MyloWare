import type {
  WorkflowDiscoveryParams,
  WorkflowDiscoveryResult,
  WorkflowCandidate,
  WorkflowDefinition,
} from '../../types/workflow.js';
import { searchMemories } from '../memory/searchTool.js';

/**
 * Discover workflows by searching procedural memory using semantic search
 *
 * @param params - Discovery parameters (intent, filters)
 * @returns Ranked workflow candidates
 */
export async function discoverWorkflow(
  params: WorkflowDiscoveryParams
): Promise<WorkflowDiscoveryResult> {
  const startTime = Date.now();

  // 1. Search procedural memories with the intent
  const searchResult = await searchMemories({
    query: params.intent,
    memoryTypes: ['procedural'],
    project: params.project,
    persona: params.persona,
    limit: params.limit || 10,
    temporalBoost: false, // Workflows don't decay with time
  });

  // 2. Parse workflow definitions from memories
  const workflows: WorkflowCandidate[] = searchResult.memories
    .map((memory, index) => {
      // Parse workflow from metadata
      const workflowDef = memory.metadata.workflow as WorkflowDefinition | undefined;

      // Skip if no workflow definition found
      if (!workflowDef) {
        return null;
      }

      // Use actual similarity score from search result if available
      // The memory is already ranked by RRF, so index reflects relevance
      // But we can use a normalized score based on position (higher = more relevant)
      const relevanceScore = searchResult.memories.length > 0
        ? (searchResult.memories.length - index) / searchResult.memories.length
        : 1.0 - index * 0.05;

      return {
        workflowId: memory.id,
        name: workflowDef.name || 'Unknown Workflow',
        description:
          workflowDef.description || memory.summary || memory.content,
        relevanceScore,
        workflow: workflowDef,
        memoryId: memory.id,
      };
    })
    .filter((w): w is WorkflowCandidate => w !== null);

  // 3. Return results
  return {
    workflows,
    totalFound: workflows.length,
    searchTime: Date.now() - startTime,
  };
}

