#!/usr/bin/env node

/**
 * HITL Notification Script (Pushover)
 *
 * Usage via npm scripts:
 *   npm run hitl:success -- "Optional message here"
 *   npm run hitl:failure -- "Optional message here"
 *
 * Flags (optional):
 *   --priority=0|1|2   Priority level (default 0)
 *   --title=STRING     Custom title (default "MyloWare HITL Notification")
 */

const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file if present (non-dotenv, no dependency)
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const rawVal = trimmed.slice(idx + 1).trim();
      const val = rawVal.replace(/^(["'])(.*)\1$/, '$2');
      if (!(key in process.env)) process.env[key] = val;
    }
  }
} catch (_) {}

// Parse CLI args
const args = process.argv.slice(2);
let priority = 0;
let title = 'MyloWare HITL Notification';
let sound = 'cosmic';
const messageParts = [];

for (const arg of args) {
  if (arg.startsWith('--priority=')) {
    const val = arg.split('=')[1];
    if (/^[0-2]$/.test(val)) priority = parseInt(val, 10);
    continue;
  }
  if (arg.startsWith('--title=')) {
    title = arg.split('=')[1] || title;
    continue;
  }
  if (arg.startsWith('--sound=')) {
    sound = arg.split('=')[1] || sound;
    continue;
  }
  if (arg.startsWith('--')) {
    // Ignore unknown flags
    continue;
  }
  messageParts.push(arg);
}

const timestamp = new Date().toLocaleString();
let gitBranch = 'unknown';
let gitCommit = 'unknown';
try {
  gitBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
} catch (_) {}
try {
  gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch (_) {}

const messageBody = messageParts.length ? messageParts.join(' ') : 'HITL task completed.';
const fullMessage = `${messageBody}\n\nBranch: ${gitBranch}\nCommit: ${gitCommit}\nTime: ${timestamp}`;

if (!process.env.PUSHOVER_USER_KEY || !process.env.PUSHOVER_APP_TOKEN) {
  console.error('[ERROR] Missing PUSHOVER_USER_KEY or PUSHOVER_APP_TOKEN in environment/.env');
  process.exit(1);
}

const postData = new URLSearchParams({
  token: process.env.PUSHOVER_APP_TOKEN,
  user: process.env.PUSHOVER_USER_KEY,
  title,
  message: fullMessage,
  priority: String(priority),
  sound,
}).toString();

const options = {
  hostname: 'api.pushover.net',
  port: 443,
  path: '/1/messages.json',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(postData),
  },
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', chunk => (data += chunk));
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.status === 1) {
        console.log('[INFO] HITL notification sent successfully');
      } else {
        console.error('[ERROR] Failed to send HITL notification');
        console.error(data);
        process.exit(1);
      }
    } catch (err) {
      console.error('[ERROR] Failed to parse response');
      console.error(data);
      process.exit(1);
    }
  });
});

req.on('error', err => {
  console.error(`[ERROR] Request failed: ${err.message}`);
  process.exit(1);
});

req.write(postData);
req.end();


