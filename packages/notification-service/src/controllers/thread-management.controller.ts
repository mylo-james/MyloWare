/**
 * Thread Management Controller
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { createLogger } from '@myloware/shared';
import type { ThreadManagerService } from '../services/thread-manager.service';

const logger = createLogger('notification-service:thread-controller');

@Controller('threads')
export class ThreadManagementController {
  constructor(private readonly threadManager: ThreadManagerService) {}

  @Post('create')
  async createThread(
    @Body()
    body: {
      run_id: string;
      message: string;
      metadata?: Record<string, any>;
    }
  ) {
    try {
      const ctx = await this.threadManager.createRunThread(
        body.run_id,
        body.message,
        body.metadata
      );
      return ctx;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create thread', { error: errorMessage });
      throw new HttpException(
        { message: 'Failed to create thread', error: errorMessage },
        HttpStatus.BAD_REQUEST
      );
    }
  }

  @Get(':run_id')
  async getThread(@Param('run_id') runId: string) {
    const ctx = await this.threadManager.getThreadContext(runId);
    if (!ctx) {
      throw new HttpException({ message: 'Thread not found' }, HttpStatus.NOT_FOUND);
    }
    return ctx;
  }

  @Post(':run_id/update')
  async updateThread(
    @Param('run_id') runId: string,
    @Body()
    body: {
      message: string;
      status?: 'STARTED' | 'IN_PROGRESS' | 'DONE' | 'ERROR';
      metadata?: Record<string, any>;
    }
  ) {
    const options: {
      status?: 'STARTED' | 'IN_PROGRESS' | 'DONE' | 'ERROR';
      metadata?: Record<string, any>;
    } = {};
    if (body.status !== undefined) options.status = body.status;
    if (body.metadata !== undefined) options.metadata = body.metadata;
    await this.threadManager.updateRunThread(runId, body.message, options);
    return { success: true };
  }

  @Delete(':run_id')
  async archiveThread(@Param('run_id') runId: string) {
    await this.threadManager.archiveThread(runId);
    return { success: true };
  }
}
