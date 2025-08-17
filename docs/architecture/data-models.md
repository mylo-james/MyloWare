# Data Models

## Core Business Entities

**WorkOrder**
- **Purpose:** Represents a document processing request with associated metadata and workflow state
- **Key Attributes:**
  - `id`: UUID - Unique identifier for the work order
  - `status`: WorkOrderStatus - Current processing status (PENDING, PROCESSING, COMPLETED, FAILED)
  - `priority`: Priority - Processing priority (LOW, MEDIUM, HIGH, URGENT)
  - `created_at`: DateTime - Timestamp when work order was created
  - `updated_at`: DateTime - Last modification timestamp
  - `metadata`: JSON - Flexible metadata storage for document-specific information
  - `workflow_id`: String - Temporal workflow identifier
  - `tenant_id`: UUID - Multi-tenant isolation
- **Relationships:**
  - Has many WorkItems (one-to-many)
  - Has many Attempts (one-to-many)
  - Belongs to Tenant (many-to-one)

**WorkItem**
- **Purpose:** Individual document or task within a work order that gets processed by agents
- **Key Attributes:**
  - `id`: UUID - Unique identifier for the work item
  - `work_order_id`: UUID - Reference to parent work order
  - `type`: WorkItemType - Type of processing (INVOICE, TICKET, STATUS_REPORT)
  - `content`: Text - Raw document content or file reference
  - `status`: WorkItemStatus - Processing status (QUEUED, PROCESSING, COMPLETED, FAILED)
  - `result`: JSON - Extracted and processed data
  - `created_at`: DateTime - Creation timestamp
  - `processed_at`: DateTime - Processing completion timestamp
- **Relationships:**
  - Belongs to WorkOrder (many-to-one)
  - Has many Attempts (one-to-many)
  - Has many MemDocs (one-to-many)

**Attempt**
- **Purpose:** Tracks individual processing attempts for work items with detailed execution history
- **Key Attributes:**
  - `id`: UUID - Unique attempt identifier
  - `work_item_id`: UUID - Reference to work item being processed
  - `agent_id`: String - Identifier of the agent that processed this attempt
  - `status`: AttemptStatus - Execution status (STARTED, COMPLETED, FAILED, TIMEOUT)
  - `input`: JSON - Input data provided to the agent
  - `output`: JSON - Output data from the agent
  - `error`: Text - Error message if attempt failed
  - `started_at`: DateTime - When processing began
  - `completed_at`: DateTime - When processing completed
  - `duration_ms`: Integer - Processing duration in milliseconds
- **Relationships:**
  - Belongs to WorkItem (many-to-one)
  - Belongs to Agent (many-to-one)

**MemDoc**
- **Purpose:** Memory documents that store context and knowledge for agent processing
- **Key Attributes:**
  - `id`: UUID - Unique memory document identifier
  - `work_item_id`: UUID - Associated work item
  - `type`: MemDocType - Type of memory (CONTEXT, KNOWLEDGE, TEMPLATE)
  - `content`: Text - Memory content
  - `embedding`: Vector - Vector representation for similarity search
  - `metadata`: JSON - Additional metadata
  - `created_at`: DateTime - Creation timestamp
  - `last_accessed`: DateTime - Last access timestamp
- **Relationships:**
  - Belongs to WorkItem (many-to-one)
  - Has many related MemDocs (many-to-many through similarity)

**ApprovalEvent**
- **Purpose:** Tracks human-in-the-loop approval decisions and governance actions
- **Key Attributes:**
  - `id`: UUID - Unique approval event identifier
  - `work_item_id`: UUID - Associated work item requiring approval
  - `approver_id`: String - User identifier who made the decision
  - `decision`: ApprovalDecision - Decision made (APPROVED, REJECTED, ESCALATED)
  - `reason`: Text - Reason for decision
  - `timestamp`: DateTime - When decision was made
  - `policy_version`: String - Version of policy that was applied
- **Relationships:**
  - Belongs to WorkItem (many-to-one)
  - Belongs to User (many-to-one)

