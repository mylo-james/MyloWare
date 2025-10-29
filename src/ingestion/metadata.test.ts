import { describe, expect, it } from 'vitest';
import { buildMetadataRecord, buildPromptText, parsePromptMetadata } from './metadata';

const basePersona = {
  title: 'Idea Generator Persona',
  activation_notice: 'Activation info',
  critical_notice: 'Critical info',
  agent: {
    name: 'Iggy',
    id: 'ideagenerator',
    title: 'Idea Generator',
    icon: '💡',
    whentouse: 'When generating ideas',
    customization: 'Stay creative',
  },
  persona: {
    role: 'Creative partner',
    style: 'Experimental',
    identity: 'Workflow instructions',
    focus: 'Divergent thinking',
    core_principles: ['Principle One', 'Principle Two'],
  },
  operating_notes: {
    beliefs: ['Believe in novelty'],
    practices: ['Always test'],
  },
  workflow: {
    definition_of_success: 'Twelve unique ideas',
    inputs: ['userInput'],
    steps: [
      { order: 1, instruction: 'Normalise the request' },
      { order: 2, instruction: 'Generate contrasting ideas' },
    ],
    output_notes: ['Return JSON'],
    vibe_guardrails: ['Stay tactile'],
    surreal_directive: ['Bend the possible'],
  },
  closing_message: 'Make the next idea unforgettable.',
  extra_section: {
    tips: ['Track duplicates'],
  },
};

const personaJson = JSON.stringify(basePersona);

describe('parsePromptMetadata', () => {
  it('parses persona prompts and extracts structured metadata', () => {
    const parsed = parsePromptMetadata({
      filePath: 'persona-ideagenerator.json',
      contents: personaJson,
    });

    expect(parsed.type).toBe('persona');
    expect(parsed.persona).toEqual(['ideagenerator']);
    expect(parsed.project).toEqual([]);
    expect(parsed.agent?.name).toBe('Iggy');
    expect(parsed.personaDetails?.corePrinciples).toEqual(['Principle One', 'Principle Two']);
    expect(parsed.operatingNotes?.beliefs).toEqual(['Believe in novelty']);
    expect(parsed.workflow?.steps?.[0]).toEqual({
      order: 1,
      instruction: 'Normalise the request',
    });
    expect(parsed.additionalSections?.extra_section).toEqual(basePersona.extra_section);
  });

  it('parses project prompts and slugs project identifiers', () => {
    const parsed = parsePromptMetadata({
      filePath: 'project-aismr.json',
      contents: JSON.stringify({ title: 'Project', orientation: { north_stars: ['Shine'] } }),
    });

    expect(parsed.type).toBe('project');
    expect(parsed.persona).toEqual([]);
    expect(parsed.project).toEqual(['aismr']);
    expect(parsed.orientation?.north_stars).toEqual(['Shine']);
  });

  it('parses combination prompts using last hyphen separator', () => {
    const parsed = parsePromptMetadata({
      filePath: 'ideagenerator-new_project.json',
      contents: JSON.stringify({ title: 'Combo' }),
    });

    expect(parsed.type).toBe('combination');
    expect(parsed.persona).toEqual(['ideagenerator']);
    expect(parsed.project).toEqual(['new', 'project']);
  });

  it('normalises slug segments to lowercase and splits on underscore or plus', () => {
    const parsed = parsePromptMetadata({
      filePath: 'persona-Product_Manager+Lead.json',
      contents: JSON.stringify({ title: 'Persona' }),
    });

    expect(parsed.persona).toEqual(['product', 'manager', 'lead']);
  });

  it('throws for unsupported extensions', () => {
    expect(() =>
      parsePromptMetadata({
        filePath: 'persona-ideagenerator.md',
        contents: personaJson,
      }),
    ).toThrowError();
  });

  it('throws when JSON is invalid', () => {
    expect(() =>
      parsePromptMetadata({
        filePath: 'persona-ideagenerator.json',
        contents: '{invalid}',
      }),
    ).toThrowError(/Failed to parse JSON prompt/);
  });
});

describe('buildMetadataRecord', () => {
  it('creates a database-friendly metadata object', () => {
    const parsed = parsePromptMetadata({
      filePath: 'persona-ideagenerator.json',
      contents: personaJson,
    });

    const record = buildMetadataRecord(parsed);

    expect(record.type).toBe('persona');
    expect(record.persona).toEqual(['ideagenerator']);
    expect(record.agent).toMatchObject({ id: 'ideagenerator', title: 'Idea Generator' });
    expect(record.workflow).toHaveProperty('definitionOfSuccess', 'Twelve unique ideas');
    expect(record.additional?.extra_section).toEqual(basePersona.extra_section);
  });
});

describe('buildPromptText', () => {
  it('renders a searchable text representation of the prompt', () => {
    const parsed = parsePromptMetadata({
      filePath: 'persona-ideagenerator.json',
      contents: personaJson,
    });

    const text = buildPromptText(parsed);

    expect(text).toContain('Idea Generator Persona');
    expect(text).toContain('Agent:');
    expect(text).toContain('Workflow:');
    expect(text).toContain('Core Principles:');
  });
});
