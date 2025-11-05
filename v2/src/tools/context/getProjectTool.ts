import type { ProjectGetParams, ProjectGetResult } from '../../types/context.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';

/**
 * Get project configuration by name
 *
 * @param params - Project retrieval parameters
 * @returns Project configuration
 * @throws {Error} If project not found
 */
export async function getProject(
  params: ProjectGetParams
): Promise<ProjectGetResult> {
  const repository = new ProjectRepository();

  // 1. Fetch project
  const project = await repository.findByName(params.projectName);

  if (!project) {
    throw new Error(`Project not found: ${params.projectName}`);
  }

  // 2. Format response
  return {
    project: {
      name: project.name,
      description: project.description,
      workflows: project.workflows,
      guardrails: project.guardrails,
      settings: project.settings,
    },
    metadata: project.metadata,
  };
}

