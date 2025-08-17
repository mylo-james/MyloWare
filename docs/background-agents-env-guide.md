# Background Agents Environment Variables Guide

This guide explains how to provide environment variables to background agents in the MyloWare project.

## Overview

Background agents in MyloWare need access to environment variables for:
- Database connections
- Redis connections
- Temporal workflow engine
- External API credentials
- Notification services
- Logging configuration

## Environment Variable Management

### 1. Centralized Environment Loader

We've created a centralized `EnvLoader` utility in `packages/shared/src/utils/env-loader.ts` that provides:

- **Automatic .env file detection** - Walks up directory tree to find .env files
- **Environment validation** - Validates required variables using Joi schemas
- **Singleton pattern** - Ensures environment is loaded only once
- **Type-safe access** - Provides getter methods with fallbacks

### 2. Usage in Background Agents

#### Basic Usage

```typescript
import { loadEnvironmentVariables, getEnv, validateEnvironmentVariables } from '@myloware/shared';

// Load environment variables at startup
loadEnvironmentVariables();

// Get environment variables with fallbacks
const databaseUrl = getEnv('DATABASE_URL', 'postgresql://localhost:5432/myloware');
const redisUrl = getEnv('REDIS_URL', 'redis://localhost:6379');

// Validate environment configuration
const validation = validateEnvironmentVariables();
if (!validation.valid) {
  console.error('Environment configuration errors:', validation.errors);
  process.exit(1);
}
```

#### Advanced Usage with EnvLoader Class

```typescript
import { EnvLoader } from '@myloware/shared';

const envLoader = EnvLoader.getInstance();

// Load and validate environment
envLoader.loadEnv();
envLoader.printStatus();

if (!envLoader.isConfigured()) {
  console.error('Environment not properly configured');
  process.exit(1);
}

// Access environment variables
const temporalHost = envLoader.get('TEMPORAL_HOST', 'localhost');
const temporalPort = envLoader.get('TEMPORAL_PORT', '7233');
```

## Required Environment Variables

### Core Infrastructure

```bash
# Database
DATABASE_URL=postgresql://myloware:myloware_dev_password@localhost:5432/myloware

# Redis
REDIS_URL=redis://localhost:6379

# Temporal Workflow Engine
TEMPORAL_HOST=localhost
TEMPORAL_PORT=7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=myloware-tasks
```

### Notification System (Temporary)

```bash
# Pushover Notifications (temporary until Slack integration)
PUSHOVER_USER_KEY=your_user_key_here
PUSHOVER_APP_TOKEN=your_app_token_here
```

### Application Configuration

```bash
# Environment
NODE_ENV=development
LOG_LEVEL=INFO

# Event Bus Configuration
EVENT_BUS_CONSUMER_GROUP=myloware-consumers
EVENT_BUS_PARTITIONS=4
EVENT_BUS_RETRY_ATTEMPTS=3
```

## Environment File Setup

### 1. Create .env File

Create a `.env` file in your project root:

```bash
# Copy from example
cp .env.example .env

# Or create manually
touch .env
```

### 2. Configure Variables

Add your environment variables to the `.env` file:

```bash
# Core Infrastructure
DATABASE_URL=postgresql://myloware:myloware_dev_password@localhost:5432/myloware
REDIS_URL=redis://localhost:6379
TEMPORAL_HOST=localhost
TEMPORAL_PORT=7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=myloware-tasks

# Notification System
PUSHOVER_USER_KEY=your_user_key_here
PUSHOVER_APP_TOKEN=your_app_token_here

# Application Configuration
NODE_ENV=development
LOG_LEVEL=INFO
EVENT_BUS_CONSUMER_GROUP=myloware-consumers
EVENT_BUS_PARTITIONS=4
EVENT_BUS_RETRY_ATTEMPTS=3
```

## Integration with Different Agent Types

### 1. Temporal Workflow Agents

```typescript
import { loadEnvironmentVariables, getEnv } from '@myloware/shared';

export class TemporalWorkflowAgent {
  constructor() {
    // Load environment variables
    loadEnvironmentVariables();
    
    // Configure Temporal connection
    this.temporalConfig = {
      host: getEnv('TEMPORAL_HOST', 'localhost'),
      port: parseInt(getEnv('TEMPORAL_PORT', '7233')),
      namespace: getEnv('TEMPORAL_NAMESPACE', 'default'),
      taskQueue: getEnv('TEMPORAL_TASK_QUEUE', 'myloware-tasks')
    };
  }
}
```

### 2. Database Agents

```typescript
import { loadEnvironmentVariables, getEnv } from '@myloware/shared';

export class DatabaseAgent {
  constructor() {
    loadEnvironmentVariables();
    
    this.databaseUrl = getEnv('DATABASE_URL');
    if (!this.databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }
  }
}
```

### 3. Event Bus Agents

```typescript
import { loadEnvironmentVariables, getEnv } from '@myloware/shared';

export class EventBusAgent {
  constructor() {
    loadEnvironmentVariables();
    
    this.redisUrl = getEnv('REDIS_URL', 'redis://localhost:6379');
    this.consumerGroup = getEnv('EVENT_BUS_CONSUMER_GROUP', 'myloware-consumers');
    this.partitions = parseInt(getEnv('EVENT_BUS_PARTITIONS', '4'));
    this.retryAttempts = parseInt(getEnv('EVENT_BUS_RETRY_ATTEMPTS', '3'));
  }
}
```

### 4. Notification Agents

