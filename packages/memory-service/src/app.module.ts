/**
 * Memory Service App Module
 *
 * NestJS module configuration for the Memory MCP service.
 */

import { Module } from '@nestjs/common';
import { MemoryController } from './controllers/memory.controller';
import { HealthController } from './controllers/health.controller';
import { MemoryService } from './services/memory.service';
import { McpServer } from './services/mcp-server.service';

@Module({
  imports: [],
  controllers: [MemoryController, HealthController],
  providers: [],
})
export class MemoryModule {
  private memoryService: MemoryService | null = null;
  private mcpServer: McpServer | null = null;

  setServices(memoryService: MemoryService, mcpServer: McpServer): void {
    this.memoryService = memoryService;
    this.mcpServer = mcpServer;
  }

  getMemoryService(): MemoryService | null {
    return this.memoryService;
  }

  getMcpServer(): McpServer | null {
    return this.mcpServer;
  }
}
