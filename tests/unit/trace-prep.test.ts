import { describe, it, expect } from 'vitest';

import { loadProjectPlaybooks } from '@/utils/trace-prep.js';

describe('loadProjectPlaybooks', () => {
  it('loads guardrails for AISMR project', async () => {
    const playbooks = await loadProjectPlaybooks('aismr');

    expect(playbooks).not.toBeNull();
    expect(playbooks?.guardrails).toBeDefined();
    expect(playbooks?.guardrails).toHaveProperty('technical_constraints');
    expect(
      (playbooks?.guardrails as Record<string, unknown>).technical_constraints,
    ).toMatchObject({
      video_count: 12,
      aspect_ratio: '9:16',
    });
  });

  it('loads workflow array from playbooks', async () => {
    const playbooks = await loadProjectPlaybooks('aismr');

    expect(playbooks?.workflow).toBeDefined();
    expect(Array.isArray(playbooks?.workflow)).toBe(true);
    expect(playbooks?.workflow).toContain('casey');
    expect(playbooks?.workflow).toContain('iggy');
  });

  it('loads agent expectations for personas', async () => {
    const playbooks = await loadProjectPlaybooks('aismr');

    expect(playbooks?.agentExpectations).toBeDefined();
    const expectations = playbooks?.agentExpectations as Record<string, unknown>;
    expect(expectations).toHaveProperty('iggy');
    expect(expectations.iggy).toMatchObject({
      deliverable: '12 surreal object-modifier pairs',
    });
  });

  it('returns null for unknown project slug', async () => {
    const playbooks = await loadProjectPlaybooks('nonexistent-project');
    expect(playbooks).toBeNull();
  });
});

