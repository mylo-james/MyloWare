/**
 * Workflow Definition Types
 *
 * These types define the structure for procedural memory workflow definitions
 * that are stored in RAG and loaded by n8n workflows via MCP agents.
 */

/**
 * Main workflow definition structure
 */
export interface WorkflowDefinition {
  /** Title of the workflow for identification */
  title: string;
  /** Must be 'procedural' for workflow definitions */
  memoryType: 'procedural';
  /** Projects this workflow applies to */
  project: string[];
  /** Optional personas this workflow applies to */
  persona?: string[];
  /** The workflow definition itself */
  workflow: Workflow;
  /** Optional version for tracking changes */
  version?: string;
}

/**
 * Workflow structure containing steps and metadata
 */
export interface Workflow {
  /** Name of the workflow */
  name: string;
  /** Description of what the workflow does */
  description: string;
  /** Ordered list of workflow steps */
  steps: WorkflowStep[];
  /** Optional global validation rules */
  validation?: ValidationRules;
  /** Optional output format/schema */
  output_format?: unknown;
  /** Optional guardrails for the entire workflow */
  guardrails?: Guardrail[];
}

/**
 * A single step in a workflow
 */
export interface WorkflowStep {
  /** Step identifier */
  id: string;
  /** Step number for ordering */
  step: number;
  /** Description of what this step does */
  description?: string;
  /** Step type determines which action fields are valid */
  type: 'mcp_call' | 'llm_generation' | 'api_call' | 'validation' | 'conditional' | 'parallel';
  /** Dependencies on other step IDs */
  dependsOn?: string[];
  /** MCP tool call (for type='mcp_call') */
  mcp_call?: MCPCall;
  /** Parallel MCP calls (for type='parallel') */
  parallel_calls?: MCPCall[];
  /** LLM generation step (for type='llm_generation') */
  llm_generation?: LLMGeneration;
  /** External API call (for type='api_call') */
  api_call?: APICall;
  /** Conditional branching logic (for type='conditional') */
  conditional?: ConditionalStep;
  /** Step-specific validation rules */
  validation?: ValidationRules;
  /** What to do if this step fails */
  on_validation_failure?: FailureStrategy;
  /** Retry policy for this step */
  retry?: RetryPolicy;
  /** Fallback step if this step fails */
  fallback?: WorkflowStep;
}

/**
 * MCP tool call definition
 */
export interface MCPCall {
  /** MCP tool name (e.g., 'prompts.search', 'conversation.remember') */
  tool: string;
  /** Parameters for the tool call */
  params: Record<string, unknown>;
  /** Store result in context with this key */
  storeAs?: string;
  /** Whether this call is required or can be skipped on error */
  required?: boolean;
}

/**
 * LLM generation step
 */
export interface LLMGeneration {
  /** LLM model to use */
  model?: string;
  /** System prompt (can reference context variables) */
  systemPrompt?: string;
  /** User prompt template (can reference context variables) */
  prompt: string;
  /** Output JSON schema */
  schema?: unknown;
  /** Temperature for generation */
  temperature?: number;
  /** Maximum tokens */
  maxTokens?: number;
  /** Store result in context with this key */
  storeAs?: string;
  /** Whether to use structured output mode */
  structuredOutput?: boolean;
}

/**
 * External API call step
 */
export interface APICall {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** API endpoint URL (can reference context variables) */
  url: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body */
  body?: unknown;
  /** Store result in context with this key */
  storeAs?: string;
  /** Expected status codes */
  expectedStatusCodes?: number[];
}

/**
 * Conditional step for branching logic
 */
export interface ConditionalStep {
  /** Condition expression (e.g., '${step1.status} === "success"') */
  condition: string;
  /** Step ID to execute if condition is true */
  ifTrue: string;
  /** Step ID to execute if condition is false */
  ifFalse?: string;
}

/**
 * Validation rules
 */
export interface ValidationRules {
  /** Schema validation rules */
  schema?: SchemaValidation;
  /** Uniqueness validation rules */
  uniqueness?: UniquenessValidation;
  /** Timing validation rules */
  timing?: TimingValidation;
  /** Content filter rules */
  contentFilter?: ContentFilterValidation;
  /** Custom validation rules */
  custom?: CustomValidation[];
}

/**
 * Schema validation rule
 */
export interface SchemaValidation {
  /** JSON schema to validate against */
  schema: unknown;
  /** Action on violation */
  onViolation: FailureStrategy;
}

/**
 * Uniqueness validation rule
 */
export interface UniquenessValidation {
  /** Context keys to check against (e.g., ['${remember_past_ideas.ideas}']) */
  against: string[];
  /** Similarity threshold (0-1) */
  threshold?: number;
  /** Action on violation */
  onViolation: FailureStrategy;
}

/**
 * Timing validation rule (for AISMR: runtime must be 8.0s, whisper at 3.0s, etc.)
 */
export interface TimingValidation {
  /** Required runtime in seconds */
  runtime?: number;
  /** Required whisper timing in seconds */
  whisperTiming?: number;
  /** Maximum number of hands */
  maxHands?: number;
  /** Action on violation */
  onViolation: FailureStrategy;
}

/**
 * Content filter validation rule
 */
export interface ContentFilterValidation {
  /** Forbidden terms */
  forbiddenTerms?: string[];
  /** Required terms */
  requiredTerms?: string[];
  /** Action on violation */
  onViolation: FailureStrategy;
}

/**
 * Custom validation rule
 */
export interface CustomValidation {
  /** Validation name */
  name: string;
  /** Validation expression or function */
  validate: string | ((value: unknown, context: Record<string, unknown>) => boolean);
  /** Action on violation */
  onViolation: FailureStrategy;
}

/**
 * Failure strategy when validation fails
 */
export type FailureStrategy = 'halt' | 'retry' | 'fallback' | 'continue';

/**
 * Retry policy for steps
 */
export interface RetryPolicy {
  /** Maximum number of retries */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  retryDelay?: number;
  /** Exponential backoff multiplier */
  backoffMultiplier?: number;
  /** Conditions under which to retry */
  retryConditions?: string[];
}

/**
 * Guardrail for the entire workflow
 */
export interface Guardrail {
  /** Guardrail type */
  type: 'schema' | 'uniqueness' | 'timing' | 'content_filter' | 'custom';
  /** Validation rule */
  rule: ValidationRule;
  /** Action on violation */
  onViolation: FailureStrategy;
}

/**
 * Validation rule for guardrails
 */
export interface ValidationRule {
  /** Rule name */
  name: string;
  /** Rule definition */
  rule: unknown;
}

/**
 * Execution context passed to workflow steps
 */
export interface ExecutionContext {
  /** Workflow run ID */
  workflowRunId: string;
  /** Session ID */
  sessionId: string;
  /** Project ID */
  projectId: string;
  /** User input */
  userInput: string;
  /** Results from previous steps */
  stepResults: Record<string, unknown>;
  /** Additional context */
  [key: string]: unknown;
}

/**
 * Step execution result
 */
export interface StepResult {
  /** Step ID */
  stepId: string;
  /** Whether step succeeded */
  success: boolean;
  /** Step output data */
  output?: unknown;
  /** Error if step failed */
  error?: string;
  /** Validation results */
  validation?: ValidationResult[];
  /** Execution metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Validation result for a step
 */
export interface ValidationResult {
  /** Validation rule name */
  rule: string;
  /** Whether validation passed */
  passed: boolean;
  /** Error message if validation failed */
  error?: string;
}

