/**
 * Slack Command Service
 *
 * Parses and handles slash commands, integrates with workflow-service,
 * and coordinates thread posting via ThreadManagerService.
 */

import axios from 'axios';
import Joi from 'joi';
import { createLogger } from '@myloware/shared';
import { ThreadManagerService } from './thread-manager.service';

const logger = createLogger('notification-service:slack-command');

export type SlackSlashCommand = {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  channel_name: string;
  response_url?: string;
  trigger_id?: string;
};

export class SlackCommandService {
  private readonly workflowBaseUrl: string;

  constructor(private readonly threadManager: ThreadManagerService) {
    this.workflowBaseUrl = process.env['WORKFLOW_SERVICE_URL'] || 'http://localhost:3001';
  }

  async handleSlashCommand(payload: SlackSlashCommand): Promise<{ text: string }> {
    const trimmed = (payload.text || '').trim();
    if (!trimmed) return { text: this.helpText() };

    const [sub, ...rest] = trimmed.split(/\s+/);
    switch (sub) {
      case 'new':
        return this.handleNewCommand(rest.join(' '), payload);
      case 'status':
        return this.handleStatusCommand(rest.join(' '), payload);
      case 'talk':
        return this.handleTalkCommand(rest.join(' '), payload);
      case 'stop':
        return this.handleStopCommand(rest.join(' '), payload);
      case 'mute':
        return this.handleMuteCommand(rest.join(' '), payload);
      default:
        return { text: `Unknown subcommand: ${sub}\n${this.helpText()}` };
    }
  }

  private helpText(): string {
    return [
      '*Mylo Slash Commands*',
      '• /mylo new [template] [--title "..."]',
      '• /mylo status <run_id>',
      '• /mylo talk <message>',
      '• /mylo stop <run_id>',
      '• /mylo mute <run_id>',
    ].join('\n');
  }

