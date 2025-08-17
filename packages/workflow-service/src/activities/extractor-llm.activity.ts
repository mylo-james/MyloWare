/**
 * ExtractorLLM Activity
 *
 * Extracts structured data from documents using Large Language Models.
 * This activity processes document content and extracts relevant information
 * based on the document type (invoice, ticket, status report).
 */

import { Context, log } from '@temporalio/activity';
import { createLogger } from '@myloware/shared';
import type { ExtractorLLMInput, ExtractorLLMOutput } from '../types/workflow';

const logger = createLogger('workflow-service:extractor-llm');

export async function extractorLLMActivity(input: ExtractorLLMInput): Promise<ExtractorLLMOutput> {
  const { workItemId, content, type, attemptId } = input;

  log.info('Starting ExtractorLLM activity', {
    workItemId,
    type,
    attemptId,
    contentLength: content.length,
    activityId: Context.current().info.activityId,
  });

  try {
    // Simulate LLM extraction process
    // In a real implementation, this would:
    // 1. Call OpenAI/Claude API with document content
    // 2. Use type-specific prompts for extraction
    // 3. Parse and structure the response
    // 4. Calculate confidence scores

    logger.info('Processing document with LLM', { workItemId, type, attemptId });

    // Simulate processing time based on content length
    const processingTime = Math.min(content.length / 100, 5000); // Max 5 seconds
    await new Promise(resolve => setTimeout(resolve, processingTime));

    // Heartbeat during processing
    Context.current().heartbeat({
      workItemId,
      status: 'processing',
      progress: 50,
    });

    // Simulate extraction based on document type
    let extractedData: any;
    let confidence: number;

    switch (type) {
      case 'INVOICE':
        extractedData = {
          invoiceNumber: `INV-${Date.now()}`,
          amount: Math.floor(Math.random() * 10000) / 100,
          currency: 'USD',
          date: new Date().toISOString().split('T')[0],
          vendor: 'Sample Vendor',
          items: [
            { description: 'Sample Item 1', quantity: 1, unitPrice: 100.0 },
            { description: 'Sample Item 2', quantity: 2, unitPrice: 50.0 },
          ],
        };
        confidence = 0.85 + Math.random() * 0.1; // 85-95% confidence
        break;

      case 'TICKET':
        extractedData = {
          ticketId: `TKT-${Date.now()}`,
          title: 'Sample Support Ticket',
          priority: 'MEDIUM',
          status: 'OPEN',
          description: content.substring(0, 200),
          category: 'Technical',
          assignee: null,
          createdDate: new Date().toISOString(),
        };
        confidence = 0.8 + Math.random() * 0.15; // 80-95% confidence
        break;

      case 'STATUS_REPORT':
        extractedData = {
          reportId: `RPT-${Date.now()}`,
          title: 'Sample Status Report',
          period: 'Weekly',
          status: 'IN_PROGRESS',
          summary: content.substring(0, 300),
          metrics: {
            tasksCompleted: Math.floor(Math.random() * 20),
            tasksInProgress: Math.floor(Math.random() * 10),
            issuesFound: Math.floor(Math.random() * 5),
          },
          createdDate: new Date().toISOString(),
        };
        confidence = 0.75 + Math.random() * 0.2; // 75-95% confidence
        break;

      default:
        throw new Error(`Unsupported document type: ${type}`);
    }

    // Simulate potential extraction failures
    if (Math.random() < 0.03) {
      // 3% chance of failure
      throw new Error(`LLM extraction failed for document type ${type}: API timeout`);
    }

    Context.current().heartbeat({
      workItemId,
      status: 'completed',
      progress: 100,
    });

    const result: ExtractorLLMOutput = {
      success: true,
      extractedData,
      confidence,
    };

    log.info('ExtractorLLM activity completed successfully', {
      workItemId,
      type,
      attemptId,
      confidence,
    });

    logger.info('LLM extraction completed', {
      workItemId,
      type,
      confidence,
      dataKeys: Object.keys(extractedData),
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error in ExtractorLLM';

    log.error('ExtractorLLM activity failed', {
      workItemId,
      type,
      attemptId,
      error: errorMessage,
      activityId: Context.current().info.activityId,
    });

    logger.error('LLM extraction failed', { workItemId, type, error: errorMessage });

    return {
      success: false,
      extractedData: null,
      confidence: 0,
      error: errorMessage,
    };
  }
}
