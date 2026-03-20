import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage, MessagePart } from '@chat-template/core';
import { generateUUID } from '@/lib/utils';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

interface UseChatWithWebSocketOptions {
  chatId: string;
  initialMessages: ChatMessage[];
  selectedChatModel: string;
  onFinish?: (message: ChatMessage) => void;
  onError?: (error: Error) => void;
}

type ChatStatus = 'idle' | 'connecting' | 'streaming' | 'error';

/**
 * Chat hook using WebSocket for streaming
 * Designed to be a drop-in replacement for useChat when WebSocket is enabled
 */
export function useChatWithWebSocket(options: UseChatWithWebSocketOptions) {
  const { chatId, initialMessages, selectedChatModel, onFinish, onError } = options;

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  // Current streaming message state
  const [_streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [_streamingText, setStreamingText] = useState<string>('');
  const [_streamingParts, setStreamingParts] = useState<MessagePart[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Build WebSocket URL
  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/chat`;
  }, []);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data: WebSocketMessage = JSON.parse(event.data);

      switch (data.type) {
        case 'connected':
          console.log('[WS Chat] Connected to server');
          setStatus('idle');
          break;

        case 'start':
          console.log('[WS Chat] Stream started');
          setStatus('streaming');
          break;

        case 'message_start': {
          console.log('[WS Chat] Message started:', data.messageId);
          setStreamingMessageId(data.messageId);
          setStreamingText('');
          setStreamingParts([]);

          // Add placeholder message to messages array
          const placeholderMessage: ChatMessage = {
            id: data.messageId,
            role: 'assistant',
            parts: [],
            createdAt: new Date(),
            attachments: [],
          };
          setMessages(prev => [...prev, placeholderMessage]);
          break;
        }

        case 'text_delta':
          setStreamingText(prev => {
            const newText = prev + data.delta;

            // Update the message in the messages array with current text
            setMessages(prevMessages => {
              const lastIdx = prevMessages.length - 1;
              if (lastIdx >= 0 && prevMessages[lastIdx].id === data.messageId) {
                const updated = [...prevMessages];
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  parts: [{ type: 'text', text: newText }],
                };
                return updated;
              }
              return prevMessages;
            });

            return newText;
          });
          break;

        case 'tool_call_start': {
          // Handle tool call streaming
          const toolPart: MessagePart = {
            type: 'dynamic-tool',
            toolCallId: data.toolCallId,
            toolName: data.toolName,
            input: data.args,
            state: 'input-available',
          };
          setStreamingParts(prev => [...prev, toolPart]);
          break;
        }

        case 'tool_result':
          // Update tool call with result
          setStreamingParts(prev => {
            return prev.map(part => {
              if (part.type === 'dynamic-tool' && part.toolCallId === data.toolCallId) {
                return {
                  ...part,
                  output: data.result,
                  state: 'output-available',
                };
              }
              return part;
            });
          });
          break;

        case 'message_end':
          console.log('[WS Chat] Message ended:', data.finishReason);
          break;

        case 'done':
          console.log('[WS Chat] Stream done');
          setStatus('idle');

          // Finalize the message
          setMessages(prevMessages => {
            const lastIdx = prevMessages.length - 1;
            if (lastIdx >= 0 && prevMessages[lastIdx].id === data.messageId) {
              const finalMessage = prevMessages[lastIdx];
              onFinish?.(finalMessage);
            }
            return prevMessages;
          });

          setStreamingMessageId(null);
          setStreamingText('');
          setStreamingParts([]);
          break;

        case 'warning':
          console.warn('[WS Chat] Warning:', data.message);
          break;

        case 'error':
          console.error('[WS Chat] Error:', data.error);
          setStatus('error');
          setError(new Error(data.error));
          onError?.(new Error(data.error));
          break;

        default:
          console.log('[WS Chat] Unknown message type:', data.type, data);
      }
    } catch (err) {
      console.error('[WS Chat] Failed to parse message:', err);
    }
  }, [onFinish, onError]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus('connecting');
    const url = getWebSocketUrl();
    console.log('[WS Chat] Connecting to:', url);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS Chat] WebSocket opened');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    ws.onmessage = handleMessage;

    ws.onerror = (event) => {
      console.error('[WS Chat] WebSocket error:', event);
    };

    ws.onclose = (event) => {
      console.log('[WS Chat] WebSocket closed:', event.code, event.reason);
      setStatus('idle');
      wsRef.current = null;

      // Auto-reconnect if not intentionally closed
      if (event.code !== 1000 && event.code !== 1001) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[WS Chat] Attempting reconnect...');
          connect();
        }, 3000);
      }
    };
  }, [getWebSocketUrl, handleMessage]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }
  }, []);

  // Send a message
  const sendMessage = useCallback(async (content: string, attachments: any[] = []) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[WS Chat] WebSocket not connected');
      setError(new Error('WebSocket not connected'));
      return;
    }

    // Create user message
    const userMessage: ChatMessage = {
      id: generateUUID(),
      role: 'user',
      parts: [{ type: 'text', text: content }],
      createdAt: new Date(),
      attachments: attachments.map(a => ({
        type: 'file' as const,
        url: a.url,
        filename: a.name,
        mediaType: a.contentType,
      })),
    };

    // Add user message to messages
    setMessages(prev => [...prev, userMessage]);

    // Send to WebSocket
    const payload = {
      type: 'chat',
      chatId,
      messages: [...messages, userMessage],
      selectedChatModel,
    };

    console.log('[WS Chat] Sending message:', {
      chatId,
      messageCount: payload.messages.length,
    });

    wsRef.current.send(JSON.stringify(payload));
  }, [chatId, messages, selectedChatModel]);

  // Stop streaming (not fully supported in WebSocket mode)
  const stop = useCallback(() => {
    console.log('[WS Chat] Stop requested (limited support)');
    // WebSocket doesn't support stopping mid-stream easily
    // The server would need to handle an abort message
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
    setStatus('idle');
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, []);

  // Update messages when initialMessages change
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  return {
    messages,
    setMessages,
    status,
    isLoading: status === 'streaming' || status === 'connecting',
    error,
    sendMessage,
    stop,
    clearError,
    // Additional WebSocket-specific
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    reconnect: connect,
  };
}
