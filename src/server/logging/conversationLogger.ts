import { createHash } from 'node:crypto';
import type { JSONRPCMessage, JSONRPCNotification, JSONRPCRequest, JSONRPCResponse, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js' with { 'resolution-mode': 'import' };
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js' with { 'resolution-mode': 'import' };
import { EpisodicMemoryRepository } from '../../db/episodicRepository';
import type { ConversationRole } from '../../db/schema';
import { config } from '../../config';

const SKIP_METHODS = new Set<string>([
  'initialize',
  'ping',
  'tools/list',
  'prompts/list',
  'resources/list',
  'logging/setLevel',
  'notifications/progress',
]);

type Direction = 'incoming' | 'outgoing';

interface ConversationLoggingOptions {
  repository?: EpisodicMemoryRepository;
  enabled?: boolean;
}

const OPT_OUT_HEADER = 'x-episodic-opt-out';
const USER_ID_HEADER = 'x-user-id';

const MAX_CONTENT_LENGTH = 4000;

interface TransportLike {
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  send: StreamableHTTPServerTransport['send'];
  start: StreamableHTTPServerTransport['start'];
  sessionId?: string;
}

export type { TransportLike };

export function attachConversationLogging(
  transport: TransportLike,
  options: ConversationLoggingOptions = {},
): void {
  const enabled = options.enabled ?? config.episodicMemory.enabled;
  if (!enabled) {
    return;
  }

  const repository = options.repository ?? new EpisodicMemoryRepository();
  const optedOutSessions = new Set<string>();

  const originalOnMessage = transport.onmessage?.bind(transport);
  transport.onmessage = (message: JSONRPCMessage, extra?: MessageExtraInfo) => {
    void logMessage({
      transport,
      repository,
      message,
      extra,
      direction: 'incoming',
      role: 'user',
      optedOutSessions,
    });

    originalOnMessage?.(message, extra);
  };

  const originalSend = transport.send.bind(transport);
  transport.send = async (message, sendOptions) => {
    const relatedRequestId =
      sendOptions?.relatedRequestId !== undefined && sendOptions?.relatedRequestId !== null
        ? String(sendOptions.relatedRequestId)
        : undefined;

    void logMessage({
      transport,
      repository,
      message,
      extra: relatedRequestId ? { relatedRequestId } : undefined,
      direction: 'outgoing',
      role: 'assistant',
      optedOutSessions,
    });

    return originalSend(message, sendOptions);
  };
}

interface LogContext {
  transport: TransportLike;
  repository: EpisodicMemoryRepository;
  message: JSONRPCMessage;
  extra?: MessageExtraInfo | { relatedRequestId?: string };
  direction: Direction;
  role: ConversationRole;
  optedOutSessions: Set<string>;
}

async function logMessage({
  transport,
  repository,
  message,
  extra,
  direction,
  role,
  optedOutSessions,
}: LogContext): Promise<void> {
  try {
    const sessionId = resolveSessionId(transport, extra);
    if (!sessionId) {
      return;
    }

    const optOut = isOptOut(extra);
    if (optOut) {
      optedOutSessions.add(sessionId);
      return;
    }
    if (optedOutSessions.has(sessionId)) {
      return;
    }

    const content = formatMessageContent(message, direction);
    if (!content) {
      return;
    }

    const normalizedContent =
      content.length > MAX_CONTENT_LENGTH ? `${content.slice(0, MAX_CONTENT_LENGTH)}…` : content;

    const userId = extractHeader(extra, USER_ID_HEADER);
    const messageId = hashMessage(sessionId, direction, normalizedContent);

    await repository.storeConversationTurn(
      {
        sessionId,
        content: normalizedContent,
        role,
        userId,
        metadata: buildMetadata(message, direction, extra, messageId),
        embeddingText: normalizedContent,
      },
      { embed: undefined },
    );
  } catch (error) {
    // eslint-disable-next-line no-console -- non-critical telemetry
    console.warn('conversation logging failed', error);
  }
}

function formatMessageContent(message: JSONRPCMessage, direction: Direction): string | null {
  if (isRequest(message)) {
    if (SKIP_METHODS.has(message.method)) {
      return null;
    }
    const params = message.params ? stringifySafe(message.params) : '';
    const prefix = direction === 'incoming' ? 'Client request' : 'Server request';
    return params ? `${prefix}: ${message.method}\n${params}` : `${prefix}: ${message.method}`;
  }

  if (isNotification(message)) {
    if (SKIP_METHODS.has(message.method)) {
      return null;
    }
    const params = message.params ? stringifySafe(message.params) : '';
    const prefix = direction === 'incoming' ? 'Client notification' : 'Server notification';
    return params ? `${prefix}: ${message.method}\n${params}` : `${prefix}: ${message.method}`;
  }

  if (isResponse(message)) {
    const prefix = direction === 'incoming' ? 'Client response' : 'Server response';
    let payload = '';

    if ('result' in message && message.result !== undefined) {
      payload = stringifySafe(message.result);
    } else if ('error' in message && message.error !== undefined) {
      payload = stringifySafe(message.error);
    }

    return payload
      ? `${prefix} to ${String(message.id)}\n${payload}`
      : `${prefix} to ${String(message.id)}`;
  }

  return stringifySafe(message);
}

function buildMetadata(
  message: JSONRPCMessage,
  direction: Direction,
  extra: MessageExtraInfo | { relatedRequestId?: string } | undefined,
  messageId: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    direction,
    message_id: messageId,
  };

  if (isRequest(message) || isNotification(message)) {
    metadata.method = message.method;
  }

  if ('id' in message && message.id !== undefined) {
    metadata.request_id = message.id;
  }

  const related = extra && 'relatedRequestId' in extra ? extra.relatedRequestId : undefined;
  if (related !== undefined) {
    metadata.related_request_id = related;
  }

  const requestInfo = extra && 'requestInfo' in extra ? extra.requestInfo : undefined;
  if (requestInfo?.headers) {
    const actor = extractHeader({ requestInfo }, 'user-agent');
    if (actor) {
      metadata.actor = actor;
    }
  }

  return metadata;
}

