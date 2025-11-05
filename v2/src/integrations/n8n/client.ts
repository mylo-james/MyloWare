// Using built-in fetch (Node.js 18+)

export interface N8nConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface ExecutionStatus {
  id: string;
  workflowId: string;
  status: 'running' | 'success' | 'error' | 'waiting';
  data?: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export class N8nClient {
  constructor(private config: N8nConfig) {}

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (this.config.apiKey) {
      headers['X-N8N-API-KEY'] = this.config.apiKey;
    }

    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`n8n API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async executeWorkflow(workflowId: string, data: unknown): Promise<string> {
    const result = await this.request<{ executionId?: string; id?: string }>(
      'POST',
      `/api/v1/workflows/${workflowId}/execute`,
      { data }
    );
    return result.executionId || result.id || '';
  }

  async getExecutionStatus(executionId: string): Promise<ExecutionStatus> {
    return this.request<ExecutionStatus>('GET', `/api/v1/executions/${executionId}`);
  }

  async waitForCompletion(
    executionId: string,
    timeout: number,
    pollInterval = 2000
  ): Promise<unknown> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const status = await this.getExecutionStatus(executionId);
      
      if (status.status === 'success') {
        return status.data;
      }
      
      if (status.status === 'error') {
        throw new Error(status.error || 'Workflow execution failed');
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    throw new Error('Workflow execution timeout');
  }

  async importWorkflow(workflow: unknown): Promise<string> {
    const result = await this.request<{ id: string }>('POST', '/api/v1/workflows', workflow);
    return result.id;
  }

  async listExecutions(filter?: {
    workflowId?: string;
    status?: string;
    limit?: number;
  }): Promise<ExecutionStatus[]> {
    const params = new URLSearchParams();
    if (filter?.workflowId) params.set('workflow', filter.workflowId);
    if (filter?.status) params.set('status', filter.status);
    if (filter?.limit) params.set('limit', filter.limit.toString());
    
    const result = await this.request<{ data?: ExecutionStatus[] }>('GET', `/api/v1/executions?${params}`);
    return result.data || [];
  }
}

