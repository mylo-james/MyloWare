// Using built-in fetch (Node.js 18+)
import { withRetry, isRetryableError } from '../../utils/retry.js';
import { ExternalServiceError } from '../../utils/errors.js';
import { MAX_RETRIES, RETRY_INITIAL_DELAY_MS } from '../../utils/constants.js';

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

export interface WorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  isArchived?: boolean;
  updatedAt?: string;
}

export class N8nClient {
  constructor(private config: N8nConfig) {}

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    retry = true
  ): Promise<T> {
    const makeRequest = async (): Promise<T> => {
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
        const error = new Error(
          `n8n API error: ${response.status} ${response.statusText} - ${errorText}`
        );
        throw error;
      }

      return response.json() as Promise<T>;
    };

    if (retry) {
      return withRetry(makeRequest, {
        maxRetries: MAX_RETRIES,
        initialDelay: RETRY_INITIAL_DELAY_MS,
        backoff: 'exponential',
        retryable: (error) => {
          // Retry on network errors and 5xx errors
          if (isRetryableError(error)) {
            return true;
          }
          // Also retry on 429 (rate limit)
          if (error instanceof Error && error.message.includes('429')) {
            return true;
          }
          return false;
        },
      }).catch((error) => {
        throw new ExternalServiceError(
          `n8n API request failed: ${error instanceof Error ? error.message : String(error)}`,
          'n8n',
          error instanceof Error ? error : new Error(String(error))
        );
      });
    }

    return makeRequest().catch((error) => {
      throw new ExternalServiceError(
        `n8n API request failed: ${error instanceof Error ? error.message : String(error)}`,
        'n8n',
        error instanceof Error ? error : new Error(String(error))
      );
    });
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
    return this.request<ExecutionStatus>(
      'GET',
      `/api/v1/executions/${executionId}`
    );
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

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error('Workflow execution timeout');
  }

  async importWorkflow(workflow: unknown): Promise<string> {
    const result = await this.request<{ id: string }>(
      'POST',
      '/api/v1/workflows',
      workflow
    );
    return result.id;
  }

  async updateWorkflow(id: string, data: Record<string, unknown>): Promise<void> {
    await this.request<void>('PUT', `/api/v1/workflows/${id}`, data);
  }

  async activateWorkflow(id: string): Promise<void> {
    await this.request<void>('POST', `/api/v1/workflows/${id}/activate`);
  }

  async listWorkflows(limit = 250): Promise<WorkflowSummary[]> {
    const result = await this.request<{ data: WorkflowSummary[] }>(
      'GET',
      `/api/v1/workflows?limit=${limit}`
    );
    return result.data || [];
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

    const result = await this.request<{ data?: ExecutionStatus[] }>(
      'GET',
      `/api/v1/executions?${params}`
    );
    return result.data || [];
  }

  async invokeWebhook(
    webhookUrl: string,
    payload: unknown,
    options?: {
      method?: string;
      authType?: 'none' | 'header' | 'basic' | 'bearer';
      authConfig?: Record<string, unknown>;
      authToken?: string;
      authHeaderName?: string;
      timeoutMs?: number;
    }
  ): Promise<{ executionId?: string; status: string; data?: unknown }> {
    const method = options?.method || 'POST';
    const timeoutMs = options?.timeoutMs || 30000;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Handle authentication
    if (options?.authType && options.authType !== 'none') {
      if (options.authType === 'header') {
        const headerName =
          (options.authConfig?.headerName as string) ||
          options.authHeaderName ||
          'x-api-key';
        const token =
          (options.authConfig?.token as string) || options.authToken;
        if (token) {
          headers[headerName] = token;
        }
      } else if (options.authType === 'bearer') {
        const token =
          (options.authConfig?.token as string) || options.authToken;
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      } else if (options.authType === 'basic') {
        const username = options.authConfig?.username as string;
        const password = options.authConfig?.password as string;
        if (username && password) {
          const credentials = Buffer.from(`${username}:${password}`).toString(
            'base64'
          );
          headers['Authorization'] = `Basic ${credentials}`;
        }
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(webhookUrl, {
        method,
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `n8n webhook error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      return {
        executionId:
          typeof data.executionId === 'string'
            ? data.executionId
            : typeof data.id === 'string'
              ? data.id
              : undefined,
        status:
          response.status >= 200 && response.status < 300 ? 'success' : 'error',
        data,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Webhook timeout after ${timeoutMs}ms`);
      }
      throw new ExternalServiceError(
        `n8n webhook invocation failed: ${error instanceof Error ? error.message : String(error)}`,
        'n8n',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}
