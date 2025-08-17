/**
 * MCP Server Service for Policy Service
 *
 * Implements JSON-RPC 2.0 over WebSocket for Policy MCP protocol.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '@myloware/shared';
import type { PolicyService } from './policy.service';

const logger = createLogger('policy-service:mcp-server');

export class McpServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private isRunning = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly policyService: PolicyService
  ) {}

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting Policy MCP server', { host: this.host, port: this.port });

      this.wss = new WebSocketServer({
        host: this.host,
        port: this.port,
      });

      this.wss.on('connection', (ws: WebSocket) => {
        const clientId = this.generateClientId();
        this.clients.set(clientId, ws);

        logger.info('Policy MCP client connected', { clientId });

        ws.on('message', async (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());
            await this.handleMessage(clientId, ws, message);
          } catch (error) {
            logger.error('Error handling message', {
              clientId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        });

        ws.on('close', () => {
          this.clients.delete(clientId);
          logger.info('Policy MCP client disconnected', { clientId });
        });
      });

      this.isRunning = true;
      logger.info('Policy MCP server started successfully');
    } catch (error) {
      logger.error('Failed to start Policy MCP server', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(clientId: string, ws: WebSocket, message: any): Promise<void> {
    // Basic message handling - would be expanded with full MCP protocol
    logger.debug('Received policy MCP message', {
      clientId,
      method: message.method,
    });

    // Echo back for now
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        result: { received: true },
        id: message.id,
      })
    );
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `policy_client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping Policy MCP server');

      this.isRunning = false;

      for (const [clientId, ws] of this.clients) {
        ws.close();
      }

      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }

      logger.info('Policy MCP server stopped successfully');
    } catch (error) {
      logger.error('Error stopping Policy MCP server', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
