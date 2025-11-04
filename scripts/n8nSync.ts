#!/usr/bin/env tsx
import 'dotenv/config';
import path from 'node:path';
import { promises as fs, accessSync } from 'node:fs';
import { URL } from 'node:url';
import { z } from 'zod';

interface CliOptions {
  mode: 'push' | 'pull';
  directory: string;
  dryRun: boolean;
  force: boolean;
}

const cliOptionsSchema = z.object({
  mode: z.enum(['push', 'pull']),
  directory: z.string().min(1),
  dryRun: z.boolean(),
  force: z.boolean(),
});

function parseArgs(): CliOptions {
  const argv = process.argv.slice(2);
  let mode: 'push' | 'pull' | undefined;
  let directory = path.resolve(process.cwd(), 'workflows');
  let dryRun = false;
  let force = false;

  for (const arg of argv) {
    if (arg === '--push') {
      mode = 'push';
    } else if (arg === '--pull') {
      mode = 'pull';
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg.startsWith('--dir=')) {
      directory = path.resolve(arg.slice('--dir='.length));
    }
  }

  if (!mode) {
    console.error('Missing required flag: use --push or --pull.');
    process.exit(1);
  }

  const optionsResult = cliOptionsSchema.safeParse({
    mode,
    directory,
    dryRun,
    force,
  });

  if (!optionsResult.success) {
    console.error('Invalid CLI options:', optionsResult.error.format());
    process.exit(1);
  }

  return optionsResult.data;
}

const envSchema = z.object({
  N8N_BASE_URL: z.string().url('N8N_BASE_URL must be a valid URL'),
  N8N_API_KEY: z.string().min(1, 'N8N_API_KEY is required'),
});

function loadEnvironment() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.flatten();
    console.error('Invalid n8n environment:', formatted);
    process.exit(1);
  }

  return result.data;
}

async function ensureDirectoryExists(directory: string): Promise<void> {
  try {
    await fs.access(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.mkdir(directory, { recursive: true });
    } else {
      throw error;
    }
  }
}

async function run(): Promise<void> {
  const options = parseArgs();
  const env = loadEnvironment();
  await ensureDirectoryExists(options.directory);

  const baseUrl = new URL(env.N8N_BASE_URL);
  const apiKey = env.N8N_API_KEY.trim();
  const headers = {
    'X-N8N-API-KEY': apiKey,
    Authorization: `Bearer ${apiKey}`,
    accept: 'application/json',
    'content-type': 'application/json',
  };

  console.info(
    `[n8n] ${options.mode === 'push' ? 'Pushing' : 'Pulling'} workflows ${
      options.dryRun ? '(dry run)' : ''
    }${options.force ? ' (force mode - will create new workflows)' : ''} from ${baseUrl.toString()} using directory ${options.directory}`,
  );

  if (options.mode === 'pull') {
    await pullWorkflows({
      baseUrl,
      headers,
      directory: options.directory,
      dryRun: options.dryRun,
      force: options.force,
    });
  } else {
    await pushWorkflows({
      baseUrl,
      headers,
      directory: options.directory,
      dryRun: options.dryRun,
      force: options.force,
    });
  }
}

interface N8nRequestOptions {
  baseUrl: URL;
  headers: Record<string, string>;
  directory: string;
  dryRun: boolean;
  force: boolean;
}

