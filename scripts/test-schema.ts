import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testSchema() {
  console.log('🧪 Testing Prisma schema...');

  try {
    // Test ENUM usage
    console.log('\n📋 Testing ENUM types...');

    // Test creating a work order with all enum fields
    const workOrder = await prisma.workOrder.create({
      data: {
        status: 'PENDING',
        priority: 'HIGH',
        metadata: {
          test: true,
          description: 'Schema validation test',
        },
        workflowId: 'test-workflow-123',
        tenantId: 'test-tenant-123',
        createdBy: 'test-user-123',
      },
    });
    console.log('✅ WorkOrder created with ENUMs:', workOrder.id);

    // Test creating a work item
    const workItem = await prisma.workItem.create({
      data: {
        workOrderId: workOrder.id,
        type: 'INVOICE',
        content: 'Test invoice for schema validation',
        status: 'QUEUED',
      },
    });
    console.log('✅ WorkItem created:', workItem.id);

    // Test creating an attempt
    const attempt = await prisma.attempt.create({
      data: {
        workItemId: workItem.id,
        agentId: 'test-agent-123',
        status: 'STARTED',
        input: {
          task: 'process_invoice',
          parameters: { amount: 1000 },
        },
      },
    });
    console.log('✅ Attempt created:', attempt.id);

    // Test creating a memory document
    const memDoc = await prisma.memDoc.create({
      data: {
        workItemId: workItem.id,
        type: 'CONTEXT',
        content: 'Test memory document for context storage',
        metadata: {
          source: 'test',
          confidence: 0.95,
        },
      },
    });
    console.log('✅ MemDoc created:', memDoc.id);

    // Test creating a connector and tool
    const connector = await prisma.connector.create({
      data: {
        name: 'Test Connector',
        type: 'API',
        config: {
          endpoint: 'https://api.example.com',
          apiKey: 'test-key',
        },
        status: 'ACTIVE',
        tenantId: 'test-tenant-123',
      },
    });
    console.log('✅ Connector created:', connector.id);

    const tool = await prisma.tool.create({
      data: {
        name: 'Test Tool',
        description: 'A test tool for schema validation',
        connectorId: connector.id,
        schema: {
          type: 'object',
          properties: {
            input: { type: 'string' },
          },
        },
        isActive: true,
      },
    });
    console.log('✅ Tool created:', tool.id);

    // Test querying with relationships
    console.log('\n🔗 Testing relationships...');

    const workOrderWithItems = await prisma.workOrder.findUnique({
      where: { id: workOrder.id },
      include: {
        workItems: {
          include: {
            attempts: true,
            memDocs: true,
          },
        },
      },
    });

    console.log('✅ Relationship query successful');
    console.log(`   Work order has ${workOrderWithItems?.workItems.length} work items`);
    console.log(`   Work item has ${workOrderWithItems?.workItems[0]?.attempts.length} attempts`);
    console.log(`   Work item has ${workOrderWithItems?.workItems[0]?.memDocs.length} memory docs`);

    // Test complex query with filtering
    const activeConnectors = await prisma.connector.findMany({
      where: {
        status: 'ACTIVE',
        tenantId: 'test-tenant-123',
      },
      include: {
        tools: {
          where: {
            isActive: true,
          },
        },
      },
    });

    console.log(`✅ Complex query successful: Found ${activeConnectors.length} active connectors`);

    // Clean up test data
    console.log('\n🧹 Cleaning up test data...');
    await prisma.workOrder.delete({
      where: { id: workOrder.id },
    });
    await prisma.connector.delete({
      where: { id: connector.id },
    });
    console.log('✅ Test data cleaned up');

    console.log('\n🎉 All schema tests passed!');
    return true;
  } catch (error) {
    console.error('❌ Schema test failed:', error);
    return false;
  }
}

async function main() {
  const success = await testSchema();
  process.exit(success ? 0 : 1);
}

main()
  .catch(e => {
    console.error('❌ Test script error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
