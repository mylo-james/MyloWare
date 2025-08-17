# Epic 1: Foundation & Core Infrastructure

**Goal**: Establish the foundational platform infrastructure that will support all subsequent development. This includes setting up Temporal for workflow orchestration, PostgreSQL with pgvector for data persistence, Redis for event bus, and the core MCP services that will form the backbone of the system.

## Story 1.1: Project Setup and Repository Structure

As a developer,
I want a well-organized monorepo with proper tooling and CI/CD setup,
so that I can efficiently develop and deploy the MyloWare platform.

**Acceptance Criteria:**

1. Monorepo structure established with clear separation of concerns
2. Development environment setup with Docker Compose for local development
3. CI/CD pipeline configured with automated testing and deployment
4. Code quality tools (linting, formatting, security scanning) integrated
5. Documentation structure established with README and contribution guidelines

## Story 1.2: Database Schema and Core Data Model

As a system architect,
I want a comprehensive database schema that supports all core entities,
so that the platform can reliably store and retrieve workflow data, memory, and audit information.

**Acceptance Criteria:**

1. PostgreSQL database with pgvector extension installed and configured
2. Core tables created: work_order, work_item, attempt, runs, mem_doc, approval_event, dead_letter
3. Platform tables created: connector, tool, capability, schema, workflow_template, eval_result
4. Proper indexing and foreign key constraints implemented
5. Database migration system established with version control

## Story 1.3: Temporal Workflow Engine Setup

As a developer,
I want Temporal configured for workflow orchestration,
so that the platform can execute deterministic workflows with retries, timers, and idempotency.

**Acceptance Criteria:**

1. Temporal server deployed and configured
2. Workflow definitions established for the Docs Extract & Verify workflow
3. Activity implementations for all workflow steps
4. Retry policies and error handling configured
5. Temporal UI accessible for workflow monitoring and debugging

## Story 1.4: Redis Event Bus Implementation

As a system architect,
I want a reliable event bus using Redis Streams,
so that services can communicate asynchronously with at-least-once delivery guarantees.

**Acceptance Criteria:**

1. Redis server deployed and configured
2. Event bus implementation with outbox→bus→inbox pattern
3. Consumer groups and partitioning strategy established
4. Dead letter queue handling for failed events
5. Event schema definitions and validation

## Story 1.5: Core MCP Services Foundation

As a developer,
I want the foundational MCP services (Board, Memory, Notify, Policy) established,
so that the platform has the core building blocks for agent orchestration and communication.

**Acceptance Criteria:**

1. MCP protocol implementation with JSON-RPC 2.0 over WebSocket
2. Board MCP service for work order dispensation
3. Memory MCP service for knowledge management
4. Notify MCP service for Slack integration
5. Policy MCP service for HITL decisions
6. Service discovery and health check endpoints
