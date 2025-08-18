/*
 * Slack Bot Permissions Checker
 *
 * Verifies Task 5 of Story 2.1 by checking:
 * - Bot can post messages in channels
 * - Bot can add reactions to messages it posts
 * - Bot can send ephemeral messages to a user in those channels
 * - Reports bot profile basics and (best-effort) presence
 *
 * Usage (from repo root):
 *   npm run check:slack-bot --workspace=@myloware/notification-service -- \
 *     --channels "#mylo-control,#mylo-approvals,#mylo-feed" --user U12345678
 *
 * Required env:
 *   SLACK_BOT_TOKEN
 *   (Optional) SLACK_SIGNING_SECRET (not used here)
 */

import { WebClient, LogLevel } from '@slack/web-api';
import * as path from 'node:path';
import * as fs from 'node:fs';
import dotenv from 'dotenv';

type ChannelInput = string; // channel ID like C123... or name like #mylo-feed

interface CheckResult {
  channel: string;
  channelId?: string;
  postedMessage?: boolean;
  messageTs?: string;
  reacted?: boolean;
  postedEphemeral?: boolean;
  errors: string[];
}

function parseArgs(): { channels: ChannelInput[]; userId?: string } {
  const args = process.argv.slice(2);
  let channelsArg = '';
  let userId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--channels' && args[i + 1]) {
      channelsArg = args[i + 1];
      i++;
      continue;
    }
    if (arg === '--user' && args[i + 1]) {
      userId = args[i + 1];
      i++;
      continue;
    }
  }
  const channels = channelsArg
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return { channels, userId };
}

async function resolveChannelId(
  client: WebClient,
  channel: ChannelInput
): Promise<{ id?: string; error?: string }> {
  // If already an ID (starts with C/G/D), use it
  if (/^[CGD][A-Z0-9]+$/i.test(channel)) {
    return { id: channel };
  }
  const name = channel.replace(/^#/, '');
  // Attempt to look up by name (requires channels:read)
  try {
    let cursor: string | undefined;
    do {
      const list = await client.conversations.list({ limit: 1000, cursor });
      if (!list.ok) {
        return { error: `conversations.list failed: ${list.error}` };
      }
      const match = (list.channels || []).find((c: any) => c.name === name);
      if (match?.id) return { id: match.id };
      cursor = (list.response_metadata as any)?.next_cursor;
    } while (cursor);
    return { error: `Channel not found by name: ${channel}` };
  } catch (err: any) {
    return {
      error: `Failed to resolve channel '${channel}': ${err?.data?.error || err?.message || 'unknown'}`,
    };
  }
}

async function ensureTestUser(
  client: WebClient,
  providedUserId?: string
): Promise<{ userId?: string; error?: string }> {
  if (providedUserId) return { userId: providedUserId };
  try {
    const res = await client.users.list();
    if (!res.ok) return { error: `users.list failed: ${res.error}` };
    const user = (res.members || []).find((u: any) => !u.is_bot && !u.deleted && u.id);
    if (!user) return { error: 'No suitable non-bot user found; provide --user Uxxxx' };
    return { userId: user.id };
  } catch (err: any) {
    return {
      error: `Failed to select a test user: ${err?.data?.error || err?.message || 'unknown'}`,
    };
  }
}

async function main() {
  // Load env similar to service bootstrap
  try {
    const repoRoot = path.resolve(__dirname, '../../..');
    const packageRoot = path.resolve(__dirname, '..');
    const candidateEnvPaths = [
      path.join(repoRoot, '.env'),
      path.join(repoRoot, '.env.local'),
      path.join(packageRoot, '.env'),
      path.join(packageRoot, '.env.local'),
      path.join(process.cwd(), '.env'),
      path.join(process.cwd(), '.env.local'),
    ];
    for (const p of candidateEnvPaths) {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p });
      }
    }
  } catch {
    // best effort only
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('Missing SLACK_BOT_TOKEN');
    process.exit(1);
  }
  const { channels, userId: cliUser } = parseArgs();
  if (channels.length === 0) {
    console.error('Provide --channels "#mylo-control,#mylo-approvals,#mylo-feed"');
    process.exit(1);
  }

  const client = new WebClient(token, { logLevel: LogLevel.ERROR });
  const summary: { bot?: any; checks: CheckResult[] } = { checks: [] };

  // Identify bot/user
  try {
    const auth = await client.auth.test();
    summary.bot = auth;
  } catch (err: any) {
    console.error('auth.test failed:', err?.data?.error || err?.message || 'unknown');
  }

  const testUser = await ensureTestUser(client, cliUser);
  if (testUser.error) {
    console.warn(`Ephemeral check will be skipped: ${testUser.error}`);
  }

  for (const channel of channels) {
    const result: CheckResult = { channel, errors: [] };
    summary.checks.push(result);

    // Resolve channel ID
    const resolved = await resolveChannelId(client, channel);
    if (resolved.error) {
      result.errors.push(resolved.error);
      continue;
    }
    result.channelId = resolved.id;

    // Post a message
    try {
      const post = await client.chat.postMessage({
        channel: result.channelId!,
        text: 'MyloWare bot permissions check ✅',
      });
      if (!post.ok) throw new Error(post.error);
      result.postedMessage = true;
      result.messageTs = (post as any).ts;
    } catch (err: any) {
      result.errors.push(
        `chat.postMessage failed: ${err?.data?.error || err?.message || 'unknown'}`
      );
    }

    // React to it
    if (result.postedMessage && result.messageTs) {
      try {
        const react = await client.reactions.add({
          channel: result.channelId!,
          timestamp: result.messageTs,
          name: 'white_check_mark',
        });
        if (!react.ok) throw new Error(react.error);
        result.reacted = true;
      } catch (err: any) {
        result.errors.push(
          `reactions.add failed: ${err?.data?.error || err?.message || 'unknown'}`
        );
      }
    }

    // Ephemeral message to test user
    if (testUser.userId) {
      try {
        const eph = await client.chat.postEphemeral({
          channel: result.channelId!,
          user: testUser.userId,
          text: 'MyloWare ephemeral check 👋',
        });
        if (!eph.ok) throw new Error(eph.error);
        result.postedEphemeral = true;
      } catch (err: any) {
        result.errors.push(
          `chat.postEphemeral failed: ${err?.data?.error || err?.message || 'unknown'}`
        );
      }
    }
  }

  // Bot profile & presence (best-effort)
  if (summary.bot?.user_id) {
    try {
      const info = await client.users.info({ user: summary.bot.user_id });
      (summary as any).bot_profile = info.ok ? (info as any).user?.profile : { error: info.error };
    } catch (err: any) {
      (summary as any).bot_profile = { error: err?.data?.error || err?.message || 'unknown' };
    }
    try {
      const pres = await client.users.getPresence({ user: summary.bot.user_id });
      (summary as any).bot_presence = pres.ok ? pres.presence : { error: pres.error };
    } catch (err: any) {
      (summary as any).bot_presence = { error: err?.data?.error || err?.message || 'unknown' };
    }
  }

  // Output JSON summary
  console.log(JSON.stringify({ success: true, ...summary }, null, 2));
}

main().catch(err => {
  console.error('Unexpected error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
