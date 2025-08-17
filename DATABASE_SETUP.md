# MyloWare Database Setup Guide

## Overview

This guide covers the complete database setup for MyloWare, including PostgreSQL with pgvector extension, Prisma ORM configuration, and all required tables for the workflow automation platform.

## Prerequisites

- Node.js 20.11.0 or higher
- PostgreSQL 15.5 with pgvector extension
- Docker and Docker Compose (for local development)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Database (Development)

```bash
# Start PostgreSQL with pgvector using Docker Compose
docker compose up -d postgres

# Wait for database to be ready
docker compose logs postgres
```

### 3. Run Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Apply migrations
npm run db:migrate

# Seed with sample data
npm run db:seed
```

### 4. Validate Setup

```bash
# Validate database schema
npm run db:validate
```

## Database Schema

### Core Business Entities

#### WorkOrder

- Primary workflow orchestration table
- Tracks document processing requests with metadata and workflow state
- Fields: id, status, priority, workflow_id, tenant_id, created_by, metadata

#### WorkItem

- Individual documents or tasks within a work order
- Fields: id, work_order_id, type, content, status, result, processed_at

#### Attempt

- Tracks individual processing attempts with execution history
- Fields: id, work_item_id, agent_id, status, input, output, error, duration_ms

#### MemDoc

- Memory documents for agent context and knowledge storage
- Supports vector embeddings for similarity search
- Fields: id, work_item_id, type, content, embedding, metadata

#### ApprovalEvent

- Human-in-the-loop approval decisions and governance actions
- Fields: id, work_item_id, approver_id, decision, reason, policy_version

#### DeadLetter

- Failed events and messages for investigation and retry
- Fields: id, source, event_type, payload, error, retry_count

### Platform Entities

#### Connector

- External system integrations and data sources
- Fields: id, name, type, config, status, tenant_id, last_health_check

#### Tool

- Available tools and capabilities for agents
- Fields: id, name, description, connector_id, schema, is_active

#### Capability

- Permissions and access controls for tools
- Fields: id, name, description, scope, permissions

#### Schema

- Data schemas for document types and validation
- Fields: id, name, version, document_type, schema_definition, is_active

#### WorkflowTemplate

- Reusable workflow templates
- Fields: id, name, description, document_type, workflow_definition, is_active

#### EvalResult

- Evaluation results for quality assurance
- Fields: id, work_item_id, evaluation_type, score, metrics, passed

### Audit and Tracking

#### AuditLog

- Comprehensive audit trail for all system actions
- Fields: id, user_id, action, resource_type, resource_id, details, ip_address

## Custom Types

The schema includes several PostgreSQL ENUM types:

- `work_order_status`: PENDING, PROCESSING, COMPLETED, FAILED
- `priority`: LOW, MEDIUM, HIGH, URGENT
- `work_item_type`: INVOICE, TICKET, STATUS_REPORT
- `work_item_status`: QUEUED, PROCESSING, COMPLETED, FAILED
- `attempt_status`: STARTED, COMPLETED, FAILED, TIMEOUT
- `mem_doc_type`: CONTEXT, KNOWLEDGE, TEMPLATE
- `approval_decision`: APPROVED, REJECTED, ESCALATED
- `connector_type`: SLACK, EMAIL, API, DATABASE
- `connector_status`: ACTIVE, INACTIVE, ERROR

## Indexing Strategy

### Performance Indexes

- Primary key indexes on all tables
- Foreign key indexes for relationship queries
- Composite indexes for common query patterns
- Status and timestamp indexes for filtering

### Search Indexes

- Full-text search indexes on content fields using PostgreSQL GIN
- Vector similarity indexes using ivfflat for embedding fields (pgvector)

### Example Indexes

```sql
-- Performance optimization
CREATE INDEX work_orders_tenant_status_created_at_idx ON work_orders(tenant_id, status, created_at);
CREATE INDEX work_items_work_order_status_type_idx ON work_items(work_order_id, status, type);

-- Full-text search
CREATE INDEX work_items_content_fts_idx ON work_items USING gin(to_tsvector('english', content));

-- Vector similarity
CREATE INDEX mem_docs_embedding_idx ON mem_docs USING ivfflat (embedding vector_cosine_ops);
```

## Available Scripts

### Database Management

- `npm run db:generate` - Generate Prisma client from schema
- `npm run db:migrate` - Apply pending migrations to database
- `npm run db:migrate:prod` - Deploy migrations in production
- `npm run db:seed` - Populate database with sample data
- `npm run db:reset` - Reset database (WARNING: destroys all data)
- `npm run db:validate` - Validate database schema and constraints

### Development Workflow

```bash
# Make schema changes in prisma/schema.prisma
# Generate new migration
npm run db:migrate

# Update Prisma client
npm run db:generate

# Test changes
npm run db:validate
```

## Environment Variables

Required environment variables for database connection:

```env
DATABASE_URL="postgresql://myloware:myloware_dev_password@localhost:5432/myloware?schema=public"
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=myloware
DATABASE_USER=myloware
DATABASE_PASSWORD=myloware_dev_password
```

## Production Deployment

### Migration Strategy

1. Backup existing database
2. Run `npm run db:migrate:prod` to apply migrations
3. Validate schema with `npm run db:validate`
4. Monitor application logs for any issues

### Performance Considerations

- Use connection pooling for high-traffic applications
- Monitor index usage and query performance
- Consider read replicas for read-heavy workloads
- Regular maintenance of vector indexes for optimal performance

## Troubleshooting

### Common Issues

#### Migration Failures

```bash
# Check migration status
npx prisma migrate status

# Reset and reapply (development only)
npm run db:reset
```

#### Connection Issues

```bash
# Test database connectivity
npx prisma db pull

# Check Docker container status
docker compose ps
docker compose logs postgres
```

#### Vector Extension Issues

```sql
-- Verify pgvector extension
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Check vector operations
SELECT embedding <-> embedding FROM mem_docs LIMIT 1;
```

## Schema Evolution

When making schema changes:

1. Update `prisma/schema.prisma`
2. Generate migration: `npm run db:migrate`
3. Review generated SQL in migrations directory
4. Test migration on development database
5. Update seed data if necessary
6. Deploy to production with `npm run db:migrate:prod`

## Backup and Recovery

### Backup

```bash
# Full database backup
pg_dump -h localhost -U myloware myloware > backup.sql

# Schema-only backup
pg_dump -h localhost -U myloware -s myloware > schema.sql
```

### Recovery

```bash
# Restore from backup
psql -h localhost -U myloware myloware < backup.sql
```

For more information, see the [Prisma documentation](https://www.prisma.io/docs/) and [pgvector documentation](https://github.com/pgvector/pgvector).
