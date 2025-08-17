/**
 * Workflow Controller
 *
 * HTTP endpoints for workflow management and monitoring.
 */

import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { createLogger } from '@myloware/shared';
import { TemporalClientService } from '../services/temporal-client.service';
import { WorkOrderInput, WorkflowResult } from '../types/workflow';

const logger = createLogger('workflow-service:controller');

@Controller('workflows')
export class WorkflowController {
  constructor(private readonly temporalClient: TemporalClientService) {}

  /**
   * Start a new Docs Extract & Verify workflow
   */
  @Post('docs-extract-verify')
  async startDocsExtractVerifyWorkflow(
    @Body() workOrderInput: WorkOrderInput,
    @Query('workflowId') workflowId?: string
  ) {
    try {
      logger.info('Received workflow start request', {
        workOrderId: workOrderInput.workOrderId,
        itemCount: workOrderInput.workItems.length,
        priority: workOrderInput.priority,
        customWorkflowId: workflowId,
      });

      const handle = await this.temporalClient.startDocsExtractVerifyWorkflow(
        workOrderInput,
        workflowId
      );

      return {
        success: true,
        workflowId: handle.workflowId,
        message: 'Workflow started successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to start workflow', {
        workOrderId: workOrderInput.workOrderId,
        error: errorMessage,
      });

      throw new HttpException(
        {
          success: false,
          error: errorMessage,
          message: 'Failed to start workflow',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get workflow status
   */
  @Get(':workflowId/status')
  async getWorkflowStatus(@Param('workflowId') workflowId: string): Promise<WorkflowResult> {
    try {
      return await this.temporalClient.getWorkflowStatus(workflowId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get workflow status', { workflowId, error: errorMessage });

      throw new HttpException(
        {
          success: false,
          error: errorMessage,
          message: 'Failed to get workflow status',
        },
        HttpStatus.NOT_FOUND
      );
    }
  }

  /**
   * Get workflow progress
   */
  @Get(':workflowId/progress')
  async getWorkflowProgress(@Param('workflowId') workflowId: string) {
    try {
      return await this.temporalClient.getWorkflowProgress(workflowId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get workflow progress', { workflowId, error: errorMessage });

      throw new HttpException(
        {
          success: false,
          error: errorMessage,
          message: 'Failed to get workflow progress',
        },
        HttpStatus.NOT_FOUND
      );
    }
  }

  /**
   * Pause a workflow
   */
  @Put(':workflowId/pause')
  async pauseWorkflow(@Param('workflowId') workflowId: string) {
    try {
      await this.temporalClient.pauseWorkflow(workflowId);
      return {
        success: true,
        message: 'Workflow paused successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to pause workflow', { workflowId, error: errorMessage });

      throw new HttpException(
        {
          success: false,
          error: errorMessage,
          message: 'Failed to pause workflow',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Resume a workflow
   */
  @Put(':workflowId/resume')
  async resumeWorkflow(@Param('workflowId') workflowId: string) {
    try {
      await this.temporalClient.resumeWorkflow(workflowId);
      return {
        success: true,
        message: 'Workflow resumed successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to resume workflow', { workflowId, error: errorMessage });

      throw new HttpException(
        {
          success: false,
          error: errorMessage,
          message: 'Failed to resume workflow',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Cancel a workflow
   */
  @Delete(':workflowId')
  async cancelWorkflow(@Param('workflowId') workflowId: string) {
    try {
      await this.temporalClient.cancelWorkflow(workflowId);
      return {
        success: true,
        message: 'Workflow cancelled successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to cancel workflow', { workflowId, error: errorMessage });

      throw new HttpException(
        {
          success: false,
          error: errorMessage,
          message: 'Failed to cancel workflow',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * List all workflows
   */
  @Get()
  async listWorkflows() {
    try {
      const workflows = await this.temporalClient.listWorkflows();
      return {
        success: true,
        workflows,
        count: workflows.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list workflows', { error: errorMessage });

      throw new HttpException(
        {
          success: false,
          error: errorMessage,
          message: 'Failed to list workflows',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Wait for workflow completion
   */
  @Get(':workflowId/wait')
  async waitForWorkflowCompletion(
    @Param('workflowId') workflowId: string
  ): Promise<WorkflowResult> {
    try {
      return await this.temporalClient.waitForWorkflowCompletion(workflowId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to wait for workflow completion', { workflowId, error: errorMessage });

      throw new HttpException(
        {
          success: false,
          error: errorMessage,
          message: 'Failed to wait for workflow completion',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