**DeadLetter**
- **Purpose:** Stores failed events and messages for investigation and reprocessing
- **Key Attributes:**
  - `id`: UUID - Unique dead letter identifier
  - `source`: String - Source system that generated the failed event
  - `event_type`: String - Type of event that failed
  - `payload`: JSON - Original event payload
  - `error`: Text - Error that caused the failure
  - `retry_count`: Integer - Number of retry attempts
  - `created_at`: DateTime - When the dead letter was created
  - `processed_at`: DateTime - When it was successfully reprocessed
- **Relationships:**
  - Standalone entity for error tracking and recovery

## Platform Entities

**Connector**
- **Purpose:** Configuration for external system integrations and data sources
- **Key Attributes:**
  - `id`: UUID - Unique connector identifier
  - `name`: String - Human-readable connector name
  - `type`: ConnectorType - Type of connector (SLACK, EMAIL, API, DATABASE)
  - `config`: JSON - Connection configuration and credentials
  - `status`: ConnectorStatus - Connection status (ACTIVE, INACTIVE, ERROR)
  - `created_at`: DateTime - Creation timestamp
  - `last_health_check`: DateTime - Last health check timestamp
- **Relationships:**
  - Has many Tools (one-to-many)
  - Belongs to Tenant (many-to-one)

**Tool**
- **Purpose:** Defines available tools and capabilities that agents can use
- **Key Attributes:**
  - `id`: UUID - Unique tool identifier
  - `name`: String - Tool name
  - `description`: Text - Tool description
  - `connector_id`: UUID - Associated connector
  - `schema`: JSON - Tool input/output schema
  - `is_active`: Boolean - Whether tool is available for use
  - `created_at`: DateTime - Creation timestamp
- **Relationships:**
  - Belongs to Connector (many-to-one)
  - Has many Capabilities (many-to-many)

**Capability**
- **Purpose:** Defines permissions and access controls for users and services
- **Key Attributes:**
  - `id`: UUID - Unique capability identifier
  - `name`: String - Capability name
  - `description`: Text - Capability description
  - `scope`: String - Scope of the capability
  - `permissions`: JSON - Specific permissions granted
  - `created_at`: DateTime - Creation timestamp
- **Relationships:**
  - Has many Tools (many-to-many)
  - Has many Users (many-to-many)

**Schema**
- **Purpose:** Defines data schemas for document types and validation rules
- **Key Attributes:**
  - `id`: UUID - Unique schema identifier
  - `name`: String - Schema name
  - `version`: String - Schema version
  - `document_type`: String - Type of document this schema applies to
  - `schema_definition`: JSON - JSON Schema definition
  - `is_active`: Boolean - Whether schema is active
  - `created_at`: DateTime - Creation timestamp
- **Relationships:**
  - Has many WorkItems (one-to-many through document_type)

**WorkflowTemplate**
- **Purpose:** Defines reusable workflow templates for different document processing scenarios
- **Key Attributes:**
  - `id`: UUID - Unique template identifier
  - `name`: String - Template name
  - `description`: Text - Template description
  - `document_type`: String - Document type this template applies to
  - `workflow_definition`: JSON - Temporal workflow definition
  - `is_active`: Boolean - Whether template is active
  - `created_at`: DateTime - Creation timestamp
- **Relationships:**
  - Has many WorkOrders (one-to-many through document_type)

**EvalResult**
- **Purpose:** Stores evaluation results for quality assurance and performance monitoring
- **Key Attributes:**
  - `id`: UUID - Unique evaluation result identifier
  - `work_item_id`: UUID - Associated work item
  - `evaluation_type`: String - Type of evaluation performed
  - `score`: Float - Evaluation score (0.0 to 1.0)
  - `metrics`: JSON - Detailed evaluation metrics
  - `passed`: Boolean - Whether evaluation passed threshold
  - `created_at`: DateTime - When evaluation was performed
- **Relationships:**
  - Belongs to WorkItem (many-to-one)
