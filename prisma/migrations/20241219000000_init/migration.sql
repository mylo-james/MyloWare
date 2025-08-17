-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "work_order_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "work_item_type" AS ENUM ('INVOICE', 'TICKET', 'STATUS_REPORT');

-- CreateEnum
CREATE TYPE "work_item_status" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "attempt_status" AS ENUM ('STARTED', 'COMPLETED', 'FAILED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "mem_doc_type" AS ENUM ('CONTEXT', 'KNOWLEDGE', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "approval_decision" AS ENUM ('APPROVED', 'REJECTED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "connector_type" AS ENUM ('SLACK', 'EMAIL', 'API', 'DATABASE');

-- CreateEnum
CREATE TYPE "connector_status" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "status" "work_order_status" NOT NULL DEFAULT 'PENDING',
    "priority" "priority" NOT NULL DEFAULT 'MEDIUM',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "workflow_id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "work_order_id" UUID NOT NULL,
    "type" "work_item_type" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "work_item_status" NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "work_item_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "status" "attempt_status" NOT NULL DEFAULT 'STARTED',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "duration_ms" INTEGER,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mem_docs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "work_item_id" UUID NOT NULL,
    "type" "mem_doc_type" NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_accessed" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mem_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "work_item_id" UUID NOT NULL,
    "approver_id" TEXT NOT NULL,
    "decision" "approval_decision" NOT NULL,
    "reason" TEXT,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "policy_version" TEXT NOT NULL,

    CONSTRAINT "approval_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letters" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "source" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "type" "connector_type" NOT NULL,
    "config" JSONB NOT NULL,
    "status" "connector_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_health_check" TIMESTAMPTZ,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tools" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "connector_id" UUID NOT NULL,
    "schema" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capabilities" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_capabilities" (
    "tool_id" UUID NOT NULL,
    "capability_id" UUID NOT NULL,

    CONSTRAINT "tool_capabilities_pkey" PRIMARY KEY ("tool_id","capability_id")
);

-- CreateTable
CREATE TABLE "schemas" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "schema_definition" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schemas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_templates" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "document_type" TEXT NOT NULL,
    "workflow_definition" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_results" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "work_item_id" UUID NOT NULL,
    "evaluation_type" TEXT NOT NULL,
    "score" DECIMAL(3,2) NOT NULL,
    "metrics" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "details" JSONB NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_orders_status_idx" ON "work_orders"("status");

-- CreateIndex
CREATE INDEX "work_orders_priority_idx" ON "work_orders"("priority");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_idx" ON "work_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "work_orders_created_at_idx" ON "work_orders"("created_at");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_status_created_at_idx" ON "work_orders"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "work_items_work_order_id_idx" ON "work_items"("work_order_id");

-- CreateIndex
CREATE INDEX "work_items_type_idx" ON "work_items"("type");

-- CreateIndex
CREATE INDEX "work_items_status_idx" ON "work_items"("status");

-- CreateIndex
CREATE INDEX "work_items_created_at_idx" ON "work_items"("created_at");

-- CreateIndex
CREATE INDEX "work_items_work_order_id_status_type_idx" ON "work_items"("work_order_id", "status", "type");

-- CreateIndex
CREATE INDEX "attempts_work_item_id_idx" ON "attempts"("work_item_id");

-- CreateIndex
CREATE INDEX "attempts_agent_id_idx" ON "attempts"("agent_id");

-- CreateIndex
CREATE INDEX "attempts_status_idx" ON "attempts"("status");

-- CreateIndex
CREATE INDEX "attempts_started_at_idx" ON "attempts"("started_at");

-- CreateIndex
CREATE INDEX "attempts_work_item_id_status_started_at_idx" ON "attempts"("work_item_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "mem_docs_work_item_id_idx" ON "mem_docs"("work_item_id");

-- CreateIndex
CREATE INDEX "mem_docs_type_idx" ON "mem_docs"("type");

-- CreateIndex
CREATE INDEX "mem_docs_embedding_idx" ON "mem_docs" USING ivfflat ("embedding" vector_cosine_ops);

-- CreateIndex
CREATE INDEX "approval_events_work_item_id_idx" ON "approval_events"("work_item_id");

-- CreateIndex
CREATE INDEX "approval_events_approver_id_idx" ON "approval_events"("approver_id");

-- CreateIndex
CREATE INDEX "approval_events_timestamp_idx" ON "approval_events"("timestamp");

-- CreateIndex
CREATE INDEX "dead_letters_source_idx" ON "dead_letters"("source");

-- CreateIndex
CREATE INDEX "dead_letters_event_type_idx" ON "dead_letters"("event_type");

-- CreateIndex
CREATE INDEX "dead_letters_created_at_idx" ON "dead_letters"("created_at");

-- CreateIndex
CREATE INDEX "connectors_type_idx" ON "connectors"("type");

-- CreateIndex
CREATE INDEX "connectors_status_idx" ON "connectors"("status");

-- CreateIndex
CREATE INDEX "connectors_tenant_id_idx" ON "connectors"("tenant_id");

-- CreateIndex
CREATE INDEX "tools_connector_id_idx" ON "tools"("connector_id");

-- CreateIndex
CREATE INDEX "tools_is_active_idx" ON "tools"("is_active");

-- CreateIndex
CREATE INDEX "capabilities_scope_idx" ON "capabilities"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "capabilities_name_key" ON "capabilities"("name");

-- CreateIndex
CREATE INDEX "schemas_document_type_idx" ON "schemas"("document_type");

-- CreateIndex
CREATE INDEX "schemas_is_active_idx" ON "schemas"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "schemas_name_version_key" ON "schemas"("name", "version");

-- CreateIndex
CREATE INDEX "workflow_templates_document_type_idx" ON "workflow_templates"("document_type");

-- CreateIndex
CREATE INDEX "workflow_templates_is_active_idx" ON "workflow_templates"("is_active");

-- CreateIndex
CREATE INDEX "eval_results_work_item_id_idx" ON "eval_results"("work_item_id");

-- CreateIndex
CREATE INDEX "eval_results_evaluation_type_idx" ON "eval_results"("evaluation_type");

-- CreateIndex
CREATE INDEX "eval_results_score_idx" ON "eval_results"("score");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- Full-text search indexes
CREATE INDEX "work_items_content_fts_idx" ON "work_items" USING gin(to_tsvector('english', "content"));
CREATE INDEX "mem_docs_content_fts_idx" ON "mem_docs" USING gin(to_tsvector('english', "content"));

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mem_docs" ADD CONSTRAINT "mem_docs_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tools" ADD CONSTRAINT "tools_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_capabilities" ADD CONSTRAINT "tool_capabilities_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_capabilities" ADD CONSTRAINT "tool_capabilities_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;