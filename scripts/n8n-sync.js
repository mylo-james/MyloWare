#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const [action, ...restArgs] = process.argv.slice(2);
const supportedActions = new Set(['push', 'pull']);

if (!supportedActions.has(action)) {
  printUsage();
  process.exit(action ? 1 : 0);
}

if (typeof fetch !== 'function') {
  console.error('This script requires Node.js 18+ so the Fetch API is available.');
  process.exit(1);
}

const envBaseUrl = (process.env.N8N_BASE_URL || '').trim();
const apiKey = (process.env.N8N_API_KEY || '').trim();
const apiPrefix = normalizePrefix(process.env.N8N_API_PREFIX);
const workflowsDir = path.resolve(projectRoot, process.env.N8N_WORKFLOW_DIR || 'workflows');
const manifestPath = path.resolve(
  projectRoot,
  process.env.N8N_WORKFLOW_MANIFEST || path.join('workflows', 'workflow-map.json'),
);
const archiveSubdir = normalizeArchiveSubdir(process.env.N8N_ARCHIVE_SUBDIR);

if (!envBaseUrl) {
  console.error('Missing N8N_BASE_URL in environment.');
  process.exit(1);
}

if (!apiKey) {
  console.error('Missing N8N_API_KEY in environment.');
  process.exit(1);
}

const baseUrl = normalizeBaseUrl(envBaseUrl);
const apiBaseUrl = buildApiBaseUrl(baseUrl, apiPrefix);

let manifestText = '';
let manifestDirty = false;
let manifest = [];

(async () => {
  try {
    manifest = await loadManifest();
    if (!fs.existsSync(workflowsDir)) {
      throw new Error(`Workflows directory not found: ${workflowsDir}`);
    }

    if (action === 'push') {
      await pushWorkflows();
    } else {
      await pullWorkflows();
    }

    await persistManifest();
  } catch (err) {
    console.error(`n8n ${action} failed:`, err.message);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
})();

function printUsage() {
  console.log('Usage: node scripts/n8n-sync.js <push|pull>');
  console.log('Environment variables: N8N_BASE_URL, N8N_API_KEY, optional N8N_API_PREFIX, N8N_WORKFLOW_DIR, N8N_WORKFLOW_MANIFEST');
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch (err) {
    throw new Error('N8N_BASE_URL must include protocol, e.g. https://n8n.example.com');
  }
}

function normalizePrefix(prefixValue) {
  const raw = (prefixValue || '/api/v1').trim();
  if (!raw) return '/api/v1';
  let normalized = raw.startsWith('/') ? raw : `/${raw}`;
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function normalizeArchiveSubdir(value) {
  const fallback = 'archive';
  const raw = (value || fallback).trim().replace(/^\/+|\/+$|\.+/g, '') || fallback;
  return raw;
}

function buildApiBaseUrl(base, prefix) {
  const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
  return new URL(`${prefix.slice(1)}/`, baseWithSlash);
}

function buildApiUrl(endpoint) {
  const clean = (endpoint || '').replace(/^\//, '');
  return new URL(clean, apiBaseUrl).toString();
}

async function apiRequest(method, endpoint, body) {
  const url = buildApiUrl(endpoint);
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-N8N-API-KEY': apiKey,
      'User-Agent': 'n8n-workflow-sync/1.0',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await response.text();
  let payload;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      payload = raw;
    }
  }

  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new Error(`${method} ${url} failed (${response.status}): ${detail}`);
  }

  return payload;
}

async function loadManifest() {
  manifestText = await fsp.readFile(manifestPath, 'utf8');
  const data = JSON.parse(manifestText);
  if (!Array.isArray(data)) {
    throw new Error('Workflow manifest must be a JSON array.');
  }
  return data;
}

async function persistManifest() {
  if (!manifestDirty) {
    return;
  }
  const next = JSON.stringify(manifest, null, 2) + '\n';
  if (next === manifestText) {
    return;
  }
  await fsp.writeFile(manifestPath, next);
  manifestText = next;
  manifestDirty = false;
}

async function pushWorkflows() {
  const remoteIndex = await buildRemoteIndex();
  for (const entry of manifest) {
    if (!entry.file) {
      console.warn(`⚠️  Missing file path for workflow ${entry.name || entry.workflowId || '<unknown>'}.`);
      continue;
    }

    let paths;
    try {
      paths = getWorkflowPaths(entry.file);
    } catch (err) {
      console.warn(`⚠️  Invalid workflow path "${entry.file}": ${err.message}`);
      continue;
    }
    if (paths.relative !== entry.file) {
      entry.file = paths.relative;
      manifestDirty = true;
    }

    const workflowPath = paths.absolute;
    if (!fs.existsSync(workflowPath)) {
      console.warn(`⚠️  Missing local workflow file: ${entry.file}`);
      continue;
    }

    const local = JSON.parse(await fsp.readFile(workflowPath, 'utf8'));
    const remote = findRemoteMatch(entry, remoteIndex);
    const payload = buildPayload(local, entry, remote);

    if (remote) {
      console.log(`↻ Updating ${entry.name || remote.name} (${remote.id})`);
      await apiRequest('PATCH', `/workflows/${remote.id}`, payload);
      if (entry.workflowId !== remote.id) {
        entry.workflowId = remote.id;
        manifestDirty = true;
      }
    } else {
      console.log(`➕ Creating ${payload.name}`);
      const created = normalizeWorkflow(await apiRequest('POST', '/workflows', payload));
      if (created?.id) {
        entry.workflowId = created.id;
        if (!entry.name) {
          entry.name = created.name;
        }
        manifestDirty = true;
      }
    }
  }
}

