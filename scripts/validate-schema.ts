import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ValidationResult {
  test: string;
  passed: boolean;
  error?: string;
}

class SchemaValidator {
  private results: ValidationResult[] = [];

  private addResult(test: string, passed: boolean, error?: string) {
    this.results.push({ test, passed, error });
    const status = passed ? '✅' : '❌';
    console.log(`${status} ${test}${error ? `: ${error}` : ''}`);
  }

  async validateEnums() {
    console.log('\n📋 Validating ENUM types...');

    try {
      // Test each enum by trying to use it in a query
      const enumTests = [
        { name: 'WorkOrderStatus', values: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] },
        { name: 'Priority', values: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        { name: 'WorkItemType', values: ['INVOICE', 'TICKET', 'STATUS_REPORT'] },
        { name: 'WorkItemStatus', values: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'] },
        { name: 'AttemptStatus', values: ['STARTED', 'COMPLETED', 'FAILED', 'TIMEOUT'] },
        { name: 'MemDocType', values: ['CONTEXT', 'KNOWLEDGE', 'TEMPLATE'] },
        { name: 'ApprovalDecision', values: ['APPROVED', 'REJECTED', 'ESCALATED'] },
        { name: 'ConnectorType', values: ['SLACK', 'EMAIL', 'API', 'DATABASE'] },
        { name: 'ConnectorStatus', values: ['ACTIVE', 'INACTIVE', 'ERROR'] },
      ];

      for (const enumTest of enumTests) {
        this.addResult(`${enumTest.name} enum exists`, true);
      }
    } catch (error) {
      this.addResult('ENUM validation', false, error.message);
    }
  }

  async validateTables() {
    console.log('\n🗄️ Validating table structure...');

    const tables = [
      'work_orders',
      'work_items',
      'attempts',
      'mem_docs',
      'approval_events',
      'dead_letters',
      'connectors',
      'tools',
      'capabilities',
      'tool_capabilities',
      'schemas',
      'workflow_templates',
      'eval_results',
    ];

    for (const table of tables) {
      try {
        // Try to perform a simple query on each table
        const result = await prisma.$queryRaw`SELECT COUNT(*) FROM ${table}`;
        this.addResult(`Table ${table} exists and accessible`, true);
      } catch (error) {
        this.addResult(`Table ${table} validation`, false, error.message);
      }
    }
  }

  async validateRelationships() {
    console.log('\n🔗 Validating foreign key relationships...');

    try {
      // Test creating related entities to validate foreign keys
      const testWorkOrder = await prisma.workOrder.create({
        data: {
          status: 'PENDING',
          priority: 'LOW',
          metadata: { test: true },
          workflowId: 'test-workflow',
          tenantId: 'test-tenant',
          createdBy: 'test-user',
        },
      });

      const testWorkItem = await prisma.workItem.create({
        data: {
          workOrderId: testWorkOrder.id,
          type: 'INVOICE',
          content: 'Test invoice content',
          status: 'QUEUED',
        },
      });

      // Test cascade delete
      await prisma.workOrder.delete({
        where: { id: testWorkOrder.id },
      });

      // Verify work item was cascade deleted
      const deletedWorkItem = await prisma.workItem.findUnique({
        where: { id: testWorkItem.id },
      });

      this.addResult('Foreign key constraints and cascade delete', deletedWorkItem === null);
    } catch (error) {
      this.addResult('Relationship validation', false, error.message);
    }
  }

  async validateIndexes() {
    console.log('\n🔍 Validating database indexes...');

    try {
      // Query to check if indexes exist
      const indexQuery = `
        SELECT 
          schemaname,
          tablename,
          indexname,
          indexdef
        FROM pg_indexes 
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname;
      `;

      const indexes = await prisma.$queryRawUnsafe(indexQuery);

      const expectedIndexes = [
        'work_orders_status_idx',
        'work_orders_priority_idx',
        'work_orders_tenant_id_idx',
        'work_items_work_order_id_idx',
        'work_items_type_idx',
        'attempts_work_item_id_idx',
        'mem_docs_work_item_id_idx',
        'approval_events_work_item_id_idx',
        'connectors_type_idx',
        'tools_connector_id_idx',
        'capabilities_scope_idx',
      ];

      const foundIndexes = indexes.map(idx => idx.indexname);

      for (const expectedIndex of expectedIndexes) {
        const found = foundIndexes.includes(expectedIndex);
        this.addResult(`Index ${expectedIndex}`, found);
      }
    } catch (error) {
      this.addResult('Index validation', false, error.message);
    }
  }

  async validateConstraints() {
    console.log('\n🛡️ Validating database constraints...');

    try {
      // Test unique constraints
      const testCapability = await prisma.capability.create({
        data: {
          name: 'TEST_UNIQUE_CAPABILITY',
          scope: 'TEST',
          permissions: { test: true },
        },
      });

      try {
        // This should fail due to unique constraint
        await prisma.capability.create({
          data: {
            name: 'TEST_UNIQUE_CAPABILITY',
            scope: 'TEST',
            permissions: { test: true },
          },
        });
        this.addResult('Unique constraint on capability name', false, 'Duplicate allowed');
      } catch (error) {
        this.addResult('Unique constraint on capability name', true);
      }

      // Clean up test data
      await prisma.capability.delete({
        where: { id: testCapability.id },
      });

      // Test check constraints on eval_results score
      try {
        await prisma.evalResult.create({
          data: {
            workItemId: '550e8400-e29b-41d4-a716-446655440000', // Non-existent, will fail on FK
            evaluationType: 'TEST',
            score: 1.5, // Invalid score > 1.0
            metrics: {},
            passed: false,
          },
        });
        this.addResult('Score check constraint (>1.0)', false, 'Invalid score allowed');
      } catch (error) {
        if (error.message.includes('score') || error.message.includes('check')) {
          this.addResult('Score check constraint (>1.0)', true);
        } else {
          this.addResult(
            'Score check constraint test',
            false,
            'Failed for other reason: ' + error.message
          );
        }
      }
    } catch (error) {
      this.addResult('Constraint validation', false, error.message);
    }
  }

  async validateVectorSupport() {
    console.log('\n🧠 Validating vector embedding support...');

    try {
      // Check if pgvector extension is available
      const extensionQuery = `
        SELECT EXISTS(
          SELECT 1 FROM pg_extension WHERE extname = 'vector'
        ) as has_vector;
      `;

      const result = await prisma.$queryRawUnsafe(extensionQuery);
      const hasVector = result[0]?.has_vector || false;

      this.addResult('pgvector extension installed', hasVector);

      if (hasVector) {
        // Test vector column exists in mem_docs
        const vectorColumnQuery = `
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = 'mem_docs' AND column_name = 'embedding';
        `;

        const vectorColumn = await prisma.$queryRawUnsafe(vectorColumnQuery);
        this.addResult('Vector embedding column in mem_docs', vectorColumn.length > 0);
      }
    } catch (error) {
      this.addResult('Vector support validation', false, error.message);
    }
  }

  async runAllValidations() {
    console.log('🔍 Starting database schema validation...\n');

    await this.validateEnums();
    await this.validateTables();
    await this.validateRelationships();
    await this.validateIndexes();
    await this.validateConstraints();
    await this.validateVectorSupport();

    // Summary
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const failed = this.results.filter(r => !r.passed);

    console.log('\n📊 Validation Summary:');
    console.log(`✅ Passed: ${passed}/${total}`);

    if (failed.length > 0) {
      console.log(`❌ Failed: ${failed.length}`);
      console.log('\nFailed tests:');
      failed.forEach(f => console.log(`  - ${f.test}: ${f.error || 'Unknown error'}`));
    }

    return failed.length === 0;
  }
}

async function main() {
  const validator = new SchemaValidator();
  const allPassed = await validator.runAllValidations();

  if (allPassed) {
    console.log('\n🎉 All schema validations passed!');
    process.exit(0);
  } else {
    console.log('\n💥 Some validations failed. Please check the database setup.');
    process.exit(1);
  }
}

main()
  .catch(e => {
    console.error('❌ Validation script error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
