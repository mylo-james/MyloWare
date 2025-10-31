import { promises as fs } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PromptEmbeddingsRepository } from '../db/repository';
import { ingestPrompts, parsePromptDocument, type PromptType } from './ingest';

const samplePersonaPrompt = {
  title: 'Idea Generator Persona',
  activation_notice: 'Persona activation notice.',
  agent: {
    name: 'Iggy',
    id: 'ideagenerator',
    title: 'Concept Generator',
    icon: '💡',
    whentouse: 'When ideation is needed.',
    customization: 'Stay playful.',
  },
  persona: {
    role: 'Constraint-loving partner.',
    core_principles: ['Constraints are fuel', 'Delightfully unhinged'],
  },
};

const sampleCombinationPrompt = {
  title: 'Screenwriter × AISMR',
  agent: {
    name: 'Sloane × AISMR',
    id: 'screenwriter-aismr',
    title: 'AISMR Screenwriter',
  },
  workflow: {
    definition_of_success: 'One production-ready script.',
    inputs: ['idea', 'vibe'],
    steps: [
      {
        order: 1,
        instruction: 'Normalize inputs.',
      },
      {
        order: 2,
        instruction: 'Apply AISMR DNA.',
      },
    ],
  },
};

describe('parsePromptDocument', () => {
  it('derives persona metadata from agent id', () => {
    const parsed = parsePromptDocument(samplePersonaPrompt, 'persona-ideagenerator.json');
    expect(parsed.promptKey).toBe('ideagenerator');
    expect(parsed.type).toBe<'persona'>('persona');
    expect(parsed.personaSlug).toBe('ideagenerator');
    expect(parsed.projectSlug).toBeNull();
    expect(parsed.metadata.persona).toEqual(['ideagenerator']);
    expect(parsed.metadata.project).toEqual([]);
    expect(parsed.chunkTexts.length).toBeGreaterThan(0);
    expect(parsed.memoryType).toBe('persona');
  });

  it('derives combination metadata from compound agent id', () => {
    const parsed = parsePromptDocument(sampleCombinationPrompt, 'screenwriter-aismr.json');
    expect(parsed.promptKey).toBe('screenwriter-aismr');
    expect(parsed.type).toBe<'combination'>('combination');
    expect(parsed.personaSlug).toBe('screenwriter');
    expect(parsed.projectSlug).toBe('aismr');
    expect(parsed.metadata.persona).toEqual(['screenwriter']);
    expect(parsed.metadata.project).toEqual(['aismr']);
    expect(parsed.chunkTexts[0].granularity).toBe('document');
    expect(parsed.memoryType).toBe('semantic');
  });
});

describe('ingestPrompts', () => {
  it('ingests prompts via repository with generated embeddings', async () => {
    const repository = {
      listPrompts: vi.fn().mockResolvedValue([]),
      deleteByPromptKey: vi.fn().mockResolvedValue(0),
      upsertEmbeddings: vi.fn().mockResolvedValue(2),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn().mockImplementation(async (texts: string[]) => {
      return texts.map(() => [0.1, 0.2, 0.3]);
    });
    const linkGenerator = {
      generateForChunks: vi.fn().mockResolvedValue(undefined),
    };

    const promptCount = await countPromptFiles();

    const result = await ingestPrompts({
      directory: pathFixtureDirectory(),
      repository: repository as unknown as PromptEmbeddingsRepository,
      embed,
      linkGenerator,
    });

    expect(result.processed.length).toBe(promptCount);
    expect(repository.listPrompts).toHaveBeenCalled();
    expect(repository.upsertEmbeddings).toHaveBeenCalled();
    expect(embed).toHaveBeenCalled();
    expect(linkGenerator.generateForChunks).toHaveBeenCalled();
  });

  it('skips database writes when running in dry run mode', async () => {
    const repository = {
      listPrompts: vi.fn().mockResolvedValue([]),
      deleteByPromptKey: vi.fn(),
      upsertEmbeddings: vi.fn(),
    } satisfies Partial<PromptEmbeddingsRepository>;

    const embed = vi.fn();
    const linkGenerator = {
      generateForChunks: vi.fn().mockResolvedValue(undefined),
    };

    const result = await ingestPrompts({
      directory: pathFixtureDirectory(),
      repository: repository as unknown as PromptEmbeddingsRepository,
      embed,
      dryRun: true,
      linkGenerator,
    });

    expect(result.processed.length).toBeGreaterThan(0);
    expect(repository.listPrompts).not.toHaveBeenCalled();
    expect(repository.upsertEmbeddings).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(linkGenerator.generateForChunks).not.toHaveBeenCalled();
  });
});

function pathFixtureDirectory(): string {
  return `${process.cwd()}/prompts`;
}

async function countPromptFiles(): Promise<number> {
  const directory = pathFixtureDirectory();
  const entries = await fs.readdir(directory);
  return entries.filter((name) => name.endsWith('.json')).length;
}
