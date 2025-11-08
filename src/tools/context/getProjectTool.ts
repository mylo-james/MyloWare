import type {
  ProjectGetParams,
  ProjectGetResult,
} from '../../types/context.js';
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

  // Accept UUIDs only
  const projectId = params.projectName.trim();
  if (!projectId) {
    throw new Error('projectName must be a non-empty UUID');
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      projectId
    )
  ) {
    throw new Error('projectName must be a project UUID');
  }

  const project = await repository.findById(projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // 2. Format response
  return {
    project: {
      name: project.name,
      description: project.description,
      workflow: project.workflow,
      optionalSteps: project.optionalSteps,
      guardrails: project.guardrails,
      settings: project.settings,
    },
    metadata: project.metadata,
  };
}
