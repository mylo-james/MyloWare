export type WorkflowStepType =
  | 'mcp_call'
  | 'llm_generation'
  | 'api_call'
  | 'validation'
  | 'conditional'
  | 'parallel';

export interface WorkflowStep {
  id: string;
  step: number;
  type: WorkflowStepType;
  description: string;
  dependsOn?: string[];
  mcp_call?: {
    tool: string;
    params: Record<string, unknown>;
    storeAs?: string;
  };
  llm_generation?: {
    model: string;
    prompt: string;
    schema?: Record<string, unknown>;
    structuredOutput?: boolean;
    storeAs?: string;
    temperature?: number;
  };
  api_call?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    storeAs?: string;
    expectedStatusCodes?: number[];
  };
  parallel_calls?: Array<{
    tool: string;
    params: Record<string, unknown>;
    storeAs?: string;
  }>;
  validation?: Record<string, unknown>;
  conditional?: {
    condition: string;
    ifTrue: string;
    ifFalse: string;
  };
  retry?: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier?: number;
  };
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  steps: WorkflowStep[];
  output_format?: Record<string, unknown>;
  guardrails?: Array<{
    type: string;
    rule: Record<string, unknown>;
    onViolation: 'halt' | 'warn' | 'continue';
  }>;
}

export interface WorkflowDiscoveryParams {
  intent: string;
  project?: string;
  persona?: string;
  limit?: number;
}

export interface WorkflowCandidate {
  workflowId: string;
  name: string;
  description: string;
  relevanceScore: number;
  workflow: WorkflowDefinition;
  memoryId: string;
}

export interface WorkflowDiscoveryResult {
  workflows: WorkflowCandidate[];
  totalFound: number;
  searchTime: number;
}

export interface WorkflowExecuteParams {
  workflowId: string;
  input: Record<string, unknown>;
  sessionId?: string;
  waitForCompletion?: boolean;
  /** Optional override when the caller already knows the actual n8n workflow ID */
  n8nWorkflowId?: string;
  /** Optional human-friendly name for logging (otherwise derived from memory metadata) */
  workflowName?: string;
}

export interface WorkflowExecuteResult {
  workflowRunId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: Record<string, unknown>;
  error?: string;
}
