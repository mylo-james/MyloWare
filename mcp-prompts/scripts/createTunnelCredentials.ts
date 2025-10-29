import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function resolveProjectPath(...segments: string[]): string {
  return path.resolve(__dirname, '..', ...segments);
}

function parseCredentialPath(output: string): string | null {
  const patterns = [
    /credentials? file (?:can be found at|saved to|written to):?\s*([^\s]+\.json)/i,
    /Tunnel credentials written to\s+([^\s]+\.json)/i,
    /Credentials file path:\s*([^\s]+\.json)/i,
    /([/\\][^\s]+\.json)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

async function copyCredentialsFile(source: string, destination: string): Promise<void> {
  const sourcePath = path.resolve(source.replace(/^~/, os.homedir()));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(sourcePath, destination);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const tunnelName = process.env.CLOUDFLARE_TUNNEL_NAME ?? 'mcp-vector';
  const destination = resolveProjectPath('cloudflared', 'credentials', `${tunnelName}.json`);
  const force = process.argv.includes('--force');

  if ((await fileExists(destination)) && !force) {
    console.error(
      `Credentials already exist at ${destination}. ` +
        'Use --force to overwrite after deleting the file if you need to regenerate.',
    );
    process.exitCode = 1;
    return;
  }

  console.info(`Creating Cloudflare tunnel credentials for "${tunnelName}"…`);

  const child = spawn('cloudflared', ['tunnel', 'create', tunnelName], {
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  let combinedOutput = '';
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    combinedOutput += text;
    process.stdout.write(text);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    combinedOutput += text;
    process.stderr.write(text);
  });

  child.on('error', (error) => {
    console.error('Failed to execute cloudflared CLI. Ensure it is installed and on your PATH.');
    console.error(error);
    process.exit(1);
  });

  child.on('exit', async (code) => {
    if (code !== 0) {
      console.error(`cloudflared exited with code ${code}.`);
      process.exit(code ?? 1);
      return;
    }

    const credentialsPath = parseCredentialPath(combinedOutput);
    if (!credentialsPath) {
      console.warn('Could not automatically detect credentials path from cloudflared output.');
      console.warn(
        'Please copy the generated JSON from ~/.cloudflared manually into cloudflared/credentials/.',
      );
      process.exitCode = 1;
      return;
    }

    try {
      await copyCredentialsFile(credentialsPath, destination);
      console.info(`Copied credentials to ${destination}`);
      console.info('Remember to keep this file secret and do not commit it to version control.');
    } catch (error) {
      console.error('Failed to copy credentials file into repository directory.');
      console.error(error);
      process.exitCode = 1;
    }
  });
}

void main();
