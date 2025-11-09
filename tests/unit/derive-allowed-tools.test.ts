import { describe, expect, it } from 'vitest';

import { deriveAllowedTools } from '@/utils/trace-prep.js';

const basePersona = (name: string) => ({
  personaName: name,
  personaMeta: {},
  personaConfig: { name },
  projectKnown: true,
});

describe('deriveAllowedTools', () => {
  it('grants Casey access to trace_update but not workflow tools when project unknown', () => {
    const tools = deriveAllowedTools({
      ...basePersona('casey'),
      projectKnown: false,
    });

    expect(tools).toContain('trace_update');
    expect(tools).toContain('memory_search');
    expect(tools).toContain('memory_store');
    expect(tools).toContain('handoff_to_agent');
    expect(tools).not.toContain('workflow_trigger');
    expect(tools).not.toContain('jobs');
  });

  it('keeps Iggy limited to core coordination tools', () => {
    const tools = deriveAllowedTools(basePersona('iggy'));
    expect(tools).toEqual(['memory_search', 'memory_store', 'handoff_to_agent']);
  });

  it('allows Veo to trigger workflows and manage jobs', () => {
    const tools = deriveAllowedTools(basePersona('veo'));
    expect(tools).toEqual([
      'memory_search',
      'memory_store',
      'handoff_to_agent',
      'workflow_trigger',
      'jobs',
    ]);
  });

  it('allows Alex the same workflow + jobs surface as Veo', () => {
    const tools = deriveAllowedTools(basePersona('alex'));
    expect(tools).toEqual([
      'memory_search',
      'memory_store',
      'handoff_to_agent',
      'workflow_trigger',
      'jobs',
    ]);
  });

  it('allows Quinn to trigger workflow handoffs but not jobs', () => {
    const tools = deriveAllowedTools(basePersona('quinn'));
    expect(tools).toEqual([
      'memory_search',
      'memory_store',
      'handoff_to_agent',
      'workflow_trigger',
    ]);
    expect(tools).not.toContain('jobs');
    expect(tools).not.toContain('trace_update');
  });

  it('ensures every persona retains core coordination tools', () => {
    const personas = ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'];
    for (const persona of personas) {
      const tools = deriveAllowedTools(basePersona(persona));
      expect(tools).toContain('memory_search');
      expect(tools).toContain('memory_store');
      expect(tools).toContain('handoff_to_agent');
    }
  });
});

