# REST API Spec

```yaml
openapi: 3.0.3
info:
  title: MyloWare Platform API
  version: 1.0.0
  description: API for AI-powered document processing with human-in-the-loop governance
servers:
  - url: https://api.myloware.com/v1
    description: Production API server
  - url: https://staging-api.myloware.com/v1
    description: Staging API server

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key

  schemas:
    WorkOrder:
      type: object
      properties:
        id:
          type: string
          format: uuid
          description: Unique work order identifier
        status:
          type: string
          enum: [PENDING, PROCESSING, COMPLETED, FAILED]
          description: Current processing status
        priority:
          type: string
          enum: [LOW, MEDIUM, HIGH, URGENT]
          description: Processing priority
        metadata:
          type: object
          description: Flexible metadata storage
        created_at:
          type: string
          format: date-time
        updated_at:
          type: string
          format: date-time
        workflow_id:
          type: string
          description: Temporal workflow identifier
        tenant_id:
          type: string
          format: uuid
      required: [id, status, priority, created_at, tenant_id]

    WorkItem:
      type: object
      properties:
        id:
          type: string
          format: uuid
        work_order_id:
          type: string
          format: uuid
        type:
          type: string
          enum: [INVOICE, TICKET, STATUS_REPORT]
        content:
          type: string
          description: Raw document content or file reference
        status:
          type: string
          enum: [QUEUED, PROCESSING, COMPLETED, FAILED]
        result:
          type: object
          description: Extracted and processed data
        created_at:
          type: string
          format: date-time
        processed_at:
          type: string
          format: date-time
      required: [id, work_order_id, type, content, status, created_at]

    ApiResponse:
      type: object
      properties:
        success:
          type: boolean
        data:
          type: object
        message:
          type: string
        timestamp:
          type: string
          format: date-time

paths:
  /work-orders:
    get:
      summary: List work orders
      security:
        - BearerAuth: []
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [PENDING, PROCESSING, COMPLETED, FAILED]
        - name: priority
          in: query
          schema:
            type: string
            enum: [LOW, MEDIUM, HIGH, URGENT]
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
      responses:
        '200':
          description: List of work orders
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/WorkOrder'
                  pagination:
                    type: object
                    properties:
                      total:
                        type: integer
                      limit:
                        type: integer
                      offset:
                        type: integer

    post:
      summary: Create new work order
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                priority:
                  type: string
                  enum: [LOW, MEDIUM, HIGH, URGENT]
                  default: MEDIUM
                metadata:
                  type: object
                  description: Document-specific metadata
                work_items:
                  type: array
                  items:
                    type: object
                    properties:
                      type:
                        type: string
                        enum: [INVOICE, TICKET, STATUS_REPORT]
                      content:
                        type: string
                        description: Document content or file reference
              required: [work_items]
      responses:
        '201':
          description: Work order created successfully
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
                  - type: object
                    properties:
                      data:
                        $ref: '#/components/schemas/WorkOrder'

  /work-orders/{workOrderId}:
    get:
      summary: Get work order by ID
      security:
        - BearerAuth: []
      parameters:
        - name: workOrderId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Work order details
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
                  - type: object
                    properties:
                      data:
                        $ref: '#/components/schemas/WorkOrder'

  /work-orders/{workOrderId}/work-items:
    get:
      summary: List work items for a work order
      security:
        - BearerAuth: []
      parameters:
        - name: workOrderId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: List of work items
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/WorkItem'

  /work-items/{workItemId}:
    get:
      summary: Get work item by ID
      security:
        - BearerAuth: []
      parameters:
        - name: workItemId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Work item details
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
                  - type: object
                    properties:
                      data:
                        $ref: '#/components/schemas/WorkItem'

  /work-items/{workItemId}/attempts:
    get:
      summary: List processing attempts for a work item
      security:
        - BearerAuth: []
      parameters:
        - name: workItemId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: List of processing attempts
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                          format: uuid
                        agent_id:
                          type: string
                        status:
                          type: string
                          enum: [STARTED, COMPLETED, FAILED, TIMEOUT]
                        started_at:
                          type: string
                          format: date-time
                        completed_at:
                          type: string
                          format: date-time
                        duration_ms:
                          type: integer

  /approvals:
    post:
      summary: Submit approval decision
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                work_item_id:
                  type: string
                  format: uuid
                decision:
                  type: string
                  enum: [APPROVED, REJECTED, ESCALATED]
                reason:
                  type: string
                  description: Reason for decision
              required: [work_item_id, decision]
      responses:
        '200':
          description: Approval decision submitted successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiResponse'

  /health:
    get:
      summary: Health check endpoint
      responses:
        '200':
          description: Service is healthy
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    enum: [healthy, degraded, unhealthy]
                  timestamp:
                    type: string
                    format: date-time
                  version:
                    type: string
                  checks:
                    type: object
                    properties:
                      database:
                        type: string
                        enum: [healthy, degraded, unhealthy]
                      redis:
                        type: string
                        enum: [healthy, degraded, unhealthy]
                      temporal:
                        type: string
                        enum: [healthy, degraded, unhealthy]
```
