export interface PersonaGetParams {
  personaName: string;
}

export interface PersonaGetResult {
  persona: {
    name: string;
    description: string;
    capabilities: string[];
    tone: string;
    defaultProject: string | null;
    systemPrompt: string | null;
    allowedTools: string[];
  };
  metadata: Record<string, unknown>;
}

export interface ProjectGetParams {
  projectName: string;
}

export interface ProjectGetResult {
  project: {
    name: string;
    description: string;
    workflow: string[];
    optionalSteps: string[];
    guardrails: Record<string, unknown>;
    settings: Record<string, unknown>;
  };
  metadata: Record<string, unknown>;
}