async function pullWorkflows(options: N8nRequestOptions): Promise<void> {
  const payload = await fetchWorkflowsList(options);
  const workflowsArray = Array.isArray(payload) ? payload : (payload.data ?? []);

  if (!Array.isArray(workflowsArray) || workflowsArray.length === 0) {
    console.info('[n8n] No workflows returned by API.');
    return;
  }

  const archiveInfo = await archiveExistingWorkflows(options.directory, options.dryRun);
  const written: string[] = [];
  const usedNames = new Set<string>();

  try {
    for (const entry of workflowsArray) {
      const workflowId: string | undefined = entry?.id ?? entry?.workflow?.id ?? entry?.workflowId;
      if (!workflowId) {
        console.warn('[n8n] Skipping workflow with missing id:', entry);
        continue;
      }

      const detailPayload = await fetchWorkflowDetail(workflowId, options);
      const workflow = detailPayload?.data ?? detailPayload;
      const name: string =
        workflow?.name ??
        (detailPayload?.name as string | undefined) ??
        payloadName(entry) ??
        `workflow-${workflowId}`;

      const originalName = workflowId ? archiveInfo.nameMap.get(workflowId) : undefined;
      const fileName = chooseFileName({
        workflowName: name,
        preferredName: originalName,
        directory: options.directory,
        usedNames,
      });
      const filePath = path.join(options.directory, fileName);

      if (options.dryRun) {
        console.info(`[n8n][dry-run] Would write ${filePath}`);
        continue;
      }

      await fs.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf-8');
      written.push(fileName);
    }
  } catch (error) {
    if (!options.dryRun && archiveInfo.archiveRoot) {
      console.error(
        `[n8n] Pull failed. Existing workflows preserved in ${archiveInfo.archiveRoot}.`,
      );
    }
    throw error;
  }

  if (options.dryRun) {
    console.info(`[n8n][dry-run] Evaluated ${workflowsArray.length} workflow(s).`);
    return;
  }

  console.info(`[n8n] Pulled ${written.length} workflow(s):`);
  written.forEach((name) => console.info(`  - ${name}`));

  if (archiveInfo.archiveRoot) {
    await fs.rm(archiveInfo.archiveRoot, { recursive: true, force: true });
  }
}

