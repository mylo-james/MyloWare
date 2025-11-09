#!/usr/bin/env tsx
import { WorkflowMappingRepository } from '../../src/db/repositories/workflow-mapping-repository.js';

/**
 * Register workflow mappings: human-readable keys → n8n workflow IDs
 * 
 * This script syncs workflow IDs from your n8n instance to the database.
 * Run this after importing workflows to a new environment or when workflow IDs change.
 * 
 * Usage:
 *   N8N_BASE_URL=https://n8n.example.com N8N_API_KEY=your-key npm run register:workflows
 * 
 * Or set environment variables:
 *   - N8N_WORKFLOW_ID_UPLOAD_GOOGLE_DRIVE
 *   - N8N_WORKFLOW_ID_UPLOAD_TIKTOK
 *   - N8N_WORKFLOW_ID_SHOTSTACK_EDIT
 *   - N8N_WORKFLOW_ID_GENERATE_VIDEO
 */
async function registerWorkflowMappings() {
  console.log('🔄 Registering workflow mappings...\n');

  const repository = new WorkflowMappingRepository();
  const environment = process.env.N8N_ENVIRONMENT || 'production';

  // Define mappings: workflowKey → workflowName → default workflow ID (from env or hardcoded)
  const mappings = [
    {
      workflowKey: 'upload-google-drive',
      workflowName: 'Upload file to Google Drive',
      description: 'Uploads files to Google Drive. Called by Quinn when publishing assets.',
      workflowId: process.env.N8N_WORKFLOW_ID_UPLOAD_GOOGLE_DRIVE || 'zvJoSOEUDr9hXOLV',
    },
    {
      workflowKey: 'upload-tiktok',
      workflowName: 'Upload to TikTok',
      description: 'Uploads videos to TikTok. Called by Quinn when publishing final edits.',
      workflowId: process.env.N8N_WORKFLOW_ID_UPLOAD_TIKTOK || 'uIWB6d8OslTpJl1G',
    },
    {
      workflowKey: 'shotstack-edit',
      workflowName: 'Edit_AISMR',
      description: 'Edits and stitches video compilations using Shotstack API. Called by Alex.',
      workflowId: process.env.N8N_WORKFLOW_ID_SHOTSTACK_EDIT || '9bJoXKRxCLs0B0Ww',
    },
    {
      workflowKey: 'generate-video',
      workflowName: 'Generate Video',
      description: 'Generates individual video clips from screenplays. Called by Veo.',
      workflowId: process.env.N8N_WORKFLOW_ID_GENERATE_VIDEO || 'ZzHQ2hTTYcdwN63q',
    },
  ];

  for (const mapping of mappings) {
    try {
      if (!mapping.workflowId) {
        console.log(`⚠️  Skipping "${mapping.workflowName}" - no workflow ID provided`);
        console.log(`   Set N8N_WORKFLOW_ID_${mapping.workflowKey.toUpperCase().replace(/-/g, '_')} env var\n`);
        continue;
      }

      await repository.upsert({
        workflowKey: mapping.workflowKey,
        workflowId: mapping.workflowId,
        workflowName: mapping.workflowName,
        description: mapping.description,
        environment,
        isActive: true,
        metadata: {
          registeredAt: new Date().toISOString(),
          registeredBy: 'register-workflow-mappings.ts',
        },
      });

      console.log(`✅ Registered "${mapping.workflowName}"`);
      console.log(`   Key: ${mapping.workflowKey}`);
      console.log(`   ID: ${mapping.workflowId}`);
      console.log(`   Environment: ${environment}\n`);
    } catch (error) {
      console.error(`❌ Failed to register "${mapping.workflowName}":`, error);
      if (error instanceof Error) {
        console.error(`   Error: ${error.message}\n`);
      }
    }
  }

  // List all mappings for this environment
  console.log('\n📋 Current workflow mappings:');
  const allMappings = await repository.listByEnvironment(environment);
  if (allMappings.length === 0) {
    console.log('   No mappings found for this environment.\n');
  } else {
    for (const mapping of allMappings) {
      console.log(`   ${mapping.workflowKey} → ${mapping.workflowId} (${mapping.workflowName})`);
    }
    console.log('');
  }

  console.log('✅ Registration complete!');
}

registerWorkflowMappings().catch((error) => {
  console.error('Failed to register workflow mappings:', error);
  process.exit(1);
});


