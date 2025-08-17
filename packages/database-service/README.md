# Database Service

The centralized database service layer for MyloWare platform, providing type-safe data access through Prisma ORM.

## Features

- **Type-safe database operations** using Prisma Client
- **Repository pattern** for clean data access abstraction
- **Vector similarity search** with pgvector for memory documents
- **Comprehensive indexing** for performance optimization
- **Transaction support** for data consistency
- **Pagination and sorting** for large datasets

## Schema Overview

### Core Business Entities

- **WorkOrder**: Primary workflow orchestration table
- **WorkItem**: Individual document processing tasks
- **Attempt**: Processing attempt tracking with agent details
- **MemDoc**: Vector-enabled memory storage with embeddings
- **ApprovalEvent**: Human-in-the-loop decision tracking
- **DeadLetter**: Failed event storage and recovery

### Platform Entities

- **Connector**: External system integration configuration
- **Tool**: Agent tool definitions and schemas
- **Capability**: Access control and permissions
- **ToolCapability**: Many-to-many relationship between tools and capabilities
- **Schema**: Document validation schemas
- **WorkflowTemplate**: Reusable workflow definitions
- **EvalResult**: Quality assurance evaluation results

### Legacy Entities

- **User**: User management (legacy)
- **WorkflowRun**: Workflow execution tracking (legacy)
- **Memory**: Memory storage (legacy)
- **AuditLog**: System audit trail

## Usage

### Basic Setup

```typescript
import { DatabaseClient, WorkOrderRepository } from '@myloware/database-service';

// Initialize database client
const dbClient = DatabaseClient.getInstance();
await dbClient.connect();

// Create repository
const workOrderRepo = new WorkOrderRepository(dbClient.client);

// Use repository
const workOrder = await workOrderRepo.findById('work-order-id');
```

### Repository Factory

```typescript
import { RepositoryFactory } from '@myloware/database-service';

const repositoryFactory = new RepositoryFactory(dbClient.client);
const workOrderRepo = repositoryFactory.createWorkOrderRepository();
const memDocRepo = repositoryFactory.createMemDocRepository();
```

### Vector Search

```typescript
const memDocRepo = new MemDocRepository(prisma);

// Find similar memory documents
const similarDocs = await memDocRepo.findSimilar({
  embedding: [0.1, 0.2, 0.3, ...], // 1536-dimensional vector
  limit: 10,
  threshold: 0.7
});
```

### Pagination

```typescript
const result = await workOrderRepo.findMany({
  pagination: {
    page: 1,
    limit: 20
  },
  sort: {
    field: 'createdAt',
    direction: 'desc'
  }
});

console.log(`Found ${result.total} work orders, showing page ${result.page} of ${result.totalPages}`);
```

## Database Commands

```bash
# Generate Prisma client
npm run db:generate

# Create and apply migration (development)
npm run db:migrate

# Apply migrations (production)
npm run db:migrate:deploy

# Reset database and apply all migrations
npm run db:migrate:reset

# Seed database with initial data
npm run db:seed

# Open Prisma Studio
npm run db:studio

# Push schema changes without migration
npm run db:push
```

## Environment Variables

```bash
DATABASE_URL="postgresql://myloware:myloware_dev_password@localhost:5432/myloware?schema=public"
```

## Testing

The package includes comprehensive unit tests for all repository methods:

```bash
npm test
```

Tests use mocked Prisma clients to verify repository behavior without requiring a live database connection.

## Architecture

The database service follows the repository pattern:

1. **DatabaseClient**: Singleton wrapper around PrismaClient with connection management
2. **BaseRepository**: Abstract base class providing common CRUD operations
3. **Specific Repositories**: Implement domain-specific database operations
4. **Types**: TypeScript interfaces for database operations and pagination

## Performance Considerations

- **Indexes**: Comprehensive indexing strategy for common query patterns
- **Composite Indexes**: Multi-column indexes for complex queries
- **Vector Indexes**: IVFFlat indexes for similarity search performance
- **Connection Pooling**: Managed through Prisma Client configuration
- **Query Optimization**: Repository methods include proper relations and pagination