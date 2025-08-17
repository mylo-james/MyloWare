import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create initial capabilities
  const readCapability = await prisma.capability.upsert({
    where: { name: 'READ_DOCUMENTS' },
    update: {},
    create: {
      name: 'READ_DOCUMENTS',
      description: 'Ability to read and access documents',
      scope: 'document',
      permissions: {
        actions: ['read', 'view'],
        resources: ['documents', 'work_items']
      }
    }
  });

  const writeCapability = await prisma.capability.upsert({
    where: { name: 'WRITE_DOCUMENTS' },
    update: {},
    create: {
      name: 'WRITE_DOCUMENTS',
      description: 'Ability to create and modify documents',
      scope: 'document',
      permissions: {
        actions: ['create', 'update', 'delete'],
        resources: ['documents', 'work_items']
      }
    }
  });

  const approveCapability = await prisma.capability.upsert({
    where: { name: 'APPROVE_WORKFLOWS' },
    update: {},
    create: {
      name: 'APPROVE_WORKFLOWS',
      description: 'Ability to approve workflow decisions',
      scope: 'workflow',
      permissions: {
        actions: ['approve', 'reject', 'escalate'],
        resources: ['approval_events', 'work_items']
      }
    }
  });

  console.log('✅ Created capabilities');

  // Create initial connectors
  const slackConnector = await prisma.connector.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Slack Integration',
      type: 'SLACK',
      config: {
        webhookUrl: 'https://hooks.slack.com/services/...',
        channels: ['#general', '#alerts'],
        botToken: 'xoxb-...'
      },
      status: 'ACTIVE',
      tenantId: '00000000-0000-0000-0000-000000000001'
    }
  });

  const emailConnector = await prisma.connector.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Email Notifications',
      type: 'EMAIL',
      config: {
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        from: 'notifications@myloware.com'
      },
      status: 'ACTIVE',
      tenantId: '00000000-0000-0000-0000-000000000001'
    }
  });

  console.log('✅ Created connectors');

  // Create initial tools
  const slackNotificationTool = await prisma.tool.create({
    data: {
      name: 'Slack Notification',
      description: 'Send notifications to Slack channels',
      connectorId: slackConnector.id,
      schema: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          message: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] }
        },
        required: ['channel', 'message']
      },
      isActive: true
    }
  });

  const emailNotificationTool = await prisma.tool.create({
    data: {
      name: 'Email Notification',
      description: 'Send email notifications',
      connectorId: emailConnector.id,
      schema: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] }
        },
        required: ['to', 'subject', 'body']
      },
      isActive: true
    }
  });

  console.log('✅ Created tools');

  // Associate tools with capabilities
  await prisma.toolCapability.createMany({
    data: [
      {
        toolId: slackNotificationTool.id,
        capabilityId: writeCapability.id
      },
      {
        toolId: emailNotificationTool.id,
        capabilityId: writeCapability.id
      }
    ]
  });

  console.log('✅ Associated tools with capabilities');

  // Create initial schemas
  const invoiceSchema = await prisma.schema.create({
    data: {
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
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                quantity: { type: 'number' },
                unitPrice: { type: 'number' }
              }
            }
          }
        },
        required: ['invoiceNumber', 'amount', 'currency', 'vendor']
      },
      isActive: true
    }
  });

  console.log('✅ Created schemas');

  // Create initial workflow templates
  const invoiceProcessingTemplate = await prisma.workflowTemplate.create({
    data: {
      name: 'Invoice Processing Workflow',
      description: 'Standard workflow for processing invoices',
      documentType: 'INVOICE',
      workflowDefinition: {
        steps: [
          {
            id: 'extract',
            name: 'Extract Invoice Data',
            type: 'extraction',
            config: {
              fields: ['invoiceNumber', 'amount', 'vendor', 'dueDate']
            }
          },
          {
            id: 'validate',
            name: 'Validate Invoice',
            type: 'validation',
            config: {
              rules: ['amount_positive', 'vendor_exists', 'due_date_future']
            }
          },
          {
            id: 'approve',
            name: 'Human Approval',
            type: 'approval',
            config: {
              threshold: 1000,
              approvers: ['finance@company.com']
            }
          },
          {
            id: 'process',
            name: 'Process Payment',
            type: 'action',
            config: {
              action: 'create_payment_request'
            }
          }
        ]
      },
      isActive: true
    }
  });

  console.log('✅ Created workflow templates');

  // Create a sample work order for testing
  const sampleWorkOrder = await prisma.workOrder.create({
    data: {
      status: 'PENDING',
      priority: 'MEDIUM',
      metadata: {
        source: 'email',
        originalSender: 'vendor@example.com'
      },
      workflowId: 'invoice-processing-v1',
      tenantId: '00000000-0000-0000-0000-000000000001',
      createdBy: 'system'
    }
  });

  // Create a sample work item
  const sampleWorkItem = await prisma.workItem.create({
    data: {
      workOrderId: sampleWorkOrder.id,
      type: 'INVOICE',
      content: 'Sample invoice content for testing purposes',
      status: 'QUEUED'
    }
  });

  console.log('✅ Created sample work order and work item');

  console.log('🎉 Database seeding completed successfully!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });