import { describe, expect, it, vi } from 'vitest';
import type {
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  MessageExtraInfo,
} from '@modelcontextprotocol/sdk/types.js' with { 'resolution-mode': 'import' };
import { attachConversationLogging, type TransportLike } from './conversationLogger';

function createTransport(sessionId = 'session-123'): TransportLike & { sessionId: string } {
  const transport: TransportLike = {
    sessionId,
    onmessage: undefined,
    send: vi.fn(
      async (...args: Parameters<TransportLike['send']>) =>
        undefined,
    ) as unknown as TransportLike['send'],
    start: vi.fn(
      async (...args: Parameters<TransportLike['start']>) =>
        undefined,
    ) as unknown as TransportLike['start'],
  };
  return transport as TransportLike & { sessionId: string };
}

describe('attachConversationLogging', () => {
  it('logs incoming requests with metadata when enabled', async () => {
    const transport = createTransport();
    const originalHandler = vi.fn<NonNullable<TransportLike['onmessage']>>();
    transport.onmessage = originalHandler;

    const storeConversationTurn = vi.fn().mockResolvedValue(undefined);
    const repository = {
      storeConversationTurn,
    } as never;

    attachConversationLogging(transport, { repository, enabled: true });

    const message: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'prompt_search',
        arguments: { query: 'latest brief' },
      },
    };

    const headers = {
      'mcp-session-id': transport.sessionId,
      'x-user-id': 'user-42',
    };

    transport.onmessage?.(message, { requestInfo: { headers } });

    // Allow async logging to complete
    await vi.waitFor(() => {
      expect(storeConversationTurn).toHaveBeenCalledTimes(1);
    });

    const args = storeConversationTurn.mock.calls[0][0];
    expect(args.sessionId).toBe('session-123');
    expect(args.role).toBe('user');
    expect(args.userId).toBe('user-42');
    expect(args.content).toContain('tools/call');
    expect(originalHandler).toHaveBeenCalledWith(message, { requestInfo: { headers } });
  });

  it('skips logging when opt-out header is present', async () => {
    const transport = createTransport();
    const storeConversationTurn = vi.fn();
    const repository = { storeConversationTurn } as never;

    attachConversationLogging(transport, { repository, enabled: true });

    const message: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'prompt_get', arguments: {} },
    };

    const headers = {
      'mcp-session-id': transport.sessionId,
      'x-episodic-opt-out': 'true',
    };

    transport.onmessage?.(message, { requestInfo: { headers } });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(storeConversationTurn).not.toHaveBeenCalled();
  });

  it('logs outgoing responses via wrapped send method', async () => {
    const transport = createTransport();
    const storeConversationTurn = vi.fn().mockResolvedValue(undefined);
    const repository = { storeConversationTurn } as never;

    const originalSend = transport.send;
    attachConversationLogging(transport, { repository, enabled: true });

    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: 3,
      result: { content: [{ type: 'text', text: 'All good' }] },
    };

    await transport.send(response, { relatedRequestId: 3 });

    expect(originalSend).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(storeConversationTurn).toHaveBeenCalled();
    });

    const lastCall = storeConversationTurn.mock.calls[storeConversationTurn.mock.calls.length - 1]?.[0];
    expect(lastCall?.role).toBe('assistant');
    expect(lastCall?.metadata?.related_request_id).toBe('3');
  });
});
