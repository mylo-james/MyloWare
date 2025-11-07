export interface PromptExecuteParams {
  promptId: string;
  sessionId?: string;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
  waitForCompletion?: boolean;
  /** Optional override for the backing n8n workflow ID */
  n8nWorkflowId?: string;
  /** Optional friendly name for logging */
  promptName?: string;
}

export interface PromptExecuteResult {
  success: boolean;
  promptRunId?: string;
  status?: string;
  output?: unknown;
  result?: unknown;
  error?: string;
}
