import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PersonaRepository } from '../db/repositories/persona-repository.js';
import { ProjectRepository } from '../db/repositories/project-repository.js';
import { SessionRepository } from '../db/repositories/session-repository.js';
import { logger } from '../utils/logger.js';

/**
 * Register all MCP resources with the server
 */
export function registerMCPResources(server: McpServer): void {
  // Static persona resources - list all available personas
  server.registerResource(
    'personas',
    'personas://list',
    {
      title: 'Available Personas',
      description: 'List of all available personas',
      mimeType: 'application/json',
    },
    async (uri) => {
      const repository = new PersonaRepository();
      const personas = await repository.findAll();
      
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              personas: personas.map(p => ({
                name: p.name,
                description: p.description,
                capabilities: p.capabilities,
                tone: p.tone,
                defaultProject: p.defaultProject,
              }))
            }, null, 2)
          }
        ]
      };
    }
  );

  // Dynamic persona resource - get specific persona by name
  server.registerResource(
    'persona',
    new ResourceTemplate('personas://{personaName}', { list: undefined }),
    {
      title: 'Persona Configuration',
      description: 'Load persona configuration by name',
      mimeType: 'application/json',
    },
    async (uri, { personaName }) => {
      const name = Array.isArray(personaName) ? personaName[0] : personaName;
      const repository = new PersonaRepository();
      const persona = await repository.findByName(name);
      
      if (!persona) {
        throw new Error(`Persona not found: ${name}`);
      }
      
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              persona: {
                name: persona.name,
                description: persona.description,
                capabilities: persona.capabilities,
                tone: persona.tone,
                defaultProject: persona.defaultProject,
                systemPrompt: persona.systemPrompt,
              },
              metadata: persona.metadata,
            }, null, 2)
          }
        ]
      };
    }
  );

  // Static project resources - list all available projects
  server.registerResource(
    'projects',
    'projects://list',
    {
      title: 'Available Projects',
      description: 'List of all available projects',
      mimeType: 'application/json',
    },
    async (uri) => {
      const repository = new ProjectRepository();
      const projects = await repository.findAll();
      
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              projects: projects.map(p => ({
                name: p.name,
                description: p.description,
                workflow: p.workflow,
                optionalSteps: p.optionalSteps,
              }))
            }, null, 2)
          }
        ]
      };
    }
  );

  // Dynamic project resource - get specific project by name
  server.registerResource(
    'project',
    new ResourceTemplate('projects://{projectName}', { list: undefined }),
    {
      title: 'Project Configuration',
      description: 'Load project configuration by name',
      mimeType: 'application/json',
    },
    async (uri, { projectName }) => {
      const name = Array.isArray(projectName) ? projectName[0] : projectName;
      const repository = new ProjectRepository();
      const project = await repository.findByName(name);
      
      if (!project) {
        throw new Error(`Project not found: ${name}`);
      }
      
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              project: {
                name: project.name,
                description: project.description,
                workflow: project.workflow,
                optionalSteps: project.optionalSteps,
                guardrails: project.guardrails,
                settings: project.settings,
              },
              metadata: project.metadata,
            }, null, 2)
          }
        ]
      };
    }
  );

  // Dynamic session context resource
  server.registerResource(
    'session-context',
    new ResourceTemplate('sessions://{sessionId}/context', { list: undefined }),
    {
      title: 'Session Context',
      description: 'Load session context and working memory',
      mimeType: 'application/json',
    },
    async (uri, { sessionId }) => {
      const id = Array.isArray(sessionId) ? sessionId[0] : sessionId;
      const repository = new SessionRepository();
      const session = await repository.findById(id);
      
      if (!session) {
        throw new Error(`Session not found: ${id}`);
      }
      
      const context = await repository.getContext(id);
      
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              session: {
                id: session.id,
                userId: session.userId,
                persona: session.persona,
                project: session.project,
                createdAt: session.createdAt.toISOString(),
                updatedAt: session.updatedAt.toISOString(),
              },
              context,
            }, null, 2)
          }
        ]
      };
    }
  );

  logger.info({
    msg: 'MCP resources registered',
    count: 5,
    resources: [
      'personas://list',
      'personas://{personaName}',
      'projects://list',
      'projects://{projectName}',
      'sessions://{sessionId}/context',
    ],
  });
}

