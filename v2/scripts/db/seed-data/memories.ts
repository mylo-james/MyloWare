import type { TestMemory } from '../../../src/types/seed.js';

// Helper function - single-line for AI
function cleanForAI(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

export const testMemories: TestMemory[] = [
  {
    content: cleanForAI('Generated 12 AISMR ideas about rain sounds'),
    memoryType: 'episodic',
    persona: ['casey'],
    project: ['aismr'],
    tags: ['idea-generation', 'rain'],
  },
  {
    content: cleanForAI('User preferred gentle rain over storm sounds'),
    memoryType: 'episodic',
    persona: ['casey'],
    project: ['aismr'],
    tags: ['user-preference', 'rain'],
  },
  {
    content: cleanForAI(
      'AISMR videos must be exactly 8.0 seconds long, with whisper at 3.0 seconds'
    ),
    memoryType: 'semantic',
    project: ['aismr'],
    tags: ['specification', 'timing', 'runtime'],
  },
  {
    content: cleanForAI(
      'AISMR Idea Generation Workflow: Search past ideas, generate 12 new unique ideas, validate against archive, store results'
    ),
    memoryType: 'procedural',
    project: ['aismr'],
    tags: ['workflow', 'idea-generation'],
  },
];

