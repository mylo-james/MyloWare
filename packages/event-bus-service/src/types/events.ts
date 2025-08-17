/**
 * Event Types and Interfaces for MyloWare Event Bus
 */

// Base Event Interface
export interface BaseEvent {
  id: string;
  type: string;
  timestamp: string;
  version: string;
  source: string;
  correlationId?: string;
  causationId?: string;
  metadata?: Record<string, any>;
}

// Event Data Interfaces
export interface WorkOrderCreatedData {
  workOrderId: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  itemCount: number;
  metadata?: Record<string, any>;
}

export interface WorkOrderStatusChangedData {
  workOrderId: string;
  oldStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  newStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  reason?: string;
  metadata?: Record<string, any>;
}

export interface WorkItemProcessingStartedData {
  workOrderId: string;
  workItemId: string;
  type: 'INVOICE' | 'TICKET' | 'STATUS_REPORT';
  agentId?: string;
  metadata?: Record<string, any>;
}

export interface WorkItemProcessingCompletedData {
  workOrderId: string;
  workItemId: string;
  result: any;
  processingTime: number;
  agentId?: string;
  metadata?: Record<string, any>;
}

export interface WorkItemProcessingFailedData {
  workOrderId: string;
  workItemId: string;
  error: string;
  retryCount: number;
  agentId?: string;
  metadata?: Record<string, any>;
}

export interface AttemptStartedData {
  workOrderId: string;
  workItemId: string;
  attemptId: string;
  activityName: string;
  agentId?: string;
  metadata?: Record<string, any>;
}

export interface AttemptCompletedData {
  workOrderId: string;
  workItemId: string;
  attemptId: string;
  activityName: string;
  result: any;
  duration: number;
  agentId?: string;
  metadata?: Record<string, any>;
}

export interface AttemptFailedData {
  workOrderId: string;
  workItemId: string;
  attemptId: string;
  activityName: string;
  error: string;
  retryCount: number;
  agentId?: string;
  metadata?: Record<string, any>;
}

export interface AttemptRetriedData {
  workOrderId: string;
  workItemId: string;
  attemptId: string;
  activityName: string;
  retryCount: number;
  nextRetryAt: string;
  agentId?: string;
  metadata?: Record<string, any>;
}

export interface SystemHealthCheckData {
  service: string;
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  checks: Record<string, boolean>;
  metadata?: Record<string, any>;
}

export interface SystemErrorData {
  service: string;
  error: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  stackTrace?: string;
  metadata?: Record<string, any>;
}

export interface SystemMaintenanceData {
  service: string;
  maintenanceType: 'scheduled' | 'emergency';
  startTime: string;
  estimatedDuration: number;
  description: string;
  metadata?: Record<string, any>;
}

// Specific Event Types
export interface WorkOrderCreatedEvent extends BaseEvent {
  type: 'work_order.created';
  data: WorkOrderCreatedData;
}

export interface WorkOrderStatusChangedEvent extends BaseEvent {
  type: 'work_order.status_changed';
  data: WorkOrderStatusChangedData;
}

export interface WorkItemProcessingStartedEvent extends BaseEvent {
  type: 'work_item.processing_started';
  data: WorkItemProcessingStartedData;
}

export interface WorkItemProcessingCompletedEvent extends BaseEvent {
  type: 'work_item.processing_completed';
  data: WorkItemProcessingCompletedData;
}

export interface WorkItemProcessingFailedEvent extends BaseEvent {
  type: 'work_item.processing_failed';
  data: WorkItemProcessingFailedData;
}

export interface AttemptStartedEvent extends BaseEvent {
  type: 'attempt.started';
  data: AttemptStartedData;
}

export interface AttemptCompletedEvent extends BaseEvent {
  type: 'attempt.completed';
  data: AttemptCompletedData;
}

export interface AttemptFailedEvent extends BaseEvent {
  type: 'attempt.failed';
  data: AttemptFailedData;
}

export interface AttemptRetriedEvent extends BaseEvent {
  type: 'attempt.retried';
  data: AttemptRetriedData;
}

export interface SystemHealthCheckEvent extends BaseEvent {
  type: 'system.health_check';
  data: SystemHealthCheckData;
}

export interface SystemErrorEvent extends BaseEvent {
  type: 'system.error';
  data: SystemErrorData;
}

export interface SystemMaintenanceEvent extends BaseEvent {
  type: 'system.maintenance';
  data: SystemMaintenanceData;
}

// Union type for all events
export type MyloWareEvent =
  | WorkOrderCreatedEvent
  | WorkOrderStatusChangedEvent
  | WorkItemProcessingStartedEvent
  | WorkItemProcessingCompletedEvent
  | WorkItemProcessingFailedEvent
  | AttemptStartedEvent
  | AttemptCompletedEvent
  | AttemptFailedEvent
  | AttemptRetriedEvent
  | SystemHealthCheckEvent
  | SystemErrorEvent
  | SystemMaintenanceEvent;

