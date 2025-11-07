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
