/**
 * Example: How to use environment variables in background agents
 * 
 * This file demonstrates the recommended patterns for loading and using
 * environment variables in MyloWare background agents.
 */

import { 
  loadEnvironmentVariables, 
  getEnv, 
  validateEnvironmentVariables,
  EnvLoader 
} from './env-loader';

/**
 * Example: Basic Agent with Environment Variables
 */
export class ExampleBackgroundAgent {
  private databaseUrl: string;
  private redisUrl: string;
  private temporalConfig: {
    host: string;
    port: number;
    namespace: string;
    taskQueue: string;
  };

  constructor() {
    // Load environment variables at startup
    loadEnvironmentVariables();
    
    // Validate environment configuration
    const validation = validateEnvironmentVariables();
    if (!validation.valid) {
      console.error('❌ Environment configuration errors:');
      validation.errors.forEach(error => {
        console.error(`  - ${error}`);
      });
      throw new Error('Environment not properly configured');
    }

    // Configure connections with fallbacks
    this.databaseUrl = getEnv('DATABASE_URL');
    this.redisUrl = getEnv('REDIS_URL', 'redis://localhost:6379');
    
    this.temporalConfig = {
      host: getEnv('TEMPORAL_HOST', 'localhost'),
      port: parseInt(getEnv('TEMPORAL_PORT', '7233')),
      namespace: getEnv('TEMPORAL_NAMESPACE', 'default'),
      taskQueue: getEnv('TEMPORAL_TASK_QUEUE', 'myloware-tasks')
    };

    console.log('✅ Background agent environment configured successfully');
  }

  async start() {
    console.log('🚀 Starting background agent...');
    console.log(`📊 Database: ${this.databaseUrl}`);
    console.log(`🔴 Redis: ${this.redisUrl}`);
    console.log(`⚡ Temporal: ${this.temporalConfig.host}:${this.temporalConfig.port}`);
    
    // Agent startup logic here
  }
}

/**
 * Example: Advanced Agent with EnvLoader Class
 */
export class AdvancedBackgroundAgent {
  private envLoader: EnvLoader;
  private notificationsEnabled: boolean;

  constructor() {
    // Use EnvLoader class for more control
    this.envLoader = EnvLoader.getInstance();
    this.envLoader.loadEnv();
    
    // Print environment status
    this.envLoader.printStatus();
    
    // Check if environment is properly configured
    if (!this.envLoader.isConfigured()) {
      throw new Error('Environment not properly configured');
    }

    // Check optional features
    this.notificationsEnabled = !!(
      this.envLoader.get('PUSHOVER_USER_KEY') && 
      this.envLoader.get('PUSHOVER_APP_TOKEN')
    );

    if (this.notificationsEnabled) {
      console.log('🔔 Notifications enabled');
    } else {
      console.log('🔕 Notifications disabled (missing credentials)');
    }
  }

  async processWorkItem(workItem: any) {
    console.log('📝 Processing work item...');
    
    // Process work item logic here
    
    // Send notification if enabled
    if (this.notificationsEnabled) {
      await this.sendNotification('Work item processed successfully');
    }
  }

  private async sendNotification(message: string) {
    // Notification logic here
    console.log(`🔔 Notification: ${message}`);
  }
}

/**
 * Example: Event Bus Agent
 */
export class EventBusAgent {
  private redisUrl: string;
  private consumerGroup: string;
  private partitions: number;
  private retryAttempts: number;

  constructor() {
    loadEnvironmentVariables();
    
    // Event bus configuration
    this.redisUrl = getEnv('REDIS_URL', 'redis://localhost:6379');
    this.consumerGroup = getEnv('EVENT_BUS_CONSUMER_GROUP', 'myloware-consumers');
    this.partitions = parseInt(getEnv('EVENT_BUS_PARTITIONS', '4'));
    this.retryAttempts = parseInt(getEnv('EVENT_BUS_RETRY_ATTEMPTS', '3'));
    
    console.log('📡 Event bus agent configured');
  }

  async startConsumer() {
    console.log(`📡 Starting consumer group: ${this.consumerGroup}`);
    console.log(`🔄 Retry attempts: ${this.retryAttempts}`);
    
    // Consumer logic here
  }
}

/**
 * Example: Database Agent
 */
export class DatabaseAgent {
  private databaseUrl: string;
  private logLevel: string;

  constructor() {
    loadEnvironmentVariables();
    
    // Database configuration
    this.databaseUrl = getEnv('DATABASE_URL');
    if (!this.databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    
    this.logLevel = getEnv('LOG_LEVEL', 'INFO');
    
    console.log('🗄️ Database agent configured');
  }

  async connect() {
    console.log(`🔗 Connecting to database...`);
    console.log(`📊 Log level: ${this.logLevel}`);
    
    // Database connection logic here
  }
}

/**
 * Example: Notification Agent
 */
export class NotificationAgent {
  private pushoverUserKey: string | undefined;
  private pushoverAppToken: string | undefined;
  private notificationsEnabled: boolean;

  constructor() {
    loadEnvironmentVariables();
    
    // Notification configuration
    this.pushoverUserKey = getEnv('PUSHOVER_USER_KEY');
    this.pushoverAppToken = getEnv('PUSHOVER_APP_TOKEN');
    this.notificationsEnabled = !!(this.pushoverUserKey && this.pushoverAppToken);
    
    if (this.notificationsEnabled) {
      console.log('🔔 Notification agent configured with Pushover');
    } else {
      console.log('🔕 Notification agent configured (no credentials)');
    }
  }

  async sendNotification(message: string, priority: number = 0) {
    if (!this.notificationsEnabled) {
      console.warn('⚠️ Notifications not configured, skipping');
      return;
    }
    
    console.log(`🔔 Sending notification: ${message} (priority: ${priority})`);
    
    // Notification sending logic here
  }
}

/**
 * Example: Main agent startup
 */
export async function startBackgroundAgents() {
  try {
    // Load and validate environment first
    loadEnvironmentVariables();
    const validation = validateEnvironmentVariables();
    
    if (!validation.valid) {
      console.error('❌ Environment validation failed:');
      validation.errors.forEach(error => {
        console.error(`  - ${error}`);
      });
      process.exit(1);
    }

    console.log('✅ Environment validated successfully');

    // Start different types of agents
    const agents = [
      new ExampleBackgroundAgent(),
      new AdvancedBackgroundAgent(),
      new EventBusAgent(),
      new DatabaseAgent(),
      new NotificationAgent()
    ];

    // Start all agents
    for (const agent of agents) {
      if ('start' in agent) {
        await (agent as any).start();
      }
    }

    console.log('🎉 All background agents started successfully');

  } catch (error) {
    console.error('❌ Failed to start background agents:', error);
    process.exit(1);
  }
}

// Example usage
if (require.main === module) {
  startBackgroundAgents().catch(console.error);
}
