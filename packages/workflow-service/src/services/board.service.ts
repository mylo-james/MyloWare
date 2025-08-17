/**
 * Board MCP Service
 *
 * Manages work order dispensation, queue management, and routing for AI agents.
 * Implements the Board MCP protocol for work order distribution.
 */

import { createLogger } from '@myloware/shared';
import type { TemporalClientService } from './temporal-client.service';

const logger = createLogger('workflow-service:board');

export interface WorkOrderRequest {
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  type: 'INVOICE' | 'TICKET' | 'STATUS_REPORT';
  items: WorkItemData[];
  metadata?: Record<string, any>;
}

export interface WorkItemData {
  id: string;
  type: 'INVOICE' | 'TICKET' | 'STATUS_REPORT';
  content: any;
  metadata?: Record<string, any>;
}

export interface WorkOrder {
  id: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  type: 'INVOICE' | 'TICKET' | 'STATUS_REPORT';
  itemCount: number;
  assignedAgent?: string;
  workflowId?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

export interface WorkOrderAssignment {
  workOrderId: string;
  agentId: string;
  assignedAt: Date;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

export class BoardService {
  private workOrderQueue: WorkOrder[] = [];
  private assignments: Map<string, WorkOrderAssignment> = new Map();
  private agentWorkloads: Map<string, number> = new Map();

  constructor(private readonly temporalClient: TemporalClientService) {}

  /**
   * Initialize the board service
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Board MCP service');

      // Load existing work orders from database (simulation)
      await this.loadWorkOrders();

      logger.info('Board MCP service initialized successfully', {
        queueSize: this.workOrderQueue.length,
      });
    } catch (error) {
      logger.error('Failed to initialize Board MCP service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Create a new work order
   */
  async createWorkOrder(request: WorkOrderRequest): Promise<WorkOrder> {
    try {
      const workOrder: WorkOrder = {
        id: this.generateWorkOrderId(),
        priority: request.priority,
        status: 'PENDING',
        type: request.type,
        itemCount: request.items.length,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(request.metadata && { metadata: request.metadata }),
      };

      // Add to queue
      this.workOrderQueue.push(workOrder);

      // Sort queue by priority
      this.sortQueueByPriority();

      logger.info('Work order created', {
        workOrderId: workOrder.id,
        priority: workOrder.priority,
        type: workOrder.type,
        itemCount: workOrder.itemCount,
      });

      // Start workflow execution
      await this.startWorkflowForOrder(workOrder, request.items);

      return workOrder;
    } catch (error) {
      logger.error('Failed to create work order', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get next work order for an agent
   */
  async getNextWorkOrder(agentId: string): Promise<WorkOrder | null> {
    try {
      // Check agent workload
      const currentWorkload = this.agentWorkloads.get(agentId) || 0;
      const maxWorkload = 5; // Maximum concurrent work orders per agent

      if (currentWorkload >= maxWorkload) {
        logger.debug('Agent at maximum workload', { agentId, currentWorkload });
        return null;
      }

      // Find next available work order
      const availableOrder = this.workOrderQueue.find(
        order => order.status === 'PENDING' && !order.assignedAgent
      );

      if (!availableOrder) {
        logger.debug('No available work orders', { agentId });
        return null;
      }

      // Assign work order to agent
      availableOrder.assignedAgent = agentId;
      availableOrder.status = 'PROCESSING';
      availableOrder.updatedAt = new Date();

      // Track assignment
      const assignment: WorkOrderAssignment = {
        workOrderId: availableOrder.id,
        agentId,
        assignedAt: new Date(),
        priority: availableOrder.priority,
      };

      this.assignments.set(availableOrder.id, assignment);
      this.agentWorkloads.set(agentId, currentWorkload + 1);

      logger.info('Work order assigned to agent', {
        workOrderId: availableOrder.id,
        agentId,
        priority: availableOrder.priority,
      });

      return availableOrder;
    } catch (error) {
      logger.error('Failed to get next work order', {
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Update work order status
   */
  async updateWorkOrderStatus(
    workOrderId: string,
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED',
    agentId?: string
  ): Promise<void> {
    try {
      const workOrder = this.workOrderQueue.find(order => order.id === workOrderId);

      if (!workOrder) {
        throw new Error(`Work order not found: ${workOrderId}`);
      }

      const oldStatus = workOrder.status;
      workOrder.status = status;
      workOrder.updatedAt = new Date();

      // Update agent workload if completing or failing
      if ((status === 'COMPLETED' || status === 'FAILED') && workOrder.assignedAgent) {
        const currentWorkload = this.agentWorkloads.get(workOrder.assignedAgent) || 0;
        this.agentWorkloads.set(workOrder.assignedAgent, Math.max(0, currentWorkload - 1));

        // Remove assignment
        this.assignments.delete(workOrderId);
      }

      logger.info('Work order status updated', {
        workOrderId,
        oldStatus,
        newStatus: status,
        agentId: agentId || workOrder.assignedAgent,
      });
    } catch (error) {
      logger.error('Failed to update work order status', {
        workOrderId,
        status,
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get work order by ID
   */
  async getWorkOrder(workOrderId: string): Promise<WorkOrder | null> {
    const workOrder = this.workOrderQueue.find(order => order.id === workOrderId);
    return workOrder || null;
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    byPriority: Record<string, number>;
  } {
    const stats = {
      total: this.workOrderQueue.length,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      byPriority: {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
        URGENT: 0,
      },
    };

    for (const order of this.workOrderQueue) {
      stats[order.status.toLowerCase() as keyof typeof stats]++;
      stats.byPriority[order.priority]++;
    }

    return stats;
  }

  /**
   * Get agent assignments
   */
  getAgentAssignments(): {
    [agentId: string]: {
      workload: number;
      assignments: WorkOrderAssignment[];
    };
  } {
    const agentData: any = {};

    for (const [agentId, workload] of this.agentWorkloads) {
      agentData[agentId] = {
        workload,
        assignments: Array.from(this.assignments.values()).filter(
          assignment => assignment.agentId === agentId
        ),
      };
    }

    return agentData;
  }

  /**
   * Start workflow for work order
   */
  private async startWorkflowForOrder(workOrder: WorkOrder, items: WorkItemData[]): Promise<void> {
    try {
      // Start Temporal workflow for the work order
      const workflowId = `work_order_${workOrder.id}`;

      // Note: In a real implementation, this would start the actual Temporal workflow
      logger.info('Starting workflow for work order', {
        workOrderId: workOrder.id,
        workflowId,
        itemCount: items.length,
      });

      workOrder.workflowId = workflowId;
    } catch (error) {
      logger.error('Failed to start workflow for work order', {
        workOrderId: workOrder.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Sort queue by priority (URGENT > HIGH > MEDIUM > LOW)
   */
  private sortQueueByPriority(): void {
    const priorityOrder = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

    this.workOrderQueue.sort((a, b) => {
      // First sort by priority
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Then by creation time (older first)
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  /**
   * Load existing work orders from database (simulation)
   */
  private async loadWorkOrders(): Promise<void> {
    // In a real implementation, this would load from the database
    logger.debug('Loading existing work orders from database');

    // For now, start with empty queue
    this.workOrderQueue = [];
    this.assignments.clear();
    this.agentWorkloads.clear();
  }

  /**
   * Generate unique work order ID
   */
  private generateWorkOrderId(): string {
    return `wo_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Stop the board service
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping Board MCP service');

      // Save any pending state (in real implementation)

      logger.info('Board MCP service stopped successfully');
    } catch (error) {
      logger.error('Error stopping Board MCP service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
