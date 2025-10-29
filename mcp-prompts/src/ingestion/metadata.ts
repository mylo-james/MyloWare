import path from 'node:path';

export type PromptType = 'persona' | 'project' | 'combination';

export interface ParsedPromptMetadata {
  type: PromptType;
  persona: string[];
  project: string[];
  filename: string;
}

const PERSONA_PREFIX = 'persona-';
const PROJECT_PREFIX = 'project-';
const EXTENSION = '.md';

export function parsePromptMetadata(filePath: string): ParsedPromptMetadata {
  const filename = path.basename(filePath);

  if (!filename.endsWith(EXTENSION)) {
    throw new Error(`Unsupported file type for prompt: ${filename}`);
  }

  const basename = filename.slice(0, -EXTENSION.length);

  if (basename.startsWith(PERSONA_PREFIX)) {
    const personaSlug = basename.slice(PERSONA_PREFIX.length);
    if (!personaSlug) {
      throw new Error(`Persona filename missing identifier: ${filename}`);
    }
    const persona = slugToList(personaSlug);
    return {
      type: 'persona',
      persona,
      project: [],
      filename,
    };
  }

  if (basename.startsWith(PROJECT_PREFIX)) {
    const projectSlug = basename.slice(PROJECT_PREFIX.length);
    if (!projectSlug) {
      throw new Error(`Project filename missing identifier: ${filename}`);
    }
    const project = slugToList(projectSlug);
    return {
      type: 'project',
      persona: [],
      project,
      filename,
    };
  }

  const separatorIndex = basename.lastIndexOf('-');
  if (separatorIndex === -1) {
    throw new Error(`Unable to infer prompt type from filename: ${filename}`);
  }

  const personaSlug = basename.slice(0, separatorIndex);
  const projectSlug = basename.slice(separatorIndex + 1);

  if (!personaSlug || !projectSlug) {
    throw new Error(`Invalid combination filename: ${filename}`);
  }

  return {
    type: 'combination',
    persona: slugToList(personaSlug),
    project: slugToList(projectSlug),
    filename,
  };
}

function slugToList(slug: string): string[] {
  return slug
    .split(/\+|_/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}
