import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { streamText, convertToModelMessages, type LanguageModelUsage } from 'ai';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import { saveMessages, updateChatLastContextById } from '@chat-template/db';
import {
  type ChatMessage,
  generateUUID,
  myProvider,
} from '@chat-template/core';
import { setRequestContext } from '@chat-template/ai-sdk-providers';
import {
  CONTEXT_HEADER_CONVERSATION_ID,
  CONTEXT_HEADER_USER_ID,
} from '@chat-template/ai-sdk-providers';

/**
 * Check if a part is a tool call type (handles various formats from different sources)
 */
function isToolCallPart(part: any): boolean {
  return part.type === 'dynamic-tool' ||
    part.type === 'tool-invocation' ||
    part.type === 'function_call' ||
    part.type === 'tool-call';
}

/**
 * Filters and fixes tool calls from messages.
 * - Removes incomplete tool calls (missing output/result)
 * - Adds missing fields required by convertToModelMessages (id, args, result)
 * - Handles multiple tool call formats: dynamic-tool, tool-invocation, function_call, tool-call
 */
function filterIncompleteToolCalls(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant' || !message.parts) {
      return message;
    }

    // Filter and fix tool call parts (handle multiple formats)
    const filteredParts = message.parts
      .filter((part: any) => {
        if (isToolCallPart(part)) {
          // Check for both 'output' and 'result' as either could be present
          // Also check state if available (dynamic-tool format)
          const hasResult = (
            part.state === 'output-available' ||
            part.output !== undefined ||
            part.result !== undefined
          );
          if (!hasResult) {
            const toolName = part.toolName || part.name || 'unknown';
            const toolCallId = part.toolCallId || part.call_id || part.id || 'unknown';
            console.log(`[WebSocket] Filtering incomplete tool call: ${toolName} (${toolCallId})`);
          }
          return hasResult;
        }
        return true;
      })
      .map((part: any) => {
        // Fix tool calls that are missing required fields for conversion
        if (isToolCallPart(part)) {
          const unifiedId = part.id ?? part.toolCallId ?? part.call_id;
          const unifiedName = part.name ?? part.toolName;
          let unifiedArgs = part.args ?? part.input;
          // Safely parse arguments string if needed
          if (!unifiedArgs && typeof part.arguments === 'string') {
            try {
              unifiedArgs = JSON.parse(part.arguments);
            } catch {
              unifiedArgs = part.arguments;
            }
          } else if (!unifiedArgs) {
            unifiedArgs = part.arguments ?? {};
          }
          return {
            ...part,
            // Set ALL ID field names for compatibility with different systems
            id: unifiedId,
            call_id: unifiedId,  // Databricks requires this
            toolCallId: unifiedId,
            // Set ALL name field names
            name: unifiedName,
            toolName: unifiedName,
            // Ensure 'args' field exists (AI SDK expects 'args' not 'input' or 'arguments')
            args: unifiedArgs,
            arguments: typeof unifiedArgs === 'object' ? JSON.stringify(unifiedArgs) : unifiedArgs,
            // Ensure 'result' field exists (AI SDK expects 'result' not 'output')
            result: part.result ?? part.output,
          };
        }
        return part;
      });

    // If all parts were filtered out, return message with placeholder
    if (filteredParts.length === 0 && message.parts.length > 0) {
      console.log(`[WebSocket] All parts filtered from message ${message.id}, adding placeholder`);
      return {
        ...message,
        parts: [{ type: 'text', text: '[Previous response was interrupted]' }],
      };
    }

    return {
      ...message,
      parts: filteredParts,
    };
  });
}

// Convert ai's LanguageModelUsage to @ai-sdk/provider's LanguageModelV3Usage
function toV3Usage(usage: LanguageModelUsage): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: undefined,
      reasoning: undefined,
    },
  };
}

interface WebSocketChatMessage {
  type: 'chat';
  chatId: string;
  messages: ChatMessage[];
  selectedChatModel: string;
}

interface WebSocketAuthMessage {
  type: 'auth';
  token?: string;
  headers?: Record<string, string>;
}

type WebSocketIncomingMessage = WebSocketChatMessage | WebSocketAuthMessage;

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  userEmail?: string;
  userAccessToken?: string;
  isAuthenticated?: boolean;
}

