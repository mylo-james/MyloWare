export interface PromptDiscoveryParams {
  persona: string;
  project: string;
  intent?: string;
  limit?: number;
}

export interface PromptDiscoveryResult {
  prompts: Array<{
    id: string;
    name: string;
    description: string;
    steps: number;
  }>;
  totalFound: number;
}

export interface PromptExecuteParams {
  promptId: string;
  sessionId?: string;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
  waitForCompletion?: boolean;
}

export interface PromptExecuteResult {
  success: boolean;
  promptRunId?: string;
  status?: string;
  output?: unknown;
  result?: unknown;
  error?: string;
}
