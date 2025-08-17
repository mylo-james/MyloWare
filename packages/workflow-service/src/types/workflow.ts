/**
 * Workflow Types and Interfaces for MyloWare Temporal Implementation
 */

export interface WorkOrderInput {
  workOrderId: string;
  workItems: WorkItemInput[];
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  metadata?: Record<string, any>;
}

export interface WorkItemInput {
  workItemId: string;
  type: 'INVOICE' | 'TICKET' | 'STATUS_REPORT';
  content: string;
  metadata?: Record<string, any>;
}

export interface AttemptResult {
  attemptId: string;
  status: 'STARTED' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
  result?: any;
  error?: string;
  startTime: Date;
  endTime?: Date;
  agentId?: string;
  metadata?: Record<string, any>;
}

export interface WorkflowResult {
  workOrderId: string;
  status: 'COMPLETED' | 'FAILED';
  completedItems: string[];
  failedItems: string[];
  totalAttempts: number;
  totalDuration: number;
  errors?: string[];
}

// Activity Input/Output Types
export interface RecordGenInput {
  workOrderId: string;
  workItems: WorkItemInput[];
}

export interface RecordGenOutput {
  success: boolean;
  recordsCreated: number;
  errors?: string[] | undefined;
}

export interface ExtractorLLMInput {
  workItemId: string;
  content: string;
  type: 'INVOICE' | 'TICKET' | 'STATUS_REPORT';
  attemptId: string;
}

export interface ExtractorLLMOutput {
  success: boolean;
  extractedData: any;
  confidence: number;
  error?: string;
}

export interface JsonRestylerInput {
  workItemId: string;
  rawData: any;
  targetSchema: string;
  attemptId: string;
}

export interface JsonRestylerOutput {
  success: boolean;
  styledData: any;
  transformations: string[];
  error?: string;
}

export interface SchemaGuardInput {
  workItemId: string;
  data: any;
  schemaId: string;
  attemptId: string;
}

export interface SchemaGuardOutput {
  success: boolean;
  validationErrors?: string[];
  sanitizedData?: any;
}

export interface PersisterInput {
  workItemId: string;
  validatedData: any;
  attemptId: string;
}

export interface PersisterOutput {
  success: boolean;
  persistedRecordId?: string;
  error?: string;
}

export interface VerifierInput {
  workItemId: string;
  persistedRecordId: string;
  attemptId: string;
}

export interface VerifierOutput {
  success: boolean;
  verificationScore: number;
  issues?: string[] | undefined;
  error?: string;
}

// Workflow Configuration
export interface WorkflowConfig {
  taskQueue: string;
  namespace: string;
  retryPolicy: {
    maximumAttempts: number;
    initialInterval: string;
    maximumInterval: string;
    backoffCoefficient: number;
  };
  timeouts: {
    workflowExecutionTimeout: string;
    workflowRunTimeout: string;
    workflowTaskTimeout: string;
  };
}

// Activity Configuration
export interface ActivityConfig {
  taskQueue: string;
  retryPolicy: {
    maximumAttempts: number;
    initialInterval: string;
    maximumInterval: string;
    backoffCoefficient: number;
  };
  timeouts: {
    startToCloseTimeout: string;
    scheduleToStartTimeout: string;
    scheduleToCloseTimeout: string;
    heartbeatTimeout: string;
  };
}

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  taskQueue: 'myloware-tasks',
  namespace: 'default',
  retryPolicy: {
    maximumAttempts: 3,
    initialInterval: '1s',
    maximumInterval: '100s',
    backoffCoefficient: 2.0,
  },
  timeouts: {
    workflowExecutionTimeout: '1h',
    workflowRunTimeout: '30m',
    workflowTaskTimeout: '10s',
  },
};

export const DEFAULT_ACTIVITY_CONFIG: ActivityConfig = {
  taskQueue: 'myloware-tasks',
  retryPolicy: {
    maximumAttempts: 3,
    initialInterval: '1s',
    maximumInterval: '100s',
    backoffCoefficient: 2.0,
  },
  timeouts: {
    startToCloseTimeout: '5m',
    scheduleToStartTimeout: '1m',
    scheduleToCloseTimeout: '6m',
    heartbeatTimeout: '30s',
  },
};

// Temporal-compatible configurations
export const TEMPORAL_ACTIVITY_OPTIONS = {
  startToCloseTimeout: 300000, // 5 minutes in milliseconds
  scheduleToStartTimeout: 60000, // 1 minute in milliseconds
  scheduleToCloseTimeout: 360000, // 6 minutes in milliseconds
  heartbeatTimeout: 30000, // 30 seconds in milliseconds
  retry: {
    maximumAttempts: 3,
    initialInterval: 1000, // 1 second in milliseconds
    maximumInterval: 100000, // 100 seconds in milliseconds
    backoffCoefficient: 2.0,
  },
};

export const TEMPORAL_WORKFLOW_OPTIONS = {
  taskQueue: 'myloware-tasks',
  retry: {
    maximumAttempts: 3,
    initialInterval: 1000, // 1 second in milliseconds
    maximumInterval: 100000, // 100 seconds in milliseconds
    backoffCoefficient: 2.0,
  },
  workflowExecutionTimeout: 3600000, // 1 hour in milliseconds
  workflowRunTimeout: 1800000, // 30 minutes in milliseconds
  workflowTaskTimeout: 10000, // 10 seconds in milliseconds
};
