import type { TestPersona } from '../../../src/types/seed.js';

export const testPersonas: TestPersona[] = [
  {
    name: 'casey',
    description: 'Warm, helpful AI collaborator for Mylo',
    capabilities: ['conversation', 'workflow-discovery', 'orchestration'],
    tone: 'friendly',
    defaultProject: 'aismr',
  },
  {
    name: 'test-bot',
    description: 'Bot for testing edge cases',
    capabilities: ['all'],
    tone: 'robotic',
  },
];

