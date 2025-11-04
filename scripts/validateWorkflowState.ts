#!/usr/bin/env tsx
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface Violation {
  workflow: string;
  node: string;
  type:
    | 'output_overwrite'
    | 'stage_overwrite'
    | 'missing_merge'
    | 'missing_error_handler'
    | 'missing_required_node';
  severity: 'critical' | 'high' | 'medium';
  location: string;
  recommendation: string;
}

interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  parameters?: {
    jsCode?: string;
    functionCode?: string;
    method?: string;
    url?: string;
    [key: string]: unknown;
  };
}

interface N8nWorkflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  connections?: Record<string, unknown>;
}

interface ValidationReport {
  workflow: string;
  violations: Violation[];
  critical: number;
  high: number;
  medium: number;
  passed: boolean;
}

const WORKFLOWS_DIR = join(process.cwd(), 'workflows');
const REQUIRED_NODE_PATTERNS = {
  loadState: /get.*run|load.*state|fetch.*workflow/i,
  normalizeState: /normalize|extract.*state|flatten/i,
  markStageStart: /mark.*start|stage.*start|begin/i,
  markStageComplete: /mark.*complete|stage.*complete|finish/i,
};

function validateWorkflow(filePath: string): ValidationReport {
  const violations: Violation[] = [];
  const workflowName = filePath.split('/').pop() || filePath;

  let workflow: N8nWorkflow;
  try {
    const content = readFileSync(filePath, 'utf-8');
    workflow = JSON.parse(content);
  } catch (error) {
    return {
      workflow: workflowName,
      violations: [
        {
          workflow: workflowName,
          node: 'N/A',
          type: 'missing_required_node',
          severity: 'critical',
          location: 'File',
          recommendation: `Failed to parse workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      critical: 1,
      high: 0,
      medium: 0,
      passed: false,
    };
  }

  // Skip workflows that don't use workflow_runs (like chat, mylo-mcp-bot)
  const usesWorkflowRuns = workflow.nodes.some(
    (node) =>
      node.parameters?.url?.includes('/api/workflow-runs') ||
      node.parameters?.url?.includes('/workflow-runs/'),
  );

  if (!usesWorkflowRuns) {
    console.log(`  ℹ️  Skipping ${workflowName} - doesn't use workflow_runs`);
    return {
      workflow: workflowName,
      violations: [],
      critical: 0,
      high: 0,
      medium: 0,
      passed: true,
    };
  }

  // Check for required nodes
  const hasErrorHandler = workflow.nodes.some(
    (node) => node.type === 'n8n-nodes-base.errorTrigger',
  );

  if (!hasErrorHandler) {
    violations.push({
      workflow: workflowName,
      node: 'Workflow',
      type: 'missing_error_handler',
      severity: 'high',
      location: 'Missing node',
      recommendation: 'Add an Error Trigger node to handle workflow failures and preserve state',
    });
  }

  // Validate each code node
  for (const node of workflow.nodes) {
    const code = node.parameters?.jsCode || node.parameters?.functionCode || '';

    if (!code || typeof code !== 'string') {
      continue;
    }

    // Check for output overwrite without spread
    if (checkOutputOverwrite(code, node, workflowName, violations)) {
      // Violation added
    }

    // Check for stages overwrite without cloning
    if (checkStageOverwrite(code, node, workflowName, violations)) {
      // Violation added
    }

    // Check error handlers preserve state
    if (node.type === 'n8n-nodes-base.errorTrigger' || node.name.toLowerCase().includes('error')) {
      checkErrorHandlerPreservation(code, node, workflowName, violations);
    }

    // Check PATCH requests to workflow-runs
    if (node.parameters?.method === 'PATCH' && node.parameters?.url?.includes('/workflow-runs/')) {
      checkPatchRequestMerging(code, node, workflowName, violations);
    }
  }

  const critical = violations.filter((v) => v.severity === 'critical').length;
  const high = violations.filter((v) => v.severity === 'high').length;
  const medium = violations.filter((v) => v.severity === 'medium').length;

  return {
    workflow: workflowName,
    violations,
    critical,
    high,
    medium,
    passed: violations.length === 0,
  };
}

function checkOutputOverwrite(
  code: string,
  node: WorkflowNode,
  workflow: string,
  violations: Violation[],
): boolean {
  // Check for "output: {" without "...run.output" or "...(run.output"
  const outputAssignment = /output\s*:\s*\{/g;
  const hasOutputSpread = /\.\.\.\s*\(?run\.output|spread\(run\.output\)/;

  if (outputAssignment.test(code) && !hasOutputSpread.test(code)) {
    // Check if this is actually setting output (not just defining a variable)
    const returnPattern = /return\s*\{[^}]*output\s*:/s;

    if (returnPattern.test(code)) {
      violations.push({
        workflow,
        node: node.name,
        type: 'output_overwrite',
        severity: 'critical',
        location: `Node: ${node.name} (${node.type})`,
        recommendation: 'Always preserve prior outputs: `output: { ...(run.output ?? {}), ... }`',
      });
      return true;
    }
  }
  return false;
}

function checkStageOverwrite(
  code: string,
  node: WorkflowNode,
  workflow: string,
  violations: Violation[],
): boolean {
  // Check for "stages: {" without proper cloning
  const stagesAssignment = /stages\s*:\s*\{/g;
  const hasCloneFunction = /const\s+clone\s*=/;
  const hasStageClone = /clone\s*\(\s*stages\./;

  if (stagesAssignment.test(code)) {
    if (!hasCloneFunction.test(code) && !hasStageClone.test(code)) {
      // Check if directly assigning stages without cloning
      const directStageAssignment = /stages\s*:\s*\{[^}]*idea_generation\s*:\s*\{/s;

      if (directStageAssignment.test(code)) {
        violations.push({
          workflow,
          node: node.name,
          type: 'stage_overwrite',
          severity: 'high',
          location: `Node: ${node.name} (${node.type})`,
          recommendation:
            'Use clone function for stages: `const clone = (value) => (value && typeof value === "object" ? { ...value } : {})`',
        });
        return true;
      }
    }
  }
  return false;
}

function checkErrorHandlerPreservation(
  code: string,
  node: WorkflowNode,
  workflow: string,
  violations: Violation[],
): void {
  // Error handlers must preserve prior outputs
  const hasOutputPreservation = /\.\.\.\s*\(?run\.output|spread\(run\.output\)/;
  const setsOutput = /output\s*:\s*\{/;

  if (setsOutput.test(code) && !hasOutputPreservation.test(code)) {
    violations.push({
      workflow,
      node: node.name,
      type: 'output_overwrite',
      severity: 'critical',
      location: `Error Handler: ${node.name}`,
      recommendation: 'Error handlers MUST preserve prior outputs to prevent data loss on failure',
    });
  }
}

function checkPatchRequestMerging(
  code: string,
  node: WorkflowNode,
  workflow: string,
  violations: Violation[],
): void {
  // PATCH requests to workflow-runs should merge state
  const hasOutputSpread = /\.\.\.\s*\(?run\.output|spread\(run\.output\)/;
  const setsOutput = /output\s*:\s*\{/;

  if (setsOutput.test(code) && !hasOutputSpread.test(code)) {
    violations.push({
      workflow,
      node: node.name,
      type: 'missing_merge',
      severity: 'critical',
      location: `PATCH Request: ${node.name}`,
      recommendation:
        'PATCH requests must merge with existing state: `output: { ...(run.output ?? {}), ... }`',
    });
  }
}

function printReport(reports: ValidationReport[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('WORKFLOW STATE MANAGEMENT VALIDATION REPORT');
  console.log('='.repeat(80) + '\n');

  const totalViolations = reports.reduce((sum, r) => sum + r.violations.length, 0);
  const totalCritical = reports.reduce((sum, r) => sum + r.critical, 0);
  const totalHigh = reports.reduce((sum, r) => sum + r.high, 0);
  const totalMedium = reports.reduce((sum, r) => sum + r.medium, 0);
  const passedCount = reports.filter((r) => r.passed).length;

  console.log(`Summary: ${reports.length} workflows validated`);
  console.log(`  ✅ Passed: ${passedCount}`);
  console.log(`  ❌ Failed: ${reports.length - passedCount}`);
  console.log(`  🔴 Critical: ${totalCritical}`);
  console.log(`  🟡 High: ${totalHigh}`);
  console.log(`  🟠 Medium: ${totalMedium}\n`);

  for (const report of reports) {
    if (report.violations.length === 0) {
      console.log(`✅ ${report.workflow} - PASSED`);
      continue;
    }

    console.log(`\n❌ ${report.workflow} - ${report.violations.length} violation(s)`);
    console.log(
      `   Critical: ${report.critical} | High: ${report.high} | Medium: ${report.medium}\n`,
    );

    for (const violation of report.violations) {
      const emoji =
        violation.severity === 'critical' ? '🔴' : violation.severity === 'high' ? '🟡' : '🟠';

      console.log(`   ${emoji} ${violation.type.toUpperCase()}`);
      console.log(`      Location: ${violation.location}`);
      console.log(`      Fix: ${violation.recommendation}\n`);
    }
  }

  console.log('='.repeat(80));
  console.log(`Total Violations: ${totalViolations}`);
  console.log('='.repeat(80) + '\n');

  if (totalViolations > 0) {
    console.log('❌ Validation FAILED - Fix violations before proceeding\n');
    process.exit(1);
  } else {
    console.log('✅ All workflows passed validation!\n');
    process.exit(0);
  }
}

function saveReport(reports: ValidationReport[]): void {
  const reportPath = join(process.cwd(), 'docs', 'WORKFLOW_VALIDATION_REPORT.md');

  let markdown = '# Workflow State Management Validation Report\n\n';
  markdown += `**Generated:** ${new Date().toISOString()}\n\n`;

  const totalViolations = reports.reduce((sum, r) => sum + r.violations.length, 0);
  const totalCritical = reports.reduce((sum, r) => sum + r.critical, 0);
  const totalHigh = reports.reduce((sum, r) => sum + r.high, 0);
  const totalMedium = reports.reduce((sum, r) => sum + r.medium, 0);
  const passedCount = reports.filter((r) => r.passed).length;

  markdown += '## Summary\n\n';
  markdown += `- **Total Workflows:** ${reports.length}\n`;
  markdown += `- **Passed:** ${passedCount}\n`;
  markdown += `- **Failed:** ${reports.length - passedCount}\n`;
  markdown += `- **Critical Violations:** ${totalCritical}\n`;
  markdown += `- **High Violations:** ${totalHigh}\n`;
  markdown += `- **Medium Violations:** ${totalMedium}\n\n`;

  markdown += '## Workflow Details\n\n';

  for (const report of reports) {
    markdown += `### ${report.workflow}\n\n`;

    if (report.violations.length === 0) {
      markdown += '✅ **Status:** PASSED\n\n';
      continue;
    }

    markdown += `❌ **Status:** FAILED (${report.violations.length} violations)\n\n`;
    markdown += `| Severity | Type | Location | Recommendation |\n`;
    markdown += `|----------|------|----------|----------------|\n`;

    for (const v of report.violations) {
      const emoji = v.severity === 'critical' ? '🔴' : v.severity === 'high' ? '🟡' : '🟠';
      markdown += `| ${emoji} ${v.severity} | ${v.type} | ${v.location} | ${v.recommendation} |\n`;
    }
    markdown += '\n';
  }

  const fs = require('node:fs');
  fs.writeFileSync(reportPath, markdown);
  console.log(`📄 Report saved to: ${reportPath}\n`);
}

function main(): void {
  const args = process.argv.slice(2);
  const workflows =
    args.length > 0
      ? args.map((f) => join(WORKFLOWS_DIR, f))
      : readdirSync(WORKFLOWS_DIR)
          .filter((f) => f.endsWith('.workflow.json'))
          .map((f) => join(WORKFLOWS_DIR, f));

  console.log(`\n🔍 Validating ${workflows.length} workflow(s)...\n`);

  const reports: ValidationReport[] = [];

  for (const workflowPath of workflows) {
    const report = validateWorkflow(workflowPath);
    reports.push(report);
  }

  saveReport(reports);
  printReport(reports);
}

if (require.main === module) {
  main();
}

export { validateWorkflow, type Violation, type ValidationReport };
