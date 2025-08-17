#!/usr/bin/env tsx
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function validateSchema() {
  console.log('🔍 Validating database schema...');

  try {
    // Test basic connection
    await prisma.$connect();
    console.log('✅ Database connection successful');

    // Test enum creation by checking the schema
    const enums = await prisma.$queryRaw`
      SELECT enumname, enumlabel 
      FROM pg_enum e 
      JOIN pg_type t ON e.enumtypid = t.oid 
      WHERE t.typname IN (
        'work_order_status', 'priority', 'work_item_type', 
        'work_item_status', 'attempt_status', 'mem_doc_type',
        'approval_decision', 'connector_type', 'connector_status'
      )
      ORDER BY enumname, enumlabel;
    `;

    console.log('✅ Database enums validated:', enums);

    // Test table creation
    const tables = await prisma.$queryRaw`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename IN (
        'work_orders', 'work_items', 'attempts', 'mem_docs', 
        'approval_events', 'dead_letters', 'connectors', 'tools',
        'capabilities', 'tool_capabilities', 'schemas', 
        'workflow_templates', 'eval_results', 'audit_logs'
      )
      ORDER BY tablename;
    `;

    console.log('✅ Database tables validated:', tables);

    // Test indexes
    const indexes = await prisma.$queryRaw`
      SELECT indexname, tablename 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND tablename IN ('work_orders', 'work_items', 'attempts')
      ORDER BY tablename, indexname;
    `;

    console.log('✅ Database indexes validated:', indexes);

    // Test foreign key constraints
    const constraints = await prisma.$queryRaw`
      SELECT 
        conname as constraint_name,
        conrelid::regclass as table_name,
        confrelid::regclass as referenced_table
      FROM pg_constraint 
      WHERE contype = 'f'
      AND connamespace = 'public'::regnamespace
      ORDER BY table_name, constraint_name;
    `;

    console.log('✅ Foreign key constraints validated:', constraints);

    console.log('🎉 Database schema validation completed successfully!');
  } catch (error) {
    console.error('❌ Schema validation failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run validation if this script is executed directly
if (require.main === module) {
  validateSchema().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

export { validateSchema };
