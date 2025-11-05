import { describe, it, expect } from 'vitest';
import { getProject } from '@/tools/context/getProjectTool.js';

describe('getProject', () => {
  it('should load project by name', async () => {
    const result = await getProject({
      projectName: 'aismr',
    });

    expect(result.project.name).toBe('aismr');
    expect(result.project.description).toBeDefined();
    expect(result.project.workflows).toBeInstanceOf(Array);
    expect(result.project.guardrails).toBeDefined();
    expect(result.project.settings).toBeDefined();
  });

  it('should throw error for unknown project', async () => {
    await expect(
      getProject({ projectName: 'unknown-project' })
    ).rejects.toThrow('Project not found');
  });

  it('should include AISMR guardrails', async () => {
    const result = await getProject({
      projectName: 'aismr',
    });

    expect(result.project.guardrails).toHaveProperty('runtime');
    expect(result.project.guardrails).toHaveProperty('whisperTiming');
    expect(result.project.guardrails).toHaveProperty('maxHands');
  });
});

