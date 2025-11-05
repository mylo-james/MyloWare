import type { TestProject } from '../../../src/types/seed.js';

export const testProjects: TestProject[] = [
  {
    name: 'aismr',
    description: 'AI ASMR video generation project',
    workflows: ['idea-generation', 'screenplay', 'video-generation', 'upload'],
    guardrails: {
      runtime: '8.0 seconds',
      whisperTiming: '3.0 seconds',
      maxHands: 2,
    },
    settings: {
      outputPlatforms: ['tiktok', 'youtube'],
      defaultPlatform: 'tiktok',
    },
  },
  {
    name: 'test',
    description: 'Test project for development',
    workflows: ['test-workflow'],
    guardrails: {},
    settings: {},
  },
];