async function fetchWorkflowsList(options: N8nRequestOptions) {
  const candidates = ['/rest/workflows', '/api/v1/workflows'];

  let lastError: Error | null = null;
  for (const pathSegment of candidates) {
    const listUrl = new URL(pathSegment, options.baseUrl);
    try {
      const response = await fetch(listUrl, {
        headers: options.headers,
      });

      if (response.status === 401) {
        const body = await response.text();
        throw new Error(
          `Unauthorized (401). Double-check N8N_API_KEY permissions. Response: ${body}`,
        );
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to list workflows (${response.status}): ${text}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('Unable to list workflows from n8n API.');
}

async function fetchWorkflowDetail(id: string, options: N8nRequestOptions) {
  const candidates = [`/rest/workflows/${id}`, `/api/v1/workflows/${id}`];

  let lastError: Error | null = null;
  for (const pathSegment of candidates) {
    const detailUrl = new URL(pathSegment, options.baseUrl);
    if (pathSegment.startsWith('/rest/')) {
      detailUrl.searchParams.set('includeData', 'true');
    }

    const detailResponse = await fetch(detailUrl, {
      headers: options.headers,
    });

    if (!detailResponse.ok) {
      const text = await detailResponse.text();
      lastError = new Error(`Failed to fetch workflow ${id} (${detailResponse.status}): ${text}`);
      continue;
    }

    return await detailResponse.json();
  }

  throw lastError ?? new Error(`Unable to fetch workflow ${id} from n8n API.`);
}

async function pushWorkflows(options: N8nRequestOptions): Promise<void> {
  const entries = await fs.readdir(options.directory, { withFileTypes: true });
  const workflowFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.workflow.json'))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (workflowFiles.length === 0) {
    console.info('[n8n] No local workflows found to push.');
    return;
  }

  const remotePayload = await fetchWorkflowsList(options);
  const remoteArray = Array.isArray(remotePayload) ? remotePayload : (remotePayload?.data ?? []);

  const remoteById = new Map<string, unknown>();
  const remoteByName = new Map<string, unknown>();

  for (const entry of remoteArray) {
    const id = extractWorkflowId(entry);
    if (id) {
      remoteById.set(id, entry);
    }

    const name = payloadName(entry);
    if (name) {
      remoteByName.set(name, entry);
    }
  }

  const summary = {
    created: [] as string[],
    updated: [] as string[],
    failed: [] as string[],
  };

  for (const file of workflowFiles) {
    const filePath = path.join(options.directory, file.name);

    let workflow: Record<string, unknown>;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      workflow = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      console.error(`[n8n] Failed to read workflow file ${file.name}:`, error);
      summary.failed.push(file.name);
      continue;
    }

    // In force mode, strip the ID to force creation of new workflows
    if (options.force && workflow?.id) {
      delete workflow.id;
    }

    const workflowId = workflow?.id ? String(workflow.id) : undefined;
    const workflowName =
      typeof workflow?.name === 'string'
        ? (workflow.name as string)
        : file.name.replace(/\.workflow\.json$/, '');

    // In force mode, don't try to match with remote workflows
    const remoteEntry = options.force
      ? undefined
      : (workflowId && remoteById.get(workflowId)) ??
        (workflowName ? remoteByName.get(workflowName) : undefined);

    if (options.dryRun) {
      console.info(
        `[n8n][dry-run] Would ${remoteEntry ? 'update' : 'create'} workflow "${workflowName}" (${file.name})${
          workflowId ? ` [id=${workflowId}]` : ''
        }`,
      );
      continue;
    }

    try {
      const upserted = await upsertRemoteWorkflow(workflow, options, Boolean(remoteEntry));
      await syncLocalWorkflowFile(filePath, workflow, upserted);

      const upsertedId = extractWorkflowId(upserted);
      if (upsertedId) {
        remoteById.set(upsertedId, upserted);
      }
      if (workflowName) {
        remoteByName.set(workflowName, upserted);
      }

      if (remoteEntry) {
        summary.updated.push(file.name);
      } else {
        summary.created.push(file.name);
      }
    } catch (error) {
      console.error(`[n8n] Failed to push workflow ${file.name}:`, error);
      summary.failed.push(file.name);
    }
  }

  if (options.dryRun) {
    console.info(`[n8n][dry-run] Evaluated ${workflowFiles.length} workflow(s).`);
    return;
  }

  console.info(
    `[n8n] Push complete: updated=${summary.updated.length}, created=${summary.created.length}, failed=${summary.failed.length}.`,
  );
  if (summary.failed.length > 0) {
    console.info(`[n8n] Failed workflows: ${summary.failed.join(', ')}`);
  }
}

const ALLOWED_WORKFLOW_FIELDS = new Set<string>([
  'name',
  'nodes',
  'connections',
  'settings',
  'staticData',
]);

async function upsertRemoteWorkflow(
  workflow: Record<string, unknown>,
  options: N8nRequestOptions,
  forceOverwrite: boolean,
): Promise<Record<string, unknown>> {
  const payload = sanitizeWorkflowForUpdate(workflow);
  if (typeof payload.name !== 'string' && typeof workflow.name === 'string') {
    payload.name = workflow.name as string;
  }

  if (!payload.name || typeof payload.name !== 'string') {
    throw new Error('Workflow is missing a name field; cannot push.');
  }

  if (forceOverwrite && workflow.id) {
    const url = new URL(`/api/v1/workflows/${workflow.id}`, options.baseUrl);
    const response = await fetch(url, {
      method: 'PUT',
      headers: options.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to update workflow ${workflow.id} (${response.status}): ${text}`);
    }

    const parsed = await parseJsonResponse(response);
    const data = (
      parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed
    ) as Record<string, unknown> | undefined;
    return data ?? payload;
  }

  const url = new URL('/api/v1/workflows', options.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: options.headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create workflow (${response.status}): ${text}`);
  }

  const parsed = await parseJsonResponse(response);
  const data = (parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed) as
    | Record<string, unknown>
    | undefined;
  return data ?? payload;
}

async function syncLocalWorkflowFile(
  filePath: string,
  original: Record<string, unknown>,
  responseData?: Record<string, unknown>,
): Promise<void> {
  const data = responseData && typeof responseData === 'object' ? responseData : null;
  if (!data) {
    return;
  }

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function sanitizeWorkflowForUpdate(workflow: Record<string, unknown>) {
  const clone = JSON.parse(JSON.stringify(workflow)) as Record<string, unknown>;
  for (const key of Object.keys(clone)) {
    if (!ALLOWED_WORKFLOW_FIELDS.has(key)) {
      delete clone[key];
    }
  }
  return clone;
}

async function parseJsonResponse(response: globalThis.Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function extractWorkflowId(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const entryObj = entry as Record<string, unknown>;
  const data = entryObj.data;

  const candidate =
    entryObj.id ??
    (entryObj.workflow && typeof entryObj.workflow === 'object' && 'id' in entryObj.workflow
      ? (entryObj.workflow as Record<string, unknown>).id
      : undefined) ??
    (data && typeof data === 'object' ? (data as Record<string, unknown>).id : undefined);

  return candidate ? String(candidate) : undefined;
}

interface FileNameOptions {
  workflowName: string;
  preferredName?: string;
  directory: string;
  usedNames: Set<string>;
}

function chooseFileName(options: FileNameOptions): string {
  const slug = slugify(options.workflowName);
  const candidates: string[] = [];

  if (options.preferredName) {
    candidates.push(normalizePreferredName(options.preferredName));
  }

  candidates.push(`${slug}.workflow.json`);

  let counter = 2;
  for (const candidate of candidates) {
    let attempt = candidate;
    while (options.usedNames.has(attempt) || fsExistsSync(path.join(options.directory, attempt))) {
      attempt = `${slug}-${counter}.workflow.json`;
      counter += 1;
    }

    options.usedNames.add(attempt);
    return attempt;
  }

  const fallback = `${slug}.workflow.json`;
  options.usedNames.add(fallback);
  return fallback;
}

function normalizePreferredName(name: string): string {
  const trimmed = name.trim();
  const suffixMatch = trimmed.match(/^(.*?)-\d+\.workflow\.json$/);
  if (suffixMatch) {
    return `${suffixMatch[1]}.workflow.json`;
  }

  if (trimmed.endsWith('.workflow.json')) {
    return trimmed;
  }

  if (trimmed.endsWith('.json')) {
    return trimmed.slice(0, -'.json'.length) + '.workflow.json';
  }

  return `${slugify(trimmed)}.workflow.json`;
}

function isNumberedFileName(name: string): boolean {
  return /-\d+\.workflow\.json$/.test(name.trim());
}

function payloadName(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  if ('name' in entry && typeof entry.name === 'string') {
    return entry.name;
  }

  const nestedWorkflow = (entry as Record<string, unknown>).workflow;
  if (nestedWorkflow && typeof nestedWorkflow === 'object') {
    const maybeName = (nestedWorkflow as Record<string, unknown>).name;
    if (typeof maybeName === 'string') {
      return maybeName;
    }
  }

  return undefined;
}

interface ArchiveInfo {
  archiveRoot: string | null;
  nameMap: Map<string, string>;
}

async function archiveExistingWorkflows(directory: string, dryRun: boolean): Promise<ArchiveInfo> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  const workflowFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith('.workflow.json'),
  );

  if (workflowFiles.length === 0) {
    return { archiveRoot: null, nameMap: new Map() };
  }

  const archiveRoot = path.join(directory, 'archive');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(archiveRoot, timestamp);
  const nameMap = new Map<string, string>();

  if (!dryRun) {
    await fs.mkdir(archivePath, { recursive: true });
  }

  for (const file of workflowFiles) {
    const sourcePath = path.join(directory, file.name);
    const workflowId = await readWorkflowId(sourcePath);
    if (workflowId) {
      const existing = nameMap.get(workflowId);
      if (!existing || isNumberedFileName(existing)) {
        nameMap.set(workflowId, file.name);
      }
    }

    if (!dryRun) {
      const targetPath = path.join(archivePath, file.name);
      await fs.rename(sourcePath, targetPath);
    }
  }

  return {
    archiveRoot: dryRun ? null : archiveRoot,
    nameMap,
  };
}

async function readWorkflowId(filePath: string): Promise<string | undefined> {
  try {
    const contents = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(contents) as { id?: string };
    return parsed?.id;
  } catch {
    return undefined;
  }
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'workflow';
}

function fsExistsSync(filePath: string): boolean {
  try {
    accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

run().catch((error) => {
  console.error('[n8n] sync failed', error);
  process.exitCode = 1;
});
