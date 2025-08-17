# MyloWare Workflow Service

Temporal workflow orchestration service for the MyloWare platform. This service manages the "Docs Extract & Verify" workflow and provides HTTP endpoints for workflow lifecycle management.

## Features

- **Temporal Workflows**: Deterministic workflow execution with retries and idempotency
- **Activity Framework**: Modular activities for document processing pipeline
- **HTTP API**: RESTful endpoints for workflow management
- **Health Monitoring**: Comprehensive health checks and metrics
- **Error Handling**: Robust error handling with dead letter queues
- **Signal/Query Support**: Real-time workflow control and monitoring

## Architecture

### Workflow Pipeline

The "Docs Extract & Verify" workflow consists of 6 sequential activities:

1. **RecordGen**: Generate initial records and context
2. **ExtractorLLM**: Extract data from documents using LLM
3. **JsonRestyler**: Transform data to consistent JSON format
4. **SchemaGuard**: Validate data against schemas
5. **Persister**: Persist validated data to database
6. **Verifier**: Perform final verification and quality assurance

### Components

- **Workflows**: Temporal workflow definitions (`src/workflows/`)
- **Activities**: Individual workflow step implementations (`src/activities/`)
- **Services**: Temporal client and worker services (`src/services/`)
- **Controllers**: HTTP API endpoints (`src/controllers/`)
- **Types**: TypeScript interfaces and types (`src/types/`)

## Installation

```bash
# Install dependencies
npm install

# Build the service
npm run build

# Run tests
npm test

# Start development server
npm run dev
```

## Configuration

### Environment Variables

| Variable                | Description          | Default          |
| ----------------------- | -------------------- | ---------------- |
| `TEMPORAL_HOST`         | Temporal server host | `localhost`      |
| `TEMPORAL_PORT`         | Temporal server port | `7233`           |
| `TEMPORAL_NAMESPACE`    | Temporal namespace   | `default`        |
| `TEMPORAL_TASK_QUEUE`   | Task queue name      | `myloware-tasks` |
| `WORKFLOW_SERVICE_PORT` | HTTP server port     | `3001`           |
| `NODE_ENV`              | Environment          | `development`    |
| `LOG_LEVEL`             | Logging level        | `INFO`           |

### Temporal Configuration

The service uses the following Temporal configuration:

- **Task Queue**: `myloware-tasks`
- **Namespace**: `default`
- **Retry Policy**: Exponential backoff (3 attempts, 1s-100s)
- **Timeouts**: 1h execution, 30m run, 10s task

## API Endpoints

### Workflow Management

#### Start Workflow

```http
POST /api/v1/workflows/docs-extract-verify
Content-Type: application/json

{
  "workOrderId": "order-123",
  "workItems": [
    {
      "workItemId": "item-1",
      "type": "INVOICE",
      "content": "Invoice content...",
      "metadata": {}
    }
  ],
  "priority": "HIGH",
  "metadata": {}
}
```

#### Get Workflow Status

```http
GET /api/v1/workflows/{workflowId}/status
```

#### Get Workflow Progress

```http
GET /api/v1/workflows/{workflowId}/progress
```

#### Pause Workflow

```http
PUT /api/v1/workflows/{workflowId}/pause
```

#### Resume Workflow

```http
PUT /api/v1/workflows/{workflowId}/resume
```

#### Cancel Workflow

```http
DELETE /api/v1/workflows/{workflowId}
```

#### List Workflows

```http
GET /api/v1/workflows
```

### Health Checks

#### Basic Health

```http
GET /api/v1/health
```

#### Detailed Health

```http
GET /api/v1/health/detailed
```

#### Readiness Check

```http
GET /api/v1/health/ready
```

#### Liveness Check

```http
GET /api/v1/health/live
```

## Development

### Running Locally

1. Start dependencies:

```bash
docker-compose up -d postgres redis temporal temporal-web
```

2. Start the workflow service:

```bash
cd packages/workflow-service
npm run dev
```

3. Access Temporal UI: http://localhost:8080

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Building

```bash
# Build TypeScript
npm run build

# Clean build artifacts
npm run clean
```

## Monitoring

### Temporal UI

Access the Temporal Web UI at http://localhost:8080 to:

- Monitor workflow executions
- View activity history
- Debug workflow issues
- Inspect workflow state

### Health Endpoints

The service provides comprehensive health checks:

- `/health` - Basic service health
- `/health/detailed` - Detailed health with dependencies
- `/health/ready` - Kubernetes readiness probe
- `/health/live` - Kubernetes liveness probe

### Logging

The service uses structured logging with Winston:

- Service logs: `workflow-service:*`
- Activity logs: `workflow-service:activity-name`
- Controller logs: `workflow-service:controller`

## Error Handling

### Retry Policies

- **Workflow**: 3 attempts with exponential backoff
- **Activities**: 3 attempts with exponential backoff
- **Circuit Breaker**: For external API calls
- **Dead Letter Queue**: For failed activities

### Failure Scenarios

- **Activity Timeout**: Configurable timeouts with heartbeat
- **Network Failures**: Automatic retries with backoff
- **Data Validation**: Schema validation with error details
- **External API**: Circuit breaker patterns

## Integration

### Database Integration

The workflow service integrates with the database schema:

- `work_orders` - Workflow state persistence
- `work_items` - Individual item tracking
- `attempts` - Activity execution history

### Event Bus Integration

The service publishes events to the Redis event bus:

- `workflow.started` - Workflow execution started
- `workflow.completed` - Workflow execution completed
- `workflow.failed` - Workflow execution failed
- `activity.completed` - Individual activity completed

## Contributing

See the main project [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines.

## License

See the main project license.
