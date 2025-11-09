/**
 * Workflow Test Runner
 * 
 * Core test harness for invoking and monitoring n8n workflows in the test environment.
 * 
 * Usage:
 *   const runner = new WorkflowTestRunner('http://localhost:5679', 'http://localhost:3457');
 *   const result = await runner.runWorkflow({
 *     webhookPath: '/webhook/myloware/ingest',
 *     input: { message: 'Create AISMR video' },
 *     timeout: 60000
 *   });
 */

export interface WorkflowTestConfig {
  /** Webhook path to invoke (e.g., '/webhook/myloware/ingest') */
  webhookPath: string;
  
  /** Input data to send to the workflow */
  input: Record<string, unknown>;
  
  /** Maximum time to wait for workflow completion (ms) */
  timeout?: number;
  
  /** Poll interval for checking execution status (ms) */
  pollInterval?: number;
}

export interface WorkflowTestResult {
  /** Whether the workflow completed successfully */
  success: boolean;
  
  /** n8n execution ID */
  executionId?: string;
  
  /** Time taken to complete (ms) */
  duration: number;
  
  /** Trace data from MCP server */
  trace: {
    traceId: string;
    status: 'pending' | 'active' | 'completed' | 'failed';
    currentOwner: string;
    workflowStep: number;
    projectId: string;
    instructions: string;
    memories: Array<{
      content: string;
      persona: string[];
      memoryType: string;
      metadata?: Record<string, unknown>;
    }>;
    outputs: Record<string, unknown>;
    createdAt: string;
    completedAt?: string;
  };
  
  /** Error message if failed */
  error?: string;
}

export class WorkflowTestRunner {
  constructor(
    private n8nBaseUrl: string,
    private mcpBaseUrl: string
  ) {}

  /**
   * Run a workflow and wait for completion
   */
  async runWorkflow(config: WorkflowTestConfig): Promise<WorkflowTestResult> {
    const startTime = Date.now();
    const timeout = config.timeout || 60000;
    const pollInterval = config.pollInterval || 2000;

    try {
      // Step 1: Invoke workflow via webhook
      const webhookUrl = `${this.n8nBaseUrl}${config.webhookPath}`;
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config.input),
      });

      if (!response.ok) {
        throw new Error(`Webhook invocation failed: ${response.status} ${response.statusText}`);
      }

      const webhookResult = await response.json();
      
      // Extract traceId from response or input
      const traceId = webhookResult.traceId || config.input.traceId;
      if (!traceId) {
        throw new Error('No traceId returned from workflow');
      }

      // Step 2: Poll for completion
      await this.waitForCompletion(traceId, timeout - (Date.now() - startTime), pollInterval);

      // Step 3: Fetch final trace data
      const trace = await this.getTraceData(traceId);

      return {
        success: trace.status === 'completed',
        executionId: webhookResult.executionId,
        duration: Date.now() - startTime,
        trace,
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        trace: {
          traceId: config.input.traceId as string || 'unknown',
          status: 'failed',
          currentOwner: 'unknown',
          workflowStep: 0,
          projectId: 'unknown',
          instructions: '',
          memories: [],
          outputs: {},
          createdAt: new Date().toISOString(),
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Wait for workflow to complete by polling trace status
   */
  private async waitForCompletion(
    traceId: string,
    timeout: number,
    pollInterval: number
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const trace = await this.getTraceData(traceId);

      if (trace.status === 'completed' || trace.status === 'failed') {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Workflow timed out after ${timeout}ms`);
  }

  /**
   * Fetch trace data from MCP server
   */
  private async getTraceData(traceId: string): Promise<WorkflowTestResult['trace']> {
    // Query trace via MCP tools
    const response = await fetch(`${this.mcpBaseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.MCP_AUTH_KEY || 'test-mcp-auth-key',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'trace_prepare',
          arguments: {
            traceId,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch trace data: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.error) {
      throw new Error(`MCP error: ${result.error.message}`);
    }

    // Also fetch memories for this trace
    const memoriesResponse = await fetch(`${this.mcpBaseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.MCP_AUTH_KEY || 'test-mcp-auth-key',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'memory_search',
          arguments: {
            query: `traceId:${traceId}`,
            traceId,
            limit: 50,
          },
        },
      }),
    });

    const memoriesResult = await memoriesResponse.json();
    const memories = memoriesResult.result?.content?.[0]?.text 
      ? JSON.parse(memoriesResult.result.content[0].text).memories 
      : [];

    // Parse trace data from trace_prepare response
    const traceData = result.result?.content?.[0]?.text 
      ? JSON.parse(result.result.content[0].text)
      : {};

    return {
      traceId,
      status: traceData.status || 'pending',
      currentOwner: traceData.currentOwner || 'unknown',
      workflowStep: traceData.workflowStep || 0,
      projectId: traceData.projectId || 'unknown',
      instructions: traceData.instructions || '',
      memories,
      outputs: traceData.outputs || {},
      createdAt: traceData.createdAt || new Date().toISOString(),
      completedAt: traceData.completedAt,
    };
  }

  /**
   * Helper: Invoke workflow and return traceId immediately (don't wait)
   */
  async invokeWorkflow(config: Omit<WorkflowTestConfig, 'timeout'>): Promise<string> {
    const webhookUrl = `${this.n8nBaseUrl}${config.webhookPath}`;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config.input),
    });

    if (!response.ok) {
      throw new Error(`Webhook invocation failed: ${response.status}`);
    }

    const result = await response.json();
    return result.traceId || config.input.traceId as string;
  }

  /**
   * Helper: Get current trace status without waiting
   */
  async getTraceStatus(traceId: string): Promise<'pending' | 'active' | 'completed' | 'failed'> {
    const trace = await this.getTraceData(traceId);
    return trace.status;
  }
}