async function pullWorkflows() {
  const remoteIndex = await buildRemoteIndex();
  const matchedRemoteIds = new Set();

  await resetWorkflowDirectoryForPull();

  for (const entry of manifest) {
    const remote = findRemoteMatch(entry, remoteIndex);
    if (!remote) {
      console.warn(`⚠️  Remote workflow not found for ${entry.file}.`);
      continue;
    }

    await downloadAndWriteWorkflow(remote, entry.file, entry);
    matchedRemoteIds.add(String(remote.id));
  }

  await pullMissingRemoteWorkflows(remoteIndex, matchedRemoteIds);
}

async function downloadAndWriteWorkflow(remoteSummary, fileName, manifestEntry) {
  console.log(`⬇️  Downloading ${remoteSummary.name} (${remoteSummary.id})`);
  const detail = normalizeWorkflow(await apiRequest('GET', `/workflows/${remoteSummary.id}`));
  if (!detail) {
    console.warn(`⚠️  Empty response for workflow ${remoteSummary.id}`);
    return;
  }

  const snapshot = extractSnapshot(detail);
  const relativePath = adjustRelativePathForArchive(fileName, remoteSummary, manifestEntry);
  const paths = getWorkflowPaths(relativePath);
  await ensureDirExistsForFile(paths.absolute);
  await fsp.writeFile(paths.absolute, JSON.stringify(snapshot, null, 2) + '\n');

  if (manifestEntry) {
    if (manifestEntry.workflowId !== remoteSummary.id) {
      manifestEntry.workflowId = remoteSummary.id;
      manifestDirty = true;
    }
    if (!manifestEntry.name && detail.name) {
      manifestEntry.name = detail.name;
      manifestDirty = true;
    }
    if (manifestEntry.file !== paths.relative) {
      manifestEntry.file = paths.relative;
      manifestDirty = true;
    }
  }
}

async function pullMissingRemoteWorkflows(remoteIndex, matchedRemoteIds) {
  for (const remote of remoteIndex.list) {
    const remoteId = String(remote.id);
    if (matchedRemoteIds.has(remoteId)) {
      continue;
    }

    const filename = await reserveFileNameForRemote(remote);
    const remoteArchived = remote.archived === true;
    const newEntry = {
      file: filename,
      name: remote.name,
      workflowId: remote.id,
      active: typeof remote.active === 'boolean' ? remote.active : undefined,
      archived: remoteArchived,
    };
    manifest.push(newEntry);
    manifestDirty = true;

    await downloadAndWriteWorkflow(remote, filename, newEntry);
    matchedRemoteIds.add(remoteId);
  }
}

async function resetWorkflowDirectoryForPull() {
  assertWorkflowsDirSafe();
  await fsp.rm(workflowsDir, { recursive: true, force: true });
  await fsp.mkdir(workflowsDir, { recursive: true });
}

async function buildRemoteIndex() {
  const payload = await apiRequest('GET', '/workflows');
  const list = normalizeWorkflowList(payload);
  const byId = new Map();
  const byCanonicalName = new Map();
  for (const item of list) {
    if (!item || !item.id) continue;
    byId.set(String(item.id), item);
    if (item.name) {
      byCanonicalName.set(canonicalName(item.name), item);
    }
  }
  return { list, byId, byCanonicalName };
}

function normalizeWorkflowList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.workflows)) {
    return payload.workflows;
  }
  throw new Error('Unexpected response shape from /workflows');
}

function normalizeWorkflow(payload) {
  if (!payload) return payload;
  if (payload.data) return payload.data;
  if (payload.workflow) return payload.workflow;
  return payload;
}

function findRemoteMatch(entry, index) {
  if (!index) return null;
  if (entry.workflowId && index.byId.has(String(entry.workflowId))) {
    return index.byId.get(String(entry.workflowId));
  }

  const names = [entry.name, fallbackNameFromFile(entry.file)].filter(Boolean);
  for (const candidate of names) {
    const key = canonicalName(candidate);
    if (index.byCanonicalName.has(key)) {
      return index.byCanonicalName.get(key);
    }
  }
  return null;
}

