# Database Setup Guide

## Overview

This guide covers the complete database setup for MyloWare, including PostgreSQL with pgvector extension, Prisma ORM configuration, and initial data seeding.

## Prerequisites

- PostgreSQL 15.5+ with pgvector 0.5.0 extension
- Node.js 20.11.0+
- npm 10.0.0+

## Quick Start

1. **Start Database Services**

   ```bash
   npm run dev  # Starts PostgreSQL, Redis, and Temporal via Docker Compose
   ```

2. **Generate Prisma Client**

   ```bash
   npm run db:generate
   ```

3. **Run Database Migrations**

   ```bash
   npm run db:migrate:dev
   ```

4. **Seed Initial Data**

   ```bash
   npm run db:seed
   ```

5. **Validate Setup**
   ```bash
   npm run db:validate
   ```

## Database Schema

### Core Business Entities

- **work_orders**: Primary workflow orchestration table
  - Tracks document processing requests with metadata and workflow state
  - Foreign key parent for work_items
  - Indexed on status, priority, tenant_id, created_at

- **work_items**: Individual documents or tasks within a work order
  - Contains document content and processing status
  - Foreign key child of work_orders
  - Indexed on work_order_id, type, status, created_at

- **attempts**: Tracks individual processing attempts with execution history
  - Records agent processing attempts with input/output
  - Foreign key child of work_items
  - Indexed on work_item_id, agent_id, status, started_at

- **mem_docs**: Memory documents for agent context and knowledge storage
  - Supports vector embeddings for similarity search (1536 dimensions)
  - Foreign key child of work_items
  - Indexed on work_item_id, type, with vector similarity index

- **approval_events**: Human-in-the-loop approval decisions and governance actions
  - Records approval/rejection decisions with reasoning
  - Foreign key child of work_items
  - Indexed on work_item_id, approver_id, timestamp

- **dead_letters**: Failed events and messages for investigation
  - Stores failed events for debugging and retry
  - Standalone table with retry tracking
  - Indexed on source, event_type, created_at

### Platform Entities

- **connectors**: External system integrations and data sources
  - Configuration for Slack, email, API, and database connections
  - Parent table for tools
  - Indexed on type, status, tenant_id

- **tools**: Available tools and capabilities for agents
  - Tool definitions with JSON schemas
  - Foreign key child of connectors
  - Many-to-many relationship with capabilities
  - Indexed on connector_id, is_active

- **capabilities**: Permissions and access controls
  - Defines what actions tools can perform
  - Many-to-many relationship with tools
  - Indexed on scope, with unique constraint on name

- **tool_capabilities**: Junction table for tool-capability relationships
  - Many-to-many relationship table
  - Composite primary key (tool_id, capability_id)

- **schemas**: Data schemas for document types and validation
  - JSON schema definitions for document validation
  - Unique constraint on (name, version)
  - Indexed on document_type, is_active

- **workflow_templates**: Reusable workflow templates
  - Workflow definitions for different document types
  - JSON workflow definitions
  - Indexed on document_type, is_active

- **eval_results**: Evaluation results for quality assurance
  - Quality metrics and scoring for work items
  - Foreign key child of work_items
  - Score constraint: 0.0 ≤ score ≤ 1.0
  - Indexed on work_item_id, evaluation_type, score

### Custom ENUM Types

- `work_order_status`: PENDING, PROCESSING, COMPLETED, FAILED
- `priority`: LOW, MEDIUM, HIGH, URGENT
- `work_item_type`: INVOICE, TICKET, STATUS_REPORT
- `work_item_status`: QUEUED, PROCESSING, COMPLETED, FAILED
- `attempt_status`: STARTED, COMPLETED, FAILED, TIMEOUT
- `mem_doc_type`: CONTEXT, KNOWLEDGE, TEMPLATE
- `approval_decision`: APPROVED, REJECTED, ESCALATED
- `connector_type`: SLACK, EMAIL, API, DATABASE
- `connector_status`: ACTIVE, INACTIVE, ERROR

## Environment Variables

```bash
# Database Configuration
DATABASE_URL="postgresql://myloware:myloware_dev_password@localhost:5432/myloware?schema=public"
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=myloware
DATABASE_USER=myloware
DATABASE_PASSWORD=myloware_dev_password
```

## Available Scripts

- `npm run db:generate` - Generate Prisma client
- `npm run db:migrate` - Deploy migrations to production
- `npm run db:migrate:dev` - Create and apply new migration
- `npm run db:seed` - Seed database with initial test data
- `npm run db:reset` - Reset database and re-run all migrations
- `npm run db:studio` - Open Prisma Studio for database browsing
- `npm run db:validate` - Run comprehensive schema validation

## Performance Optimizations

### Indexes

- **Single column indexes** on frequently queried fields (status, priority, type)
- **Composite indexes** for common query patterns:
  - `(tenant_id, status, created_at)` on work_orders
  - `(work_order_id, status, type)` on work_items
  - `(work_item_id, status, started_at)` on attempts
- **Full-text search indexes** on content fields using PostgreSQL GIN
- **Vector similarity indexes** using ivfflat for embedding search

### Constraints

- **Foreign key constraints** with CASCADE delete for data integrity
- **Unique constraints** on business keys (capability names, schema versions)
- **Check constraints** for data validation (score ranges)

## Vector Embeddings

The `mem_docs` table supports vector embeddings for similarity search:

- **Dimension**: 1536 (OpenAI embedding size)
- **Index**: ivfflat with cosine similarity
- **Usage**: Store document embeddings for semantic search and retrieval

## Migration Strategy

1. **Development**: Use `npm run db:migrate:dev` to create and apply migrations
2. **Production**: Use `npm run db:migrate` to deploy migrations
3. **Rollback**: Prisma supports migration rollback via `prisma migrate reset`

## Seeding Strategy

The seed script (`prisma/seed.ts`) provides:

- **Sample capabilities** for document and workflow permissions
- **Sample connectors** for Slack and email integration
- **Sample tools** with JSON schemas
- **Sample work orders and work items** for testing
- **Sample attempts and evaluation results** for development
- **Sample memory documents** with context examples

## Troubleshooting

### Common Issues

1. **pgvector extension missing**
   - Ensure PostgreSQL image includes pgvector: `pgvector/pgvector:pg15`
   - Verify extension installation: `SELECT * FROM pg_extension WHERE extname = 'vector';`

2. **Migration failures**
   - Check database connection in `.env`
   - Ensure database user has proper permissions
   - Verify PostgreSQL service is running

3. **Foreign key constraint errors**
   - Ensure parent records exist before creating child records
   - Check cascade delete behavior in relationships

### Validation

Run the validation script to check all schema components:

```bash
npm run db:validate
```

This will verify:

- All tables exist and are accessible
- ENUM types are properly defined
- Foreign key relationships work correctly
- Indexes are created
- Constraints are enforced
- Vector support is available

## Next Steps

After completing this setup:

1. **Story 1.3**: Temporal Workflow Engine Setup
2. **Story 1.4**: Redis Event Bus Implementation
3. **Story 1.5**: Core MCP Services Foundation
