/**
 * Policy Controller
 *
 * HTTP API endpoints for policy management and HITL approvals.
 */

import { Controller, Get, Post, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { createLogger } from '@myloware/shared';

const logger = createLogger('policy-service:controller');

@Controller('policies')
export class PolicyController {
  /**
   * Evaluate a policy
   */
  @Post('evaluate')
  async evaluatePolicy(
    @Body()
    body: {
      policyId: string;
      context: Record<string, any>;
      requestedBy: string;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    }
  ): Promise<any> {
    try {
      logger.info('Evaluating policy via API', {
        policyId: body.policyId,
        requestedBy: body.requestedBy,
      });

      // Simulate policy evaluation
      const evaluation = {
        id: `eval_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        policyId: body.policyId,
        decision: 'APPROVED',
        reason: 'Policy conditions met',
        requiresHumanApproval: false,
      };

      logger.info('Policy evaluation completed via API', {
        evaluationId: evaluation.id,
        decision: evaluation.decision,
      });

      return evaluation;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('API policy evaluation error', { error: errorMessage });

      throw new HttpException(
        { message: 'Failed to evaluate policy', error: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get policy by ID
   */
  @Get(':id')
  async getPolicy(@Param('id') policyId: string): Promise<any> {
    try {
      logger.info('Getting policy via API', { policyId });

      // Simulate policy retrieval
      const policy = {
        id: policyId,
        name: 'Sample Policy',
        description: 'A sample policy for demonstration',
        version: '1.0.0',
        isActive: true,
        conditions: [],
        actions: [],
      };

      return policy;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('API policy retrieval error', { policyId, error: errorMessage });

      throw new HttpException(
        { message: 'Failed to get policy', error: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get pending approvals for an approver
   */
  @Get('approvals/pending/:approver')
  async getPendingApprovals(@Param('approver') approver: string): Promise<any[]> {
    try {
      logger.info('Getting pending approvals via API', { approver });

      // Simulate pending approvals
      const approvals = [
        {
          id: 'approval_001',
          policyId: 'policy_001',
          status: 'PENDING',
          priority: 'HIGH',
          createdAt: new Date().toISOString(),
        },
      ];

      return approvals;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('API pending approvals error', { approver, error: errorMessage });

      throw new HttpException(
        { message: 'Failed to get pending approvals', error: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
