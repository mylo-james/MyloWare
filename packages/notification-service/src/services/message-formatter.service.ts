/**
 * Message Formatter Service
 *
 * Provides consistent formatting utilities for Slack messages, status tags,
 * and metadata blocks used by the notification threading system.
 */

export type RunStatusTag = 'STARTED' | 'IN_PROGRESS' | 'DONE' | 'ERROR';

export class MessageFormatterService {
  formatRunStatusTag(runId: string, status: RunStatusTag): string {
    return `[RUN ${runId}][${status}]`;
  }

  formatApprovalStatusTag(approvalId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED'): string {
    return `[APPROVAL ${approvalId}][${status}]`;
  }

  formatRunMetadataTable(metadata: {
    status?: string;
    started?: string;
    duration?: string;
    agent?: string;
    progress?: string;
  }): string {
    const lines: string[] = [
      '📊 *Run Details*',
      ...(metadata.status ? [`• Status: ${metadata.status}`] : []),
      ...(metadata.started ? [`• Started: ${metadata.started}`] : []),
      ...(metadata.duration ? [`• Duration: ${metadata.duration}`] : []),
      ...(metadata.agent ? [`• Agent: ${metadata.agent}`] : []),
      ...(metadata.progress ? [`• Progress: ${metadata.progress}`] : []),
    ];
    return lines.join('\n');
  }

  formatInitialRunMessage(
    runId: string,
    message: string,
    metadata?: {
      status?: string;
      started?: string;
      duration?: string;
      agent?: string;
      progress?: string;
    }
  ): string {
    const header = this.formatRunStatusTag(runId, 'STARTED');
    const body = message;
    const meta = metadata ? `\n\n${this.formatRunMetadataTable(metadata)}` : '';
    return `${header}\n${body}${meta}`;
  }

  formatRunUpdateMessage(
    runId: string,
    status: RunStatusTag,
    message: string,
    metadata?: {
      status?: string;
      started?: string;
      duration?: string;
      agent?: string;
      progress?: string;
    }
  ): string {
    const header = this.formatRunStatusTag(runId, status);
    const meta = metadata ? `\n\n${this.formatRunMetadataTable(metadata)}` : '';
    return `${header}\n${message}${meta}`;
  }
}
