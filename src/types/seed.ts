export interface TestPersona {
  name: string;
  description: string;
  capabilities: string[];
  tone: string;
  defaultProject?: string;
  systemPrompt?: string;
}

export interface TestProject {
  name: string;
  description: string;
  workflows: string[];
  guardrails: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export interface TestMemory {
  content: string;
  memoryType: 'episodic' | 'semantic' | 'procedural';
  persona?: string[];
  project?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

