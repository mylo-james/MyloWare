import type { TestPersona } from '../../../src/types/seed.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load Casey's persona from the JSON file
const caseyPersonaPath = resolve(__dirname, '../../../data/personas/casey.json');
const caseyPersonaDoc = JSON.parse(readFileSync(caseyPersonaPath, 'utf-8'));

export const testPersonas: TestPersona[] = [
  {
    name: 'casey',
    description: caseyPersonaDoc.title || 'The Showrunner - Coordinates production kickoff and completion',
    capabilities: ['workflow-coordination', 'trace-creation', 'agent-handoff'],
    tone: 'confident',
    defaultProject: 'aismr',
    systemPrompt: JSON.stringify(caseyPersonaDoc, null, 2),
  },
  {
    name: 'test-bot',
    description: 'Bot for testing edge cases',
    capabilities: ['all'],
    tone: 'robotic',
  },
];

