#!/usr/bin/env tsx
import { spawnSync, SpawnSyncOptions } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

type CommandHandler = (args: string[]) => number;

function run(command: string, cmdArgs: string[], options?: SpawnSyncOptions): number {
  const result = spawnSync(command, cmdArgs, {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
    shell: false,
    ...options,
  });
  if (typeof result.status === 'number') {
    return result.status;
  }
  return 1;
}

function runTsx(scriptPath: string, args: string[] = []): number {
  return run('tsx', [scriptPath, ...args]);
}

function runBash(scriptPath: string, args: string[] = []): number {
  return run('bash', [scriptPath, ...args]);
}

function help(): number {
  // High-level help mirrors repo domains (docs/data structure)
  console.log(`
MyloWare CLI
------------
Usage:
  npm run mw -- <group> <command> [-- args]

Groups and commands:
  env                use|dev|test|prod            Manage .env symlink via env-manager
  dev                obs|summary|watch            Dev utilities
  db                 reset|bootstrap|migrate|seed|status|test:rollback|setup:test|seed:test|seed:workflows
  workflows          import|pull|register|sync-ids|validate-ids|clear|watch|summary|dev:refresh
  n8n                dev|test|prod <args...>      n8n CLI passthrough
  docs               generate|check-links|tools|schema
  ingest             data [-- --dry-run]          Ingest data/v1 artifacts
  migrate            personas|projects|workflows|all
  test               workflow [-- --fixture <name> | message...]
  watch              execution|latest
  validate           legacy                        Legacy tool guard
  ops                verify|setup                  Deployment utilities

Examples:
  npm run mw -- db reset
  npm run mw -- workflows import
  npm run mw -- ingest data -- --dry-run
  npm run mw -- test workflow -- --fixture test-video-run
`);
  return 0;
}

const commands: Record<string, Record<string, CommandHandler>> = {
  env: {
    use: (args) => {
      const target = args[0];
      if (!['dev', 'test', 'prod'].includes(target || '')) {
        console.error('Usage: mw env use <dev|test|prod>');
        return 1;
      }
      // Maintain compatibility with existing env:use-* npm scripts
      const map: Record<string, string> = {
        dev: 'env:use-dev',
        test: 'env:use-test',
        prod: 'env:use-prod',
      };
      return run('npm', ['run', map[target]]);
    },
    dev: () => runBash(join(__dirname, 'env/env-manager.sh'), ['dev']),
    test: () => runBash(join(__dirname, 'env/env-manager.sh'), ['test']),
    prod: () => runBash(join(__dirname, 'env/env-manager.sh'), ['prod']),
  },
  dev: {
    obs: () => runBash(join(__dirname, 'dev/obs.sh')),
    watch: () => runTsx(join(__dirname, 'dev/watch-workflows.ts')),
    summary: () => runTsx(join(__dirname, 'dev/print-dev-summary.ts')),
    validate: () => runBash(join(__dirname, 'dev/validate-dev-env.sh')),
  },
  db: {
    reset: () => runTsx(join(__dirname, 'db/reset.ts')),
    bootstrap: () => runTsx(join(__dirname, 'db/bootstrap.ts')),
    migrate: () => run('npx', ['drizzle-kit', 'push']),
    seed: () => runTsx(join(__dirname, 'db/seed.ts')),
    status: () => run('npx', ['drizzle-kit', 'check:pg']),
    'test:rollback': () => runTsx(join(__dirname, 'db/test-rollback.ts')),
    'setup:test': () => runTsx(join(__dirname, 'db/setup-test-db.ts')),
    'seed:test': () => runTsx(join(__dirname, 'db/seed-test.ts')),
    'seed:workflows': () => runTsx(join(__dirname, 'db/seed-workflows.ts')),
  },
  workflows: {
    import: () => runTsx(join(__dirname, 'workflows/import-workflows.ts')),
    pull: () => runTsx(join(__dirname, 'workflows/workflows-pull.ts')),
    register: () => runTsx(join(__dirname, 'workflows/register-workflow-mappings.ts')),
    'sync-ids': () => runTsx(join(__dirname, 'workflows/sync-n8n-workflow-ids.ts')),
    'validate-ids': () => runTsx(join(__dirname, 'workflows/validate-workflow-ids.ts')),
    clear: () => runTsx(join(__dirname, 'workflows/clear-n8n-workflows.ts')),
    watch: () => runTsx(join(__dirname, 'dev/watch-workflows.ts')),
    summary: () => runTsx(join(__dirname, 'dev/print-dev-summary.ts')),
    'dev:refresh': () => run('npm', ['run', 'workflow:dev:refresh']),
  },
  n8n: {
    dev: (args) => runBash(join(__dirname, 'n8n/n8n-cli.sh'), ['dev', ...args]),
    test: (args) => runBash(join(__dirname, 'n8n/n8n-cli.sh'), ['test', ...args]),
    prod: (args) => runBash(join(__dirname, 'n8n/n8n-cli.sh'), ['prod', ...args]),
  },
  docs: {
    generate: (args) => runTsx(join(__dirname, 'docs/generate-docs.ts'), args),
    'check-links': () => runTsx(join(__dirname, 'docs/check-docs-links.ts')),
    tools: () => runTsx(join(__dirname, 'docs/generate-docs.ts'), ['--tools']),
    schema: () => runTsx(join(__dirname, 'docs/generate-docs.ts'), ['--schema']),
  },
  ingest: {
    data: (args) => runTsx(join(__dirname, 'ingest/ingest-data.ts'), args),
  },
  migrate: {
    personas: () => runTsx(join(__dirname, 'migrate/personas.ts')),
    projects: () => runTsx(join(__dirname, 'migrate/projects.ts')),
    workflows: () => runTsx(join(__dirname, 'migrate/workflows.ts')),
    all: () =>
      run('npm', ['run', 'migrate:all']),
  },
  test: {
    workflow: (args) => runTsx(join(__dirname, 'test/run-workflow-test.ts'), args),
    mcp: (args) => runTsx(join(__dirname, 'test/test-mcp-tools.ts'), args),
  },
  watch: {
    execution: () => runTsx(join(__dirname, 'workflows/watch-execution.ts')),
    latest: () => runTsx(join(__dirname, 'workflows/watch-execution.ts'), ['latest']),
  },
  validate: {
    legacy: () => runTsx(join(__dirname, 'validate/check-deprecated-tools.ts')),
  },
  ops: {
    verify: () => runBash(join(__dirname, 'ops/verify-deployment.sh')),
    setup: () => runBash(join(repoRoot, 'setup-n8n.sh')),
  },
};

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    return help();
  }

  const dashDashIndex = argv.indexOf('--');
  const beforeDashDash = dashDashIndex >= 0 ? argv.slice(0, dashDashIndex) : argv;
  const passThrough = dashDashIndex >= 0 ? argv.slice(dashDashIndex + 1) : [];

  const [group, sub, ...rest] = beforeDashDash;

  if (group === 'help' || group === '-h' || group === '--help') {
    return help();
  }

  const groupMap = commands[group];
  if (!groupMap) {
    console.error(`Unknown group "${group}".`);
    return help();
  }

  // Allow calling a group default when only one token is provided
  if (!sub) {
    console.error(`Missing command for group "${group}".`);
    return help();
  }

  const handler = groupMap[sub];
  if (!handler) {
    console.error(`Unknown command "${group} ${sub}".`);
    return help();
  }

  const code = handler([...rest, ...passThrough]);
  return typeof code === 'number' ? code : 0;
}

process.exit(main());


