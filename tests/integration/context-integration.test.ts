import { describe, it, expect, beforeAll } from 'vitest';
import { getPersona } from '@/tools/context/getPersonaTool.js';
import { getProject } from '@/tools/context/getProjectTool.js';

describe('Context Integration', () => {
  beforeAll(async () => {
    // Ensure migrations have run
  });

  it('should load Casey persona with AISMR project', async () => {
    const persona = await getPersona({ personaName: 'chat' });
    const project = await getProject({ projectName: 'aismr' });

    expect(persona.persona.name).toBe('chat');
    expect(persona.persona.defaultProject).toBe('aismr');
    expect(project.project.name).toBe('aismr');
    expect(project.project.workflows).toContain('idea-generation');
  });

  it('should load Idea Generator with system prompt', async () => {
    const persona = await getPersona({ personaName: 'ideagenerator' });

    expect(persona.persona.systemPrompt).toBeDefined();
    expect(persona.persona.systemPrompt).toContain('uniqueness');
    expect(persona.persona.capabilities).toContain('idea-generation');
  });

  it('should enforce AISMR guardrails', async () => {
    const project = await getProject({ projectName: 'aismr' });

    expect(project.project.guardrails).toHaveProperty('runtime', '8.0 seconds');
    expect(project.project.guardrails).toHaveProperty('whisperTiming', '3.0 seconds');
    expect(project.project.guardrails).toHaveProperty('maxHands', 2);
  });

  it('should provide workflow list from project', async () => {
    const project = await getProject({ projectName: 'aismr' });

    const workflows = project.project.workflows;
    expect(workflows).toContain('idea-generation');
    expect(workflows).toContain('screenplay-generation');
    expect(workflows).toContain('video-generation');
    expect(workflows).toContain('publishing');
  });
});
