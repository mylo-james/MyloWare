import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

function resolvePath(...segments: string[]): string {
  return path.resolve(__dirname, '..', ...segments);
}

async function main(): Promise<void> {
  const configPath = resolvePath('cloudflared', 'config.prompts.yml');
  const credentialsPath = resolvePath('cloudflared', 'credentials', 'mcp-vector.json');
  const certPath = resolvePath('cloudflared', 'cert.pem');

  if (!existsSync(configPath)) {
    console.error(`Missing Cloudflare config at ${configPath}`);
    process.exit(1);
  }

  if (!existsSync(credentialsPath)) {
    console.error(
      `Missing tunnel credentials. Expected JSON file at ${credentialsPath}. ` +
        'Run `cloudflared tunnel create` and copy the generated credentials file into this path.',
    );
    process.exit(1);
  }

  if (!existsSync(certPath)) {
    console.error(
      `Missing origin certificate. Expected file at ${certPath}. ` +
        'Run `cloudflared tunnel login` and copy the resulting cert.pem into cloudflared/.',
    );
    process.exit(1);
  }

  const args = [
    'tunnel',
    '--config',
    configPath,
    '--cred-file',
    credentialsPath,
    '--origincert',
    certPath,
    'run',
  ];

  console.info(`Starting cloudflared with config ${configPath}`);

  const child = spawn('cloudflared', args, {
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error('Failed to launch cloudflared. Ensure the CLI is installed and on your PATH.');
    console.error(error);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.info(`cloudflared exited due to signal ${signal}`);
      process.exit(1);
      return;
    }

    if (code === 0) {
      console.info('cloudflared tunnel stopped.');
    } else {
      console.error(`cloudflared exited with code ${code ?? 'unknown'}`);
    }

    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error('Unexpected error running cloudflared script', error);
  process.exit(1);
});