/**
 * Initialize WebSocket server for chat streaming
 */
export function initializeWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws/chat',
  });

  console.log('[WebSocket] Server initialized on /ws/chat');

  // Ping all clients every 25 seconds to keep connections alive through proxy
  const PING_INTERVAL_MS = 25000;
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    });
  }, PING_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  wss.on('connection', (ws: AuthenticatedWebSocket, req: IncomingMessage) => {
    console.log('[WebSocket] New connection');

    // Track last pong to detect dead connections
    let _lastPong = Date.now();
    ws.on('pong', () => {
      _lastPong = Date.now();
    });

    // Try to authenticate from headers (for initial connection)
    authenticateFromHeaders(ws, req);

    ws.on('message', async (data) => {
      try {
        const message: WebSocketIncomingMessage = JSON.parse(data.toString());

        if (message.type === 'auth') {
          // Handle authentication message
          handleAuthMessage(ws, message);
          return;
        }

        if (message.type === 'chat') {
          // Handle chat message
          await handleChatMessage(ws, message);
          return;
        }

        ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
      } catch (error) {
        console.error('[WebSocket] Error processing message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    });

    ws.on('close', () => {
      console.log('[WebSocket] Connection closed');
    });

    ws.on('error', (error) => {
      console.error('[WebSocket] Error:', error);
    });

    // Send ready signal
    ws.send(JSON.stringify({ type: 'connected' }));
  });

  return wss;
}

/**
 * Authenticate WebSocket connection from HTTP headers
 */
function authenticateFromHeaders(ws: AuthenticatedWebSocket, req: IncomingMessage): void {
  const headers = req.headers;

  // Debug: Log all x-forwarded and authorization headers for OBO troubleshooting
  const relevantHeaders = Object.entries(headers)
    .filter(([key]) =>
      key.toLowerCase().startsWith('x-forwarded') ||
      key.toLowerCase().startsWith('x-databricks') ||
      key.toLowerCase() === 'authorization'
    )
    .map(([key, value]) => {
      const val = String(value);
      if (key.toLowerCase().includes('token') || key.toLowerCase() === 'authorization') {
        return `${key}: ${val.length > 20 ? `${val.substring(0, 10)}...${val.substring(val.length - 10)} (len=${val.length})` : '***SHORT***'}`;
      }
      return `${key}: ${val}`;
    });
  console.log('[WebSocket Auth Debug] Headers:', relevantHeaders.length > 0 ? relevantHeaders.join(', ') : 'NONE');

  // Check for Databricks Apps headers
  const userId = headers['x-forwarded-user'] as string;
  const userEmail = headers['x-forwarded-email'] as string;
  // Try multiple possible header names for the user access token
  const userAccessToken = (
    headers['x-forwarded-access-token'] ||
    headers['x-databricks-user-access-token'] ||
    headers['x-databricks-access-token']
  ) as string;

  if (userId) {
    ws.userId = userId;
    ws.userEmail = userEmail;
    ws.userAccessToken = userAccessToken;
    ws.isAuthenticated = true;
    console.log('[WebSocket] Authenticated from headers:', userEmail || userId, userAccessToken ? '(with OBO token)' : '(no OBO token)');
  }
}

/**
 * Handle authentication message from client
 */
function handleAuthMessage(ws: AuthenticatedWebSocket, message: WebSocketAuthMessage): void {
  if (message.headers) {
    const headers = message.headers;
    ws.userId = headers['x-forwarded-user'];
    ws.userEmail = headers['x-forwarded-email'];
    // Try multiple possible header names for the user access token
    ws.userAccessToken =
      headers['x-forwarded-access-token'] ||
      headers['x-databricks-user-access-token'] ||
      headers['x-databricks-access-token'];
    ws.isAuthenticated = !!ws.userId;

    console.log('[WebSocket] Authenticated via message:', ws.userEmail || ws.userId, ws.userAccessToken ? '(with OBO token)' : '(no OBO token)');
  }

  ws.send(JSON.stringify({
    type: 'auth_result',
    success: ws.isAuthenticated,
    userId: ws.userId,
  }));
}

/**
 * Handle chat message - stream response via WebSocket
 */
async function handleChatMessage(
  ws: AuthenticatedWebSocket,
  message: WebSocketChatMessage
): Promise<void> {
  if (!ws.isAuthenticated) {
    ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
    return;
  }

  const { chatId, messages: uiMessages, selectedChatModel } = message;

  console.log('[WebSocket] Chat request:', {
    chatId,
    messageCount: uiMessages.length,
    model: selectedChatModel
  });

  // Set request context for OBO operations
  if (ws.userAccessToken) {
    setRequestContext({
      userAccessToken: ws.userAccessToken,
      userEmail: ws.userEmail,
    });
  }

  let finalUsage: LanguageModelUsage | undefined;
  let finishReason: string | undefined;

  // Heartbeat to keep connection alive during long operations
  const HEARTBEAT_INTERVAL_MS = 15000; // 15 seconds
  let heartbeatCount = 0;
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      heartbeatCount++;
      ws.send(JSON.stringify({ type: 'heartbeat', count: heartbeatCount }));
      console.log(`[WebSocket] Heartbeat #${heartbeatCount} for chat ${chatId}`);
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const model = await myProvider.languageModel(selectedChatModel);

    // Send start signal
    ws.send(JSON.stringify({ type: 'start', chatId }));

    // Filter and fix tool calls before conversion
    const messagesWithCompleteTools = filterIncompleteToolCalls(uiMessages);

    const result = streamText({
      model,
      messages: await convertToModelMessages(messagesWithCompleteTools),
      headers: {
        [CONTEXT_HEADER_CONVERSATION_ID]: chatId,
        [CONTEXT_HEADER_USER_ID]: ws.userEmail ?? ws.userId ?? '',
      },
      onFinish: ({ usage, finishReason: reason }) => {
        finalUsage = usage;
        finishReason = reason;
      },
    });

    // Stream the response via WebSocket
    const messageId = generateUUID();
    let fullText = '';
    const parts: any[] = [];

    // Send message start
    ws.send(JSON.stringify({
      type: 'message_start',
      messageId,
      role: 'assistant',
    }));

    // Stream text chunks
    for await (const chunk of result.textStream) {
      fullText += chunk;
      ws.send(JSON.stringify({
        type: 'text_delta',
        messageId,
        delta: chunk,
      }));
    }

    // Wait for completion
    await result.response;

    // Build final message parts
    if (fullText) {
      parts.push({ type: 'text', text: fullText });
    }

    // Get tool calls if any (basic support - tool results are complex)
    try {
      const toolCalls = await result.toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          parts.push({
            type: 'tool-invocation',
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            args: 'args' in toolCall ? toolCall.args : {},
            state: 'result',
          });
        }
      }
    } catch (toolErr) {
      console.warn('[WebSocket] Tool calls not available:', toolErr);
    }

    // Send message end
    ws.send(JSON.stringify({
      type: 'message_end',
      messageId,
      finishReason: finishReason || 'stop',
    }));

    // Save message to database
    if (parts.length > 0) {
      try {
        await saveMessages({
          messages: [{
            id: messageId,
            role: 'assistant',
            parts,
            createdAt: new Date(),
            attachments: [],
            chatId,
          }],
        });

        if (finalUsage) {
          await updateChatLastContextById({
            chatId,
            context: toV3Usage(finalUsage),
          });
        }

        console.log('[WebSocket] Message saved:', messageId);
      } catch (saveError) {
        console.error('[WebSocket] Failed to save message:', saveError);
      }
    }

    // Send completion signal
    ws.send(JSON.stringify({
      type: 'done',
      chatId,
      messageId,
      usage: finalUsage,
      finishReason,
    }));

    // Log if truncated
    if (finishReason === 'length') {
      console.warn('[WebSocket] Response truncated due to token limit');
      ws.send(JSON.stringify({
        type: 'warning',
        message: 'Response truncated - output limit reached. Send "continue" to get more.',
      }));
    }

  } catch (error) {
    console.error('[WebSocket] Chat error:', error);
    ws.send(JSON.stringify({
      type: 'error',
      error: error instanceof Error ? error.message : 'Chat failed',
      chatId,
    }));
  } finally {
    // Always clean up heartbeat
    clearInterval(heartbeatInterval);
    console.log(`[WebSocket] Heartbeat stopped after ${heartbeatCount} beats for chat ${chatId}`);
  }
}
