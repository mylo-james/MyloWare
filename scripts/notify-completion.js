#!/usr/bin/env node

/**
 * MyloWare Agent Completion Notification Script (Node.js version)
 *
 * Usage: node scripts/notify-completion.js "Task completed successfully" "high"
 *
 * This script sends a Pushover notification when AI agents complete their work.
 * Requires PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN environment variables.
 */

const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');

// Load environment variables from .env file if it exists
if (fs.existsSync('.env')) {
  console.log('\x1b[32m[INFO]\x1b[0m Loading environment variables from .env file...');
  const envContent = fs.readFileSync('.env', 'utf8');
  const envLines = envContent.split('\n');

  envLines.forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        process.env[key] = value;
      }
    }
  });
}

// Get command line arguments
const args = process.argv.slice(2);
const message = args[0] || 'Agent task completed';
const priority = args[1] || '0';
const title = args[2] || 'MyloWare Agent Notification';

// Colors for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
};

function printStatus(text) {
  console.log(`${colors.green}[INFO]${colors.reset} ${text}`);
}

function printWarning(text) {
  console.log(`${colors.yellow}[WARNING]${colors.reset} ${text}`);
}

function printError(text) {
  console.log(`${colors.red}[ERROR]${colors.reset} ${text}`);
}

// Check if required environment variables are set
if (!process.env.PUSHOVER_USER_KEY) {
  printError('PUSHOVER_USER_KEY environment variable is not set');
  printWarning('Please set your Pushover User Key:');
  printWarning('export PUSHOVER_USER_KEY="your_user_key_here"');
  process.exit(1);
}

if (!process.env.PUSHOVER_APP_TOKEN) {
  printError('PUSHOVER_APP_TOKEN environment variable is not set');
  printWarning('Please set your Pushover App Token:');
  printWarning('export PUSHOVER_APP_TOKEN="your_app_token_here"');
  process.exit(1);
}

// Validate priority
if (!/^[0-2]$/.test(priority)) {
  printWarning(`Invalid priority '${priority}'. Using normal priority (0)`);
  priority = '0';
}

// Get current timestamp and git info
const timestamp = new Date().toLocaleString();
let gitBranch = 'unknown';
let gitCommit = 'unknown';

try {
  gitBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
} catch (error) {
  // Git command failed, use default
}

try {
  gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch (error) {
  // Git command failed, use default
}

// Build notification message
const fullMessage = `${message}

Branch: ${gitBranch}
Commit: ${gitCommit}
Time: ${timestamp}`;

printStatus('Sending Pushover notification...');
printStatus(`Title: ${title}`);
printStatus(`Priority: ${priority}`);
printStatus(`Message: ${message}`);

// Prepare the request data
const postData = new URLSearchParams({
  token: process.env.PUSHOVER_APP_TOKEN,
  user: process.env.PUSHOVER_USER_KEY,
  title: title,
  message: fullMessage,
  priority: priority,
  sound: 'cosmic',
}).toString();

// Send Pushover notification
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

  res.on('data', chunk => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);

      if (response.status === 1) {
        printStatus('Notification sent successfully!');
        printStatus(`Response: ${data}`);
      } else {
        printError('Failed to send notification');
        printError(`Response: ${data}`);
        process.exit(1);
      }
    } catch (error) {
      printError('Failed to parse response');
      printError(`Response: ${data}`);
      process.exit(1);
    }
  });
});

req.on('error', error => {
  printError(`Request failed: ${error.message}`);
  process.exit(1);
});

req.write(postData);
req.end();