  private parseFlags(text: string): { args: string[]; flags: Record<string, string> } {
    const parts = (text.match(/(?:"[^"]*"|'[^']*'|\S+)/g) || []) as string[];
    const args: string[] = [];
    const flags: Record<string, string> = {};
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (typeof p !== 'string') continue;
      if (p.startsWith('--')) {
        const key = p.slice(2);
        const next = parts[i + 1];
        if (typeof next === 'string' && !next.startsWith('--')) {
          flags[key] = this.stripQuotes(next);
          i++;
        } else {
          flags[key] = 'true';
        }
      } else {
        args.push(this.stripQuotes(p));
      }
    }
    return { args, flags };
  }

  private stripQuotes(v: string): string {
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  }

  private validateRunId(runId: string): void {
    const schema = Joi.string().uuid({ version: 'uuidv4' });
    const { error } = schema.validate(runId);
    if (error) throw new Error('Invalid run_id format');
  }

  private async handleNewCommand(
    text: string,
    payload: SlackSlashCommand
  ): Promise<{ text: string }> {
    const { args, flags } = this.parseFlags(text);
    const template = args[0] || 'docs-extract-verify';
    const title = flags['title'] || `Run started by @${payload.user_name}`;

    // Seed a run_id
    const runId = cryptoRandomUuid();
    const initialMessage = `New run created: ${title} (template: ${template})`;
    await this.threadManager.createRunThread(runId, initialMessage, {
      template,
      user_id: payload.user_id,
      user_name: payload.user_name,
    });

    // Kick off workflow (docs-extract-verify endpoint)
    try {
      const startUrl = `${this.workflowBaseUrl}/api/v1/workflows/docs-extract-verify`;
      const workOrderInput = {
        workOrderId: runId,
        workItems: [],
        priority: 'MEDIUM',
        metadata: { title, template, startedBy: payload.user_id },
      };
      await axios.post(startUrl, workOrderInput);
      await this.threadManager.updateRunThread(runId, 'Workflow start requested', {
        status: 'STARTED',
      });
    } catch (error) {
      logger.error('Failed to start workflow', { error: toErrorMessage(error), runId });
      await this.threadManager.updateRunThread(runId, 'Failed to start workflow', {
        status: 'ERROR',
      });
      return { text: `Failed to start workflow for run ${runId}` };
    }

    const link = `#mylo-feed (thread for ${runId})`;
    return { text: `Run created: ${runId}\nThread: ${link}` };
  }

  private async handleStatusCommand(
    text: string,
    _payload: SlackSlashCommand
  ): Promise<{ text: string }> {
    const runId = text.trim();
    if (!runId) return { text: 'Usage: /mylo status <run_id>' };
    this.validateRunId(runId);
    try {
      const url = `${this.workflowBaseUrl}/api/v1/workflows/${encodeURIComponent(runId)}/status`;
      const { data } = await axios.get(url);
      await this.threadManager.updateRunThread(runId, 'Status checked');
      return { text: `Status for ${runId}: ${data?.status ?? 'UNKNOWN'}` };
    } catch (error) {
      logger.error('Failed to get status', { error: toErrorMessage(error), runId });
      return { text: `Failed to get status for ${runId}` };
    }
  }

  private async handleTalkCommand(
    text: string,
    payload: SlackSlashCommand
  ): Promise<{ text: string }> {
    const message = text.trim();
    if (!message) return { text: 'Usage: /mylo talk <message>' };
    // For now, just post into thread
    const runIdInMessage = this.extractFirstUuid(message);
    const runId = runIdInMessage || cryptoRandomUuid();
    await this.threadManager.updateRunThread(runId, `@${payload.user_name}: ${message}`);
    return { text: `Noted. Added your comment to run ${runId}` };
  }

  private extractFirstUuid(text: string): string | null {
    const m = text.match(
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/
    );
    return m ? m[0] : null;
  }

  private async handleStopCommand(
    text: string,
    _payload: SlackSlashCommand
  ): Promise<{ text: string }> {
    const runId = text.trim();
    if (!runId) return { text: 'Usage: /mylo stop <run_id>' };
    this.validateRunId(runId);
    try {
      const url = `${this.workflowBaseUrl}/api/v1/workflows/${encodeURIComponent(runId)}`;
      await axios.delete(url);
      await this.threadManager.updateRunThread(runId, 'Run cancelled by user', { status: 'DONE' });
      return { text: `Stopped run ${runId}` };
    } catch (error) {
      logger.error('Failed to stop run', { error: toErrorMessage(error), runId });
      return { text: `Failed to stop ${runId}` };
    }
  }

  private async handleMuteCommand(
    text: string,
    payload: SlackSlashCommand
  ): Promise<{ text: string }> {
    const runId = text.trim();
    if (!runId) return { text: 'Usage: /mylo mute <run_id>' };
    this.validateRunId(runId);
    // MVP: Acknowledge; real user-specific suppression to be added later
    await this.threadManager.updateRunThread(
      runId,
      `@${payload.user_name} muted non-critical updates`
    );
    return { text: `Muted updates for ${runId} (user-specific)` };
  }
}

function toErrorMessage(err: any): string {
  if (!err) return 'Unknown error';
  if (err.response && err.response.data) return JSON.stringify(err.response.data);
  return String(err.message || err);
}

function cryptoRandomUuid(): string {
  // Avoid importing node:crypto randomUUID to keep compatibility with ts-jest transpile
  const hex = (n: number) =>
    [...cryptoRandomBytes(n)].map(b => b.toString(16).padStart(2, '0')).join('');
  const a = hex(4);
  const b = hex(2);
  const c = hex(2);
  const d = hex(2);
  const e = hex(6);
  // RFC4122 v4 variant
  const c1 = (parseInt(c.slice(0, 2), 16) & 0x0f) | 0x40; // version 4
  const d1 = (parseInt(d.slice(0, 2), 16) & 0x3f) | 0x80; // variant 10
  return `${a}-${b}-${c1.toString(16).padStart(2, '0')}${c.slice(2)}-${d1
    .toString(16)
    .padStart(2, '0')}${d.slice(2)}-${e}`;
}

function cryptoRandomBytes(len: number): Uint8Array {
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}