function resolveSessionId(
  transport: TransportLike,
  extra: MessageExtraInfo | { relatedRequestId?: string } | undefined,
): string | null {
  if (transport.sessionId) {
    return transport.sessionId;
  }

  const headerValue = extractHeader(extra, 'mcp-session-id');
  if (headerValue) {
    return headerValue;
  }

  return null;
}

function extractHeader(
  extra: MessageExtraInfo | { relatedRequestId?: string } | undefined,
  headerName: string,
): string | null {
  if (!extra || !('requestInfo' in extra)) {
    return null;
  }
  const headers = extra.requestInfo?.headers;
  if (!headers) {
    return null;
  }
  const key = headerName.toLowerCase();
  const headerValue = headers[key] ?? headers[headerName] ?? headers[key as keyof typeof headers];

  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }
  if (typeof headerValue === 'string') {
    return headerValue;
  }
  return null;
}

function isOptOut(extra: MessageExtraInfo | { relatedRequestId?: string } | undefined): boolean {
  const value = extractHeader(extra, OPT_OUT_HEADER);
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function hashMessage(sessionId: string, direction: Direction, content: string): string {
  return createHash('sha1').update(`${sessionId}:${direction}:${content}`).digest('hex');
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRequest(message: JSONRPCMessage): message is JSONRPCRequest {
  return 'method' in message && 'id' in message && message.id !== undefined;
}

function isNotification(message: JSONRPCMessage): message is JSONRPCNotification {
  return 'method' in message && !('id' in message);
}

function isResponse(message: JSONRPCMessage): message is JSONRPCResponse {
  return 'id' in message && ('result' in message || 'error' in message);
}