```typescript
import { loadEnvironmentVariables, getEnv } from '@myloware/shared';

export class NotificationAgent {
  constructor() {
    loadEnvironmentVariables();
    
    // Check if notification system is configured
    this.pushoverUserKey = getEnv('PUSHOVER_USER_KEY');
    this.pushoverAppToken = getEnv('PUSHOVER_APP_TOKEN');
    
    this.notificationsEnabled = !!(this.pushoverUserKey && this.pushoverAppToken);
  }
  
  async sendNotification(message: string, priority: number = 0) {
    if (!this.notificationsEnabled) {
      console.warn('Notifications not configured, skipping notification');
      return;
    }
    
    // Send notification logic here
  }
}
```

## Docker Integration

### 1. Docker Compose Environment

Your `docker-compose.yml` already passes environment variables to services:

```yaml
services:
  temporal:
    environment:
      - DB=postgresql
      - DB_PORT=5432
      - POSTGRES_USER=myloware
      - POSTGRES_PWD=myloware_dev_password
```

### 2. Container Environment Variables

For agents running in containers, you can pass environment variables:

```bash
# Run agent with environment variables
docker run -e DATABASE_URL=postgresql://host.docker.internal:5432/myloware \
           -e REDIS_URL=redis://host.docker.internal:6379 \
           myloware-agent

# Or use .env file
docker run --env-file .env myloware-agent
```

## Validation and Error Handling

### 1. Environment Validation

```typescript
import { validateEnvironmentVariables } from '@myloware/shared';

// Validate environment at startup
const validation = validateEnvironmentVariables();
if (!validation.valid) {
  console.error('❌ Environment configuration errors:');
  validation.errors.forEach(error => {
    console.error(`  - ${error}`);
  });
  process.exit(1);
}

console.log('✅ Environment configuration is valid');
```

### 2. Graceful Degradation

```typescript
import { getEnv } from '@myloware/shared';

// Use fallbacks for optional features
const notificationsEnabled = getEnv('PUSHOVER_USER_KEY') && getEnv('PUSHOVER_APP_TOKEN');
const logLevel = getEnv('LOG_LEVEL', 'INFO');
const maxRetries = parseInt(getEnv('MAX_RETRIES', '3'));
```

## Testing

### 1. Test Environment Setup

```typescript
import { EnvLoader } from '@myloware/shared';

describe('Agent Tests', () => {
  beforeEach(() => {
    // Reset environment for each test
    process.env = {
      DATABASE_URL: 'postgresql://localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      TEMPORAL_HOST: 'localhost',
      TEMPORAL_PORT: '7233'
    };
    
    // Reset singleton instance
    (EnvLoader as any).instance = undefined;
  });
});
```

### 2. Environment Variable Testing

```typescript
import { getEnv, validateEnvironmentVariables } from '@myloware/shared';

describe('Environment Variables', () => {
  it('should load required environment variables', () => {
    const validation = validateEnvironmentVariables();
    expect(validation.valid).toBe(true);
  });
  
  it('should provide fallback values', () => {
    const logLevel = getEnv('LOG_LEVEL', 'INFO');
    expect(logLevel).toBe('INFO');
  });
});
```

## Security Considerations

### 1. Sensitive Data

- Never commit `.env` files to version control
- Use environment-specific `.env` files (`.env.development`, `.env.production`)
- Rotate API keys and credentials regularly
- Use secrets management in production

### 2. Validation

- Always validate environment variables at startup
- Use strong validation schemas for critical variables
- Provide clear error messages for missing variables

## Troubleshooting

### Common Issues

1. **"Environment variable not found"**
   - Check if `.env` file exists in project root
   - Verify variable name spelling
   - Ensure no extra spaces around `=` sign

2. **"Validation failed"**
   - Check required variables are set
   - Verify variable formats (URLs, numbers, etc.)
   - Review validation schema in `common-schemas.ts`

3. **"Singleton already loaded"**
   - This is expected behavior
   - Environment is loaded only once per process
   - Use `getEnv()` for subsequent access

### Debug Mode

```typescript
import { EnvLoader } from '@myloware/shared';

const envLoader = EnvLoader.getInstance();
envLoader.loadEnv();
envLoader.printStatus(); // Shows validation results
```

## Migration from Current System

Your existing notification scripts already load `.env` files. The new system provides:

1. **Centralized management** - Single source of truth for environment loading
2. **Validation** - Automatic validation of required variables
3. **Type safety** - Better TypeScript support
4. **Testing support** - Easier testing with singleton reset
5. **Error handling** - Better error messages and graceful degradation

### Migration Steps

1. **Update existing agents** to use the new `EnvLoader`
2. **Add validation** at startup for all agents
3. **Use fallbacks** for optional features
4. **Update tests** to use the new environment utilities

## Future Enhancements

### 1. Environment-Specific Configurations

```typescript
// Support for different environments
const env = getEnv('NODE_ENV', 'development');
const config = {
  development: { logLevel: 'DEBUG', retries: 1 },
  production: { logLevel: 'WARN', retries: 3 }
}[env];
```

### 2. Dynamic Configuration

```typescript
// Support for runtime configuration changes
envLoader.reload(); // Reload environment variables
```

### 3. Configuration Management

```typescript
// Support for configuration management systems
// (AWS Parameter Store, HashiCorp Vault, etc.)
```

This environment variable management system ensures your background agents have consistent, validated access to all required configuration while maintaining security and providing excellent developer experience.
