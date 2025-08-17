# Database Schema

## PostgreSQL Schema Definition

```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";

-- Create custom types
CREATE TYPE work_order_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE work_item_type AS ENUM ('INVOICE', 'TICKET', 'STATUS_REPORT');
CREATE TYPE work_item_status AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE attempt_status AS ENUM ('STARTED', 'COMPLETED', 'FAILED', 'TIMEOUT');
CREATE TYPE mem_doc_type AS ENUM ('CONTEXT', 'KNOWLEDGE', 'TEMPLATE');
CREATE TYPE approval_decision AS ENUM ('APPROVED', 'REJECTED', 'ESCALATED');
CREATE TYPE connector_type AS ENUM ('SLACK', 'EMAIL', 'API', 'DATABASE');
CREATE TYPE connector_status AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

-- Core business entities
CREATE TABLE work_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status work_order_status NOT NULL DEFAULT 'PENDING',
    priority priority NOT NULL DEFAULT 'MEDIUM',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}',
    workflow_id VARCHAR(255) NOT NULL,
    tenant_id UUID NOT NULL,
    created_by UUID NOT NULL,
    INDEX idx_work_orders_status (status),
    INDEX idx_work_orders_priority (priority),
    INDEX idx_work_orders_tenant (tenant_id),
    INDEX idx_work_orders_created_at (created_at)
);

CREATE TABLE work_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    type work_item_type NOT NULL,
    content TEXT NOT NULL,
    status work_item_status NOT NULL DEFAULT 'QUEUED',
    result JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    INDEX idx_work_items_work_order (work_order_id),
    INDEX idx_work_items_type (type),
    INDEX idx_work_items_status (status),
    INDEX idx_work_items_created_at (created_at)
);

CREATE TABLE attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    agent_id VARCHAR(255) NOT NULL,
    status attempt_status NOT NULL DEFAULT 'STARTED',
    input JSONB NOT NULL,
    output JSONB,
    error TEXT,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    INDEX idx_attempts_work_item (work_item_id),
    INDEX idx_attempts_agent (agent_id),
    INDEX idx_attempts_status (status),
    INDEX idx_attempts_started_at (started_at)
);

CREATE TABLE mem_docs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    type mem_doc_type NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536), -- OpenAI embedding dimension
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_accessed TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    INDEX idx_mem_docs_work_item (work_item_id),
    INDEX idx_mem_docs_type (type),
    INDEX idx_mem_docs_embedding USING ivfflat (embedding vector_cosine_ops)
);

CREATE TABLE approval_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    approver_id VARCHAR(255) NOT NULL,
    decision approval_decision NOT NULL,
    reason TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    policy_version VARCHAR(50) NOT NULL,
    INDEX idx_approval_events_work_item (work_item_id),
    INDEX idx_approval_events_approver (approver_id),
    INDEX idx_approval_events_timestamp (timestamp)
);

CREATE TABLE dead_letters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(255) NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    error TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    INDEX idx_dead_letters_source (source),
    INDEX idx_dead_letters_event_type (event_type),
    INDEX idx_dead_letters_created_at (created_at)
);

-- Platform entities
CREATE TABLE connectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    type connector_type NOT NULL,
    config JSONB NOT NULL,
    status connector_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_health_check TIMESTAMP WITH TIME ZONE,
    tenant_id UUID NOT NULL,
    INDEX idx_connectors_type (type),
    INDEX idx_connectors_status (status),
    INDEX idx_connectors_tenant (tenant_id)
);

CREATE TABLE tools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    connector_id UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
    schema JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    INDEX idx_tools_connector (connector_id),
    INDEX idx_tools_active (is_active)
);

CREATE TABLE capabilities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    scope VARCHAR(255) NOT NULL,
    permissions JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    INDEX idx_capabilities_scope (scope)
);

CREATE TABLE tool_capabilities (
    tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    capability_id UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    PRIMARY KEY (tool_id, capability_id)
);

CREATE TABLE schemas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    document_type VARCHAR(255) NOT NULL,
    schema_definition JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(name, version),
    INDEX idx_schemas_document_type (document_type),
    INDEX idx_schemas_active (is_active)
);

CREATE TABLE workflow_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    document_type VARCHAR(255) NOT NULL,
    workflow_definition JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    INDEX idx_workflow_templates_document_type (document_type),
    INDEX idx_workflow_templates_active (is_active)
);

CREATE TABLE eval_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    evaluation_type VARCHAR(255) NOT NULL,
    score DECIMAL(3,2) NOT NULL CHECK (score >= 0.0 AND score <= 1.0),
    metrics JSONB NOT NULL,
    passed BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    INDEX idx_eval_results_work_item (work_item_id),
    INDEX idx_eval_results_type (evaluation_type),
    INDEX idx_eval_results_score (score)
);

-- Audit and tracking tables
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255),
    action VARCHAR(255) NOT NULL,
    resource_type VARCHAR(255) NOT NULL,
    resource_id UUID,
    details JSONB NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    INDEX idx_audit_logs_user (user_id),
    INDEX idx_audit_logs_action (action),
    INDEX idx_audit_logs_resource (resource_type, resource_id),
    INDEX idx_audit_logs_created_at (created_at)
);

-- Performance optimization indexes
CREATE INDEX CONCURRENTLY idx_work_orders_composite ON work_orders (tenant_id, status, created_at);
CREATE INDEX CONCURRENTLY idx_work_items_composite ON work_items (work_order_id, status, type);
CREATE INDEX CONCURRENTLY idx_attempts_composite ON attempts (work_item_id, status, started_at);

-- Full-text search indexes
CREATE INDEX CONCURRENTLY idx_work_items_content_fts ON work_items USING gin(to_tsvector('english', content));
CREATE INDEX CONCURRENTLY idx_mem_docs_content_fts ON mem_docs USING gin(to_tsvector('english', content));
```