function canonicalName(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fallbackNameFromFile(file) {
  if (!file) return '';
  const base = file
    .replace(/\.workflow\.json$/i, '')
    .replace(/\.json$/i, '')
    .replace(/_/g, '-');
  if (!base) return '';
  if (base === base.toUpperCase()) {
    return base;
  }
  return base
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function normalizeManifestPath(value) {
  if (!value) return '';
  const replaced = value.replace(/\\/g, '/').trim();
  if (!replaced) return '';
  const normalized = path.posix.normalize(replaced);
  const withoutLeading = normalized.replace(/^\/+/, '');
  if (withoutLeading.startsWith('../')) {
    throw new Error('Workflow paths must stay within the workflows directory');
  }
  return withoutLeading === '.' ? '' : withoutLeading;
}

function getWorkflowPaths(relativeValue) {
  const relative = normalizeManifestPath(relativeValue);
  if (!relative) {
    throw new Error('Workflow manifest entry is missing a file path.');
  }
  const absolute = path.join(workflowsDir, ...relative.split('/'));
  return { relative, absolute };
}

async function ensureDirExistsForFile(filePath) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

function isArchivePath(relativePath) {
  const normalized = normalizeManifestPath(relativePath);
  return normalized === archiveSubdir || normalized.startsWith(`${archiveSubdir}/`);
}

function adjustRelativePathForArchive(preferredFile, remoteSummary, manifestEntry) {
  const remoteArchived = Boolean(remoteSummary?.archived);
  let normalized = normalizeManifestPath(preferredFile);

  if (!normalized) {
    normalized = buildDefaultRelativeFilename(remoteSummary);
  }

  if (remoteArchived && !isArchivePath(normalized)) {
    normalized = path.posix.join(archiveSubdir, path.posix.basename(normalized));
  } else if (!remoteArchived && isArchivePath(normalized)) {
    normalized = path.posix.basename(normalized);
  }

  if (manifestEntry && manifestEntry.archived !== remoteArchived) {
    manifestEntry.archived = remoteArchived;
    manifestDirty = true;
  }

  return normalized;
}

function buildDefaultRelativeFilename(remoteSummary) {
  const base = slugify(remoteSummary?.name) || `workflow-${String(remoteSummary?.id || '').slice(0, 8) || 'remote'}`;
  const fileName = `${base}.workflow.json`;
  if (remoteSummary?.archived) {
    return path.posix.join(archiveSubdir, fileName);
  }
  return fileName;
}

async function reserveFileNameForRemote(remote) {
  const base = slugify(remote?.name) || `workflow-${String(remote?.id || '').slice(0, 8) || 'remote'}`;
  const dirPrefix = remote?.archived ? `${archiveSubdir}/` : '';
  let candidate = dirPrefix ? path.posix.join(archiveSubdir, `${base}.workflow.json`) : `${base}.workflow.json`;
  let suffix = 1;
  while (await pathExists(getWorkflowPaths(candidate).absolute)) {
    const nextName = `${base}-${++suffix}.workflow.json`;
    candidate = dirPrefix ? path.posix.join(archiveSubdir, nextName) : nextName;
  }
  return candidate;
}

function slugify(value) {
  return (value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath, fs.constants.F_OK);
    return true;
  } catch (err) {
    return false;
  }
}

function assertWorkflowsDirSafe() {
  const projectResolved = path.resolve(projectRoot);
  const workflowsResolved = path.resolve(workflowsDir);
  if (workflowsResolved === path.parse(workflowsResolved).root) {
    throw new Error('Refusing to delete filesystem root');
  }
  if (workflowsResolved !== projectResolved && !workflowsResolved.startsWith(`${projectResolved}${path.sep}`)) {
    throw new Error(`Refusing to delete workflows directory outside project root: ${workflowsResolved}`);
  }
}

function buildPayload(localWorkflow, entry, remoteSummary) {
  const payload = { ...localWorkflow };
  delete payload.id;
  delete payload.createdAt;
  delete payload.updatedAt;
  delete payload.versionId;

  payload.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  payload.connections = payload.connections || {};
  payload.pinData = payload.pinData || {};
  payload.meta = payload.meta || {};
  payload.settings = payload.settings || remoteSummary?.settings || {};

  payload.name = entry.name || localWorkflow.name || remoteSummary?.name || fallbackNameFromFile(entry.file);

  const desiredActive = determineActive(entry, localWorkflow, remoteSummary);
  if (typeof desiredActive === 'boolean') {
    payload.active = desiredActive;
  }

  if (!payload.tags && (entry.tags || remoteSummary?.tags)) {
    payload.tags = entry.tags || remoteSummary?.tags || [];
  }

  return payload;
}

function determineActive(entry, localWorkflow, remoteSummary) {
  if (typeof entry.active === 'boolean') return entry.active;
  if (typeof localWorkflow.active === 'boolean') return localWorkflow.active;
  if (typeof remoteSummary?.active === 'boolean') return remoteSummary.active;
  return undefined;
}

function extractSnapshot(workflow) {
  return {
    nodes: Array.isArray(workflow.nodes) ? workflow.nodes : [],
    connections: workflow.connections || {},
    pinData: workflow.pinData || {},
    meta: workflow.meta || {},
  };
}
