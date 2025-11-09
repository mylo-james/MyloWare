#!/usr/bin/env tsx
/**
 * Watch n8n Execution
 * 
 * Monitors an n8n workflow execution in real-time and displays detailed logs.
 * 
 * Usage:
 *   npm run watch:execution <workflow-id>
 *   npm run watch:latest      # Watch most recent execution
 */

import { config } from '../../src/config/index.js';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(message: string, color?: keyof typeof colors) {
  const colorCode = color ? colors[color] : '';
  console.log(`${colorCode}${message}${colors.reset}`);
}

type ExecutionRunItem = {
  startTime: number;
  executionTime: number;
  data?: {
    main?: Array<Array<{ json: unknown }>>;
  };
  error?: {
    message: string;
    description?: string;
  };
};

interface ExecutionDetails {
  id: string;
  workflowId: string;
  status: 'running' | 'success' | 'error' | 'waiting';
  startedAt: string;
  stoppedAt?: string;
  workflowData: {
    resultData: {
      runData: Record<string, ExecutionRunItem[]>;
      error?: {
        message: string;
        node?: {
          name: string;
        };
      };
    };
  };
}

async function getExecutionDetails(executionId: string, baseUrl: string, apiKey: string): Promise<ExecutionDetails> {
  const response = await fetch(`${baseUrl}/api/v1/executions/${executionId}?includeData=true`, {
    headers: {
      'X-N8N-API-KEY': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get execution: ${response.status}`);
  }

  return (await response.json()) as ExecutionDetails;
}

async function getLatestExecution(baseUrl: string, apiKey: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/executions?limit=1`, {
    headers: {
      'X-N8N-API-KEY': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to list executions: ${response.status}`);
  }

  const result = (await response.json()) as { data?: Array<{ id: string }> };
  const executions = Array.isArray(result.data) ? result.data : [];
  
  if (executions.length === 0) {
    throw new Error('No executions found');
  }

  return executions[0].id;
}

function displayExecutionDetails(execution: ExecutionDetails) {
  log('\n═══════════════════════════════════════════════════════════', 'bright');
  log('                 EXECUTION DETAILS                          ', 'bright');
  log('═══════════════════════════════════════════════════════════\n', 'bright');

  // Execution Info
  log('📋 EXECUTION INFO', 'cyan');
  log(`   ID:         ${execution.id}`);
  log(`   Workflow:   ${execution.workflowId}`);
  log(`   Status:     ${execution.status}`, execution.status === 'success' ? 'green' : execution.status === 'error' ? 'red' : 'yellow');
  log(`   Started:    ${new Date(execution.startedAt).toLocaleString()}`);
  
  if (execution.stoppedAt) {
    log(`   Stopped:    ${new Date(execution.stoppedAt).toLocaleString()}`);
    const duration = new Date(execution.stoppedAt).getTime() - new Date(execution.startedAt).getTime();
    log(`   Duration:   ${Math.round(duration / 1000)}s`);
  }
  
  log('');

  // Node Execution Details
  const runData = execution.workflowData?.resultData?.runData || {};
  const nodeNames = Object.keys(runData);

  if (nodeNames.length > 0) {
    log('🔧 NODE EXECUTION', 'cyan');
    
    nodeNames.forEach((nodeName, index) => {
      const runs = runData[nodeName];
      const lastRun = runs[runs.length - 1];
      
      const hasError = lastRun.error;
      const statusIcon = hasError ? '❌' : '✅';
      const statusColor = hasError ? 'red' : 'green';
      
      log(`\n   ${statusIcon} [${index + 1}] ${nodeName}`, statusColor);
      log(`      Execution time: ${lastRun.executionTime}ms`, 'gray');
      
      if (hasError) {
        log(`      Error: ${lastRun.error.message}`, 'red');
        if (lastRun.error.description) {
          log(`      Description: ${lastRun.error.description}`, 'yellow');
        }
      } else if (lastRun.data?.main?.[0]) {
        const itemCount = lastRun.data.main[0].length;
        log(`      Output items: ${itemCount}`, 'gray');
        
        // Show first item preview
        if (itemCount > 0) {
          const firstItem = lastRun.data.main[0][0].json;
          const preview = JSON.stringify(firstItem, null, 2).split('\n').slice(0, 5).join('\n');
          log(`      Preview: ${preview}...`, 'gray');
        }
      }
    });
  }

  // Global Error
  if (execution.workflowData?.resultData?.error) {
    log('\n\n❌ WORKFLOW ERROR', 'red');
    log(`   Message: ${execution.workflowData.resultData.error.message}`, 'red');
    if (execution.workflowData.resultData.error.node) {
      log(`   Failed Node: ${execution.workflowData.resultData.error.node.name}`, 'yellow');
    }
  }

  log('\n═══════════════════════════════════════════════════════════\n', 'bright');
}

async function watchExecution(executionId: string, pollInterval = 2000) {
  const baseUrl = process.env.N8N_BASE_URL || config.n8n.baseUrl || 'http://localhost:5678';
  const apiKey = process.env.N8N_API_KEY || config.n8n.apiKey || '';

  if (!apiKey) {
    log('❌ Error: N8N_API_KEY not set', 'red');
    process.exit(1);
  }

  log(`\n👀 Watching execution: ${executionId}`, 'cyan');
  log(`   n8n: ${baseUrl}`, 'gray');
  log(`   Poll interval: ${pollInterval}ms\n`, 'gray');

  let lastStatus = '';
  
  while (true) {
    try {
      const execution = await getExecutionDetails(executionId, baseUrl, apiKey);
      
      if (execution.status !== lastStatus) {
        log(`   Status changed: ${lastStatus || 'unknown'} → ${execution.status}`, 'yellow');
        lastStatus = execution.status;
      } else {
        process.stdout.write('.');
      }

      if (execution.status === 'success' || execution.status === 'error') {
        log('\n\n✅ Execution finished!\n', execution.status === 'success' ? 'green' : 'red');
        displayExecutionDetails(execution);
        break;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
    } catch (error) {
      log(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`, 'red');
      process.exit(1);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  const baseUrl = process.env.N8N_BASE_URL || config.n8n.baseUrl || 'http://localhost:5678';
  const apiKey = process.env.N8N_API_KEY || config.n8n.apiKey || '';

  if (!apiKey) {
    log('❌ Error: N8N_API_KEY not set', 'red');
    log('Set it in .env.dev or pass as environment variable', 'yellow');
    process.exit(1);
  }

  let executionId: string;

  if (args.length === 0 || args[0] === 'latest') {
    log('🔍 Finding latest execution...', 'blue');
    executionId = await getLatestExecution(baseUrl, apiKey);
    log(`   Found: ${executionId}\n`, 'cyan');
  } else {
    executionId = args[0];
  }

  await watchExecution(executionId);
}

main();


