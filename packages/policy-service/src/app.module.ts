/**
 * Policy Service App Module
 *
 * NestJS module configuration for the Policy MCP service.
 */

import { Module } from '@nestjs/common';
import { PolicyController } from './controllers/policy.controller';
import { HealthController } from './controllers/health.controller';
import { PolicyService } from './services/policy.service';
import { McpServer } from './services/mcp-server.service';

@Module({
  imports: [],
  controllers: [PolicyController, HealthController],
  providers: [],
})
export class PolicyModule {
  private policyService: PolicyService | null = null;
  private mcpServer: McpServer | null = null;

  setServices(policyService: PolicyService, mcpServer: McpServer): void {
    this.policyService = policyService;
    this.mcpServer = mcpServer;
  }

  getPolicyService(): PolicyService | null {
    return this.policyService;
  }

  getMcpServer(): McpServer | null {
    return this.mcpServer;
  }
}
