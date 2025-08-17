import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create sample capabilities
  const readCapability = await prisma.capability.upsert({
    where: { name: 'READ_DOCUMENTS' },
    update: {},
    create: {
      name: 'READ_DOCUMENTS',
      description: 'Ability to read and parse documents',
      scope: 'document',
      permissions: {
        actions: ['read', 'parse'],
        resources: ['documents', 'files'],
      },
    },
  });

  const writeCapability = await prisma.capability.upsert({
    where: { name: 'WRITE_RESULTS' },
    update: {},
    create: {
      name: 'WRITE_RESULTS',
      description: 'Ability to write processing results',
      scope: 'result',
      permissions: {
        actions: ['write', 'update'],
        resources: ['results', 'outputs'],
      },
    },
  });

  // Create sample connector
  const slackConnector = await prisma.connector.upsert({
    where: { id: '550e8400-e29b-41d4-a716-446655440000' },
    update: {},
    create: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Slack Integration',
      type: 'SLACK',
      status: 'ACTIVE',
      tenantId: '550e8400-e29b-41d4-a716-446655440001',
      config: {
        botToken: 'xoxb-example-token',
        signingSecret: 'example-signing-secret',
        appId: 'A1234567890',
      },
    },
  });

  // Create sample tools
  const documentProcessor = await prisma.tool.create({
    data: {
      name: 'Document Processor',
      description: 'AI-powered document processing tool',
      connectorId: slackConnector.id,
      schema: {
        type: 'object',
        properties: {
          documentUrl: { type: 'string' },
          processingType: { type: 'string', enum: ['extract', 'classify', 'summarize'] },
        },
        required: ['documentUrl', 'processingType'],
      },
      capabilities: {
        create: [{ capabilityId: readCapability.id }, { capabilityId: writeCapability.id }],
      },
    },
  });

  // Create sample schema
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
          dueDate: { type: 'string', format: 'date' },
          vendor: { type: 'string' },
        },
        required: ['invoiceNumber', 'amount', 'vendor'],
      },
    },
  });

  // Create sample workflow template
  const invoiceWorkflow = await prisma.workflowTemplate.create({
    data: {
      name: 'Invoice Processing Workflow',
      description: 'Standard workflow for processing invoices',
      documentType: 'INVOICE',
      workflowDefinition: {
        steps: [
          { id: 'extract', type: 'ai_extraction', tool: 'document_processor' },
          { id: 'validate', type: 'schema_validation', schema: 'invoice_schema_v1' },
          { id: 'approve', type: 'human_approval', policy: 'finance_approval' },
        ],
        transitions: [
          { from: 'extract', to: 'validate', condition: 'success' },
          { from: 'validate', to: 'approve', condition: 'valid' },
          { from: 'approve', to: 'complete', condition: 'approved' },
        ],
      },
    },
  });

  // Create sample work order
  const sampleWorkOrder = await prisma.workOrder.create({
    data: {
      workflowId: 'invoice-processing-v1',
      tenantId: '550e8400-e29b-41d4-a716-446655440001',
      createdBy: '550e8400-e29b-41d4-a716-446655440002',
      priority: 'MEDIUM',
      metadata: {
        source: 'email',
        requestor: 'finance@company.com',
        tags: ['urgent', 'q4-2024'],
      },
    },
  });

  // Create sample work item
  const sampleWorkItem = await prisma.workItem.create({
    data: {
      workOrderId: sampleWorkOrder.id,
      type: 'INVOICE',
      content: 'Sample invoice content for processing',
      metadata: {
        documentUrl: 'https://example.com/invoice-123.pdf',
        fileSize: 245760,
        mimeType: 'application/pdf',
      },
    },
  });

  console.log('✅ Database seeding completed successfully!');
  console.log(`Created sample data:`);
  console.log(`- Capabilities: ${readCapability.name}, ${writeCapability.name}`);
  console.log(`- Connector: ${slackConnector.name}`);
  console.log(`- Tool: ${documentProcessor.name}`);
  console.log(`- Schema: ${invoiceSchema.name} v${invoiceSchema.version}`);
  console.log(`- Workflow Template: ${invoiceWorkflow.name}`);
  console.log(`- Work Order: ${sampleWorkOrder.id}`);
  console.log(`- Work Item: ${sampleWorkItem.id}`);
}

main()
  .catch(e => {
    console.error('❌ Database seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
