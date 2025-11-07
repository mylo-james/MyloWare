import type { TestProject } from '../../../src/types/seed.js';

export const testProjects: TestProject[] = [
  {
    name: 'aismr',
    description: 'AI ASMR video generation project',
    workflow: ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'], // Use 'workflow' not 'workflows' to match schema
    optionalSteps: [],
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
    workflow: ['casey'], // Use 'workflow' not 'workflows' to match schema
    optionalSteps: [],
    guardrails: {},
    settings: {},
  },
];

