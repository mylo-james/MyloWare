/**
 * MCP Server Service
 *
 * Implements JSON-RPC 2.0 over WebSocket for Model Context Protocol (MCP).
 * Provides the foundation for all MCP services communication.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '@myloware/shared';
import type { MemoryService } from './memory.service';

const logger = createLogger('memory-service:mcp-server');

// JSON-RPC 2.0 Types
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id?: string | number | null;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: JsonRpcError;
  id: string | number | null;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

// MCP Protocol Types
export interface McpCapability {
  name: string;
  version: string;
  description: string;
}

export interface McpClientInfo {
  name: string;
  version: string;
  capabilities: McpCapability[];
}

export interface McpServerInfo {
  name: string;
  version: string;
  capabilities: McpCapability[];
}

export class McpServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private isRunning = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly memoryService: MemoryService
  ) {}

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting MCP server', { host: this.host, port: this.port });

      this.wss = new WebSocketServer({
        host: this.host,
        port: this.port,
      });

      this.wss.on('connection', (ws: WebSocket, request) => {
        const clientId = this.generateClientId();
        this.clients.set(clientId, ws);

        logger.info('MCP client connected', {
          clientId,
          remoteAddress: request.socket.remoteAddress,
        });

        ws.on('message', async (data: Buffer) => {
          await this.handleMessage(clientId, ws, data);
        });

        ws.on('close', () => {
          this.clients.delete(clientId);
          logger.info('MCP client disconnected', { clientId });
        });

        ws.on('error', error => {
          logger.error('MCP client error', {
            clientId,
            error: error.message,
          });
          this.clients.delete(clientId);
        });

        // Send server capabilities on connection
        this.sendServerInfo(ws);
      });

      this.isRunning = true;
      logger.info('MCP server started successfully', {
        host: this.host,
        port: this.port,
      });
    } catch (error) {
      logger.error('Failed to start MCP server', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private async handleMessage(clientId: string, ws: WebSocket, data: Buffer): Promise<void> {
    try {
      const message = JSON.parse(data.toString());
      logger.debug('Received MCP message', {
        clientId,
        method: message.method,
        id: message.id,
      });

      // Validate JSON-RPC 2.0 format
      if (message.jsonrpc !== '2.0') {
        this.sendError(ws, message.id, -32600, 'Invalid Request', 'jsonrpc must be "2.0"');
        return;
      }

      // Handle request
      if (message.id !== undefined) {
        await this.handleRequest(clientId, ws, message as JsonRpcRequest);
      } else {
        await this.handleNotification(clientId, message as JsonRpcNotification);
      }
    } catch (error) {
      logger.error('Error handling MCP message', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      this.sendError(ws, null, -32700, 'Parse error', 'Invalid JSON');
    }
  }

  /**
   * Handle JSON-RPC requests
   */
  private async handleRequest(
    clientId: string,
    ws: WebSocket,
    request: JsonRpcRequest
  ): Promise<void> {
    try {
      let result: any;

      switch (request.method) {
        case 'initialize':
          result = await this.handleInitialize(request.params);
          break;

        case 'memory/store':
          result = await this.handleMemoryStore(request.params);
          break;

        case 'memory/retrieve':
          result = await this.handleMemoryRetrieve(request.params);
          break;

        case 'memory/search':
          result = await this.handleMemorySearch(request.params);
          break;

        case 'memory/list':
          result = await this.handleMemoryList(request.params);
          break;

        case 'memory/delete':
          result = await this.handleMemoryDelete(request.params);
          break;

        case 'capabilities':
          result = this.getServerCapabilities();
          break;

        default:
          this.sendError(
            ws,
            request.id || null,
            -32601,
            'Method not found',
            `Unknown method: ${request.method}`
          );
          return;
      }

      this.sendResponse(ws, request.id || null, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error handling MCP request', {
        clientId,
        method: request.method,
        id: request.id,
        error: errorMessage,
      });

      this.sendError(ws, request.id || null, -32603, 'Internal error', errorMessage);
    }
  }

  /**
   * Handle JSON-RPC notifications
   */
  private async handleNotification(
    clientId: string,
    notification: JsonRpcNotification
  ): Promise<void> {
    try {
      logger.debug('Handling MCP notification', {
        clientId,
        method: notification.method,
      });

      switch (notification.method) {
        case 'heartbeat':
          // Handle heartbeat - no response needed
          break;

        case 'client/initialized':
          logger.info('MCP client initialized', { clientId });
          break;

        default:
          logger.warn('Unknown notification method', {
            clientId,
            method: notification.method,
          });
      }
    } catch (error) {
      logger.error('Error handling MCP notification', {
        clientId,
        method: notification.method,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(params: any): Promise<McpServerInfo> {
    logger.info('MCP client initializing', { clientInfo: params });

    return {
      name: 'MyloWare Memory Service',
      version: '1.0.0',
      capabilities: this.getServerCapabilities(),
    };
  }

  /**
   * Handle memory store request
   */
  private async handleMemoryStore(params: any): Promise<{ success: boolean; documentId: string }> {
    const { content, metadata, tags } = params;

    const result = await this.memoryService.storeDocument(content, metadata, tags);

    return {
      success: true,
      documentId: result.id,
    };
  }

  /**
   * Handle memory retrieve request
   */
  private async handleMemoryRetrieve(params: any): Promise<any> {
    const { documentId } = params;

    const document = await this.memoryService.getDocument(documentId);

    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    return document;
  }

  /**
   * Handle memory search request
   */
  private async handleMemorySearch(params: any): Promise<any[]> {
    const { query, limit = 10, threshold = 0.7 } = params;

    const results = await this.memoryService.searchDocuments(query, limit, threshold);

    return results;
  }

  /**
   * Handle memory list request
   */
  private async handleMemoryList(params: any): Promise<any[]> {
    const { limit = 50, offset = 0, tags } = params;

    const documents = await this.memoryService.listDocuments(limit, offset, tags);

    return documents;
  }

  /**
   * Handle memory delete request
   */
  private async handleMemoryDelete(params: any): Promise<{ success: boolean }> {
    const { documentId } = params;

    await this.memoryService.deleteDocument(documentId);

    return { success: true };
  }

  /**
   * Get server capabilities
   */
  private getServerCapabilities(): McpCapability[] {
    return [
      {
        name: 'memory/store',
        version: '1.0.0',
        description: 'Store documents in memory with vector embeddings',
      },
      {
        name: 'memory/retrieve',
        version: '1.0.0',
        description: 'Retrieve documents by ID',
      },
      {
        name: 'memory/search',
        version: '1.0.0',
        description: 'Search documents using vector similarity',
      },
      {
        name: 'memory/list',
        version: '1.0.0',
        description: 'List documents with pagination and filtering',
      },
      {
        name: 'memory/delete',
        version: '1.0.0',
        description: 'Delete documents by ID',
      },
    ];
  }

  /**
   * Send server info to client
   */
  private sendServerInfo(ws: WebSocket): void {
    const serverInfo: McpServerInfo = {
      name: 'MyloWare Memory Service',
      version: '1.0.0',
      capabilities: this.getServerCapabilities(),
    };

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: 'server/info',
      params: serverInfo,
    };

    ws.send(JSON.stringify(notification));
  }

  /**
   * Send JSON-RPC response
   */
  private sendResponse(ws: WebSocket, id: string | number | null, result: any): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      result,
      id,
    };

    ws.send(JSON.stringify(response));
  }

  /**
   * Send JSON-RPC error
   */
  private sendError(
    ws: WebSocket,
    id: string | number | null,
    code: number,
    message: string,
    data?: any
  ): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      error: {
        code,
        message,
        data,
      },
      id,
    };

    ws.send(JSON.stringify(response));
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping MCP server');

      this.isRunning = false;

      // Close all client connections
      for (const [clientId, ws] of this.clients) {
        ws.close();
        logger.debug('Closed client connection', { clientId });
      }

      // Close WebSocket server
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }

      logger.info('MCP server stopped successfully');
    } catch (error) {
      logger.error('Error stopping MCP server', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get server health status
   */
  getHealthStatus(): {
    isRunning: boolean;
    clientCount: number;
    port: number;
  } {
    return {
      isRunning: this.isRunning,
      clientCount: this.clients.size,
      port: this.port,
    };
  }
}
