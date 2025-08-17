import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Clean existing data (in reverse dependency order)
  await prisma.evalResult.deleteMany();
  await prisma.approvalEvent.deleteMany();
  await prisma.memDoc.deleteMany();
  await prisma.attempt.deleteMany();
  await prisma.workItem.deleteMany();
  await prisma.workOrder.deleteMany();
  await prisma.toolCapability.deleteMany();
  await prisma.tool.deleteMany();
  await prisma.connector.deleteMany();
  await prisma.capability.deleteMany();
  await prisma.schema.deleteMany();
  await prisma.workflowTemplate.deleteMany();
  await prisma.deadLetter.deleteMany();

  console.log('🧹 Cleaned existing data');

  // Seed Capabilities
  const capabilities = await prisma.capability.createMany({
    data: [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        name: 'READ_DOCUMENTS',
        description: 'Permission to read and access documents',
        scope: 'DOCUMENT',
        permissions: { actions: ['read', 'list'] },
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440002',
        name: 'WRITE_DOCUMENTS',
        description: 'Permission to create and modify documents',
        scope: 'DOCUMENT',
        permissions: { actions: ['create', 'update', 'delete'] },
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440003',
        name: 'APPROVE_WORKFLOWS',
        description: 'Permission to approve workflow decisions',
        scope: 'WORKFLOW',
        permissions: { actions: ['approve', 'reject', 'escalate'] },
      },
    ],
  });
  console.log(`✅ Created ${capabilities.count} capabilities`);

  // Seed Connectors
  const slackConnector = await prisma.connector.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440010',
      name: 'Slack Integration',
      type: 'SLACK',
      config: {
        botToken: 'xoxb-placeholder',
        signingSecret: 'placeholder',
        appId: 'A12345678',
      },
      status: 'ACTIVE',
      tenantId: 'tenant-001',
    },
  });

  const emailConnector = await prisma.connector.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440011',
      name: 'Email Service',
      type: 'EMAIL',
      config: {
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        username: 'noreply@myloware.com',
      },
      status: 'ACTIVE',
      tenantId: 'tenant-001',
    },
  });

  console.log('✅ Created connectors');

  // Seed Tools
  const slackTool = await prisma.tool.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440020',
      name: 'Slack Notifier',
      description: 'Send notifications to Slack channels',
      connectorId: slackConnector.id,
      schema: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          message: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        },
        required: ['channel', 'message'],
      },
      isActive: true,
    },
  });

  const emailTool = await prisma.tool.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440021',
      name: 'Email Sender',
      description: 'Send email notifications',
      connectorId: emailConnector.id,
      schema: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        },
        required: ['to', 'subject', 'body'],
      },
      isActive: true,
    },
  });

  console.log('✅ Created tools');

  // Seed Tool Capabilities
  await prisma.toolCapability.createMany({
    data: [
      {
        toolId: slackTool.id,
        capabilityId: '550e8400-e29b-41d4-a716-446655440001', // READ_DOCUMENTS
      },
      {
        toolId: emailTool.id,
        capabilityId: '550e8400-e29b-41d4-a716-446655440001', // READ_DOCUMENTS
      },
    ],
  });

  console.log('✅ Created tool capabilities');

  // Seed Schemas
  await prisma.schema.createMany({
    data: [
      {
        id: '550e8400-e29b-41d4-a716-446655440030',
        name: 'Invoice Schema',
        version: '1.0.0',
        documentType: 'INVOICE',
        schemaDefinition: {
          type: 'object',
          properties: {
            invoiceNumber: { type: 'string' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            dueDate: { type: 'string', format: 'date' },
            vendor: { type: 'string' },
          },
          required: ['invoiceNumber', 'amount', 'currency', 'dueDate'],
        },
        isActive: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440031',
        name: 'Ticket Schema',
        version: '1.0.0',
        documentType: 'TICKET',
        schemaDefinition: {
          type: 'object',
          properties: {
            ticketId: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
            assignee: { type: 'string' },
          },
          required: ['ticketId', 'title', 'priority'],
        },
        isActive: true,
      },
    ],
  });

  console.log('✅ Created schemas');

  // Seed Workflow Templates
  await prisma.workflowTemplate.createMany({
    data: [
      {
        id: '550e8400-e29b-41d4-a716-446655440040',
        name: 'Invoice Processing Workflow',
        description: 'Standard workflow for processing invoices',
        documentType: 'INVOICE',
        workflowDefinition: {
          steps: [
            { name: 'extract_data', type: 'ai_extraction' },
            { name: 'validate_data', type: 'validation' },
            { name: 'approval_check', type: 'human_approval' },
            { name: 'process_payment', type: 'integration' },
          ],
        },
        isActive: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440041',
        name: 'Ticket Resolution Workflow',
        description: 'Standard workflow for resolving support tickets',
        documentType: 'TICKET',
        workflowDefinition: {
          steps: [
            { name: 'categorize_ticket', type: 'ai_classification' },
            { name: 'route_to_team', type: 'routing' },
            { name: 'generate_response', type: 'ai_generation' },
            { name: 'quality_check', type: 'evaluation' },
          ],
        },
        isActive: true,
      },
    ],
  });

  console.log('✅ Created workflow templates');

  // Seed Work Orders
  const workOrder1 = await prisma.workOrder.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440050',
      status: 'PENDING',
      priority: 'HIGH',
      metadata: {
        source: 'email',
        originalSender: 'accounting@example.com',
      },
      workflowId: 'invoice-processing-v1',
      tenantId: 'tenant-001',
      createdBy: 'system',
    },
  });

  const workOrder2 = await prisma.workOrder.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440051',
      status: 'PROCESSING',
      priority: 'MEDIUM',
      metadata: {
        source: 'slack',
        channel: '#support',
      },
      workflowId: 'ticket-resolution-v1',
      tenantId: 'tenant-001',
      createdBy: 'system',
    },
  });

  console.log('✅ Created work orders');

  // Seed Work Items
  const workItem1 = await prisma.workItem.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440060',
      workOrderId: workOrder1.id,
      type: 'INVOICE',
      content: 'Invoice #INV-2024-001 from ACME Corp for $1,500.00 due 2024-01-15',
      status: 'QUEUED',
    },
  });

  const workItem2 = await prisma.workItem.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440061',
      workOrderId: workOrder2.id,
      type: 'TICKET',
      content: 'Customer reporting login issues with 2FA authentication',
      status: 'PROCESSING',
      processedAt: new Date(),
    },
  });

  console.log('✅ Created work items');

  // Seed Attempts
  await prisma.attempt.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440070',
      workItemId: workItem2.id,
      agentId: 'agent-invoice-processor-v1',
      status: 'COMPLETED',
      input: {
        document: 'Customer reporting login issues with 2FA authentication',
        extractionRules: ['extract_issue_type', 'extract_priority'],
      },
      output: {
        issueType: 'authentication',
        priority: 'HIGH',
        suggestedActions: ['reset_2fa', 'check_account_status'],
      },
      startedAt: new Date(Date.now() - 30000), // 30 seconds ago
      completedAt: new Date(),
      durationMs: 30000,
    },
  });

  console.log('✅ Created attempts');

  // Seed Memory Documents
  await prisma.memDoc.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440080',
      workItemId: workItem1.id,
      type: 'CONTEXT',
      content: 'Invoice processing context: ACME Corp is a trusted vendor with NET30 payment terms',
      metadata: {
        source: 'vendor_database',
        confidence: 0.95,
        tags: ['vendor', 'payment_terms'],
      },
    },
  });

  console.log('✅ Created memory documents');

  // Seed Approval Events
  await prisma.approvalEvent.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440090',
      workItemId: workItem1.id,
      approverId: 'user-finance-manager',
      decision: 'APPROVED',
      reason: 'Invoice amount within approval limits and vendor is verified',
      policyVersion: 'v1.2.0',
    },
  });

  console.log('✅ Created approval events');

  // Seed Evaluation Results
  await prisma.evalResult.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440100',
      workItemId: workItem2.id,
      evaluationType: 'ACCURACY_CHECK',
      score: 0.92,
      metrics: {
        precision: 0.94,
        recall: 0.9,
        f1Score: 0.92,
        processingTime: 1250,
      },
      passed: true,
    },
  });

  console.log('✅ Created evaluation results');

  // Seed Dead Letters (example of failed event)
  await prisma.deadLetter.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440110',
      source: 'slack-webhook',
      eventType: 'MESSAGE_RECEIVED',
      payload: {
        channel: '#general',
        user: 'U12345678',
        text: 'Process this invoice please',
        timestamp: '1703001600',
      },
      error: 'Failed to parse attachment: malformed PDF',
      retryCount: 3,
    },
  });

  console.log('✅ Created dead letters');

  console.log('🎉 Database seeding completed successfully!');

  // Print summary
  const counts = await Promise.all([
    prisma.workOrder.count(),
    prisma.workItem.count(),
    prisma.attempt.count(),
    prisma.memDoc.count(),
    prisma.approvalEvent.count(),
    prisma.deadLetter.count(),
    prisma.connector.count(),
    prisma.tool.count(),
    prisma.capability.count(),
    prisma.schema.count(),
    prisma.workflowTemplate.count(),
    prisma.evalResult.count(),
  ]);

  console.log('\n📊 Seeding Summary:');
  console.log(`Work Orders: ${counts[0]}`);
  console.log(`Work Items: ${counts[1]}`);
  console.log(`Attempts: ${counts[2]}`);
  console.log(`Memory Documents: ${counts[3]}`);
  console.log(`Approval Events: ${counts[4]}`);
  console.log(`Dead Letters: ${counts[5]}`);
  console.log(`Connectors: ${counts[6]}`);
  console.log(`Tools: ${counts[7]}`);
  console.log(`Capabilities: ${counts[8]}`);
  console.log(`Schemas: ${counts[9]}`);
  console.log(`Workflow Templates: ${counts[10]}`);
  console.log(`Evaluation Results: ${counts[11]}`);
}

main()
  .catch(e => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