// Event Type Constants
export const EVENT_TYPES = {
  WORK_ORDER_CREATED: 'work_order.created',
  WORK_ORDER_STATUS_CHANGED: 'work_order.status_changed',
  WORK_ITEM_PROCESSING_STARTED: 'work_item.processing_started',
  WORK_ITEM_PROCESSING_COMPLETED: 'work_item.processing_completed',
  WORK_ITEM_PROCESSING_FAILED: 'work_item.processing_failed',
  ATTEMPT_STARTED: 'attempt.started',
  ATTEMPT_COMPLETED: 'attempt.completed',
  ATTEMPT_FAILED: 'attempt.failed',
  ATTEMPT_RETRIED: 'attempt.retried',
  SYSTEM_HEALTH_CHECK: 'system.health_check',
  SYSTEM_ERROR: 'system.error',
  SYSTEM_MAINTENANCE: 'system.maintenance',
} as const;

// Stream Configuration
export interface StreamConfig {
  streamName: string;
  maxLength: number;
  consumerGroup: string;
  consumerName: string;
  blockTime: number;
  batchSize: number;
}

// Consumer Configuration
export interface ConsumerConfig {
  groupName: string;
  consumerName: string;
  streams: string[];
  blockTime: number;
  batchSize: number;
  retryAttempts: number;
  retryDelay: number;
}

// Publisher Configuration
export interface PublisherConfig {
  streamName: string;
  maxLength: number;
  batchSize: number;
  flushInterval: number;
}

// Outbox Pattern Types
export interface OutboxEntry {
  id: string;
  eventType: string;
  eventData: any;
  streamName: string;
  createdAt: Date;
  publishedAt?: Date;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: Date;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED' | 'DEAD_LETTER';
}

// Dead Letter Queue Types
export interface DeadLetterEntry {
  id: string;
  originalEventId: string;
  eventType: string;
  eventData: any;
  streamName: string;
  error: string;
  failedAt: Date;
  retryCount: number;
  metadata?: Record<string, any>;
}

// Event Bus Configuration
export interface EventBusConfig {
  redisUrl: string;
  streams: {
    workOrders: StreamConfig;
    workItems: StreamConfig;
    attempts: StreamConfig;
    system: StreamConfig;
    deadLetter: StreamConfig;
  };
  outbox: {
    tableName: string;
    batchSize: number;
    flushInterval: number;
    maxRetries: number;
    retryDelay: number;
  };
  consumers: {
    [key: string]: ConsumerConfig;
  };
}

export const DEFAULT_EVENT_BUS_CONFIG: EventBusConfig = {
  redisUrl: 'redis://localhost:6379',
  streams: {
    workOrders: {
      streamName: 'myloware:work_orders',
      maxLength: 10000,
      consumerGroup: 'work_order_processors',
      consumerName: 'processor_1',
      blockTime: 5000,
      batchSize: 10,
    },
    workItems: {
      streamName: 'myloware:work_items',
      maxLength: 50000,
      consumerGroup: 'work_item_processors',
      consumerName: 'processor_1',
      blockTime: 5000,
      batchSize: 20,
    },
    attempts: {
      streamName: 'myloware:attempts',
      maxLength: 100000,
      consumerGroup: 'attempt_processors',
      consumerName: 'processor_1',
      blockTime: 5000,
      batchSize: 50,
    },
    system: {
      streamName: 'myloware:system',
      maxLength: 5000,
      consumerGroup: 'system_processors',
      consumerName: 'processor_1',
      blockTime: 5000,
      batchSize: 5,
    },
    deadLetter: {
      streamName: 'myloware:dead_letter',
      maxLength: 10000,
      consumerGroup: 'dead_letter_processors',
      consumerName: 'processor_1',
      blockTime: 10000,
      batchSize: 5,
    },
  },
  outbox: {
    tableName: 'event_outbox',
    batchSize: 100,
    flushInterval: 1000,
    maxRetries: 5,
    retryDelay: 5000,
  },
  consumers: {
    workOrderProcessor: {
      groupName: 'work_order_processors',
      consumerName: 'processor_1',
      streams: ['myloware:work_orders'],
      blockTime: 5000,
      batchSize: 10,
      retryAttempts: 3,
      retryDelay: 1000,
    },
    workItemProcessor: {
      groupName: 'work_item_processors',
      consumerName: 'processor_1',
      streams: ['myloware:work_items'],
      blockTime: 5000,
      batchSize: 20,
      retryAttempts: 3,
      retryDelay: 1000,
    },
    attemptProcessor: {
      groupName: 'attempt_processors',
      consumerName: 'processor_1',
      streams: ['myloware:attempts'],
      blockTime: 5000,
      batchSize: 50,
      retryAttempts: 3,
      retryDelay: 1000,
    },
    systemProcessor: {
      groupName: 'system_processors',
      consumerName: 'processor_1',
      streams: ['myloware:system'],
      blockTime: 5000,
      batchSize: 5,
      retryAttempts: 5,
      retryDelay: 2000,
    },
  },
};
