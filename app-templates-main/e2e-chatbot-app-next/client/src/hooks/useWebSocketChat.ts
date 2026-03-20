import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage } from '@chat-template/core';

interface WebSocketChatOptions {
  chatId: string;
  onMessage?: (message: ChatMessage) => void;
  onTextDelta?: (delta: string, messageId: string) => void;
  onError?: (error: string) => void;
  onDone?: (result: { messageId: string; finishReason: string }) => void;
}

type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'streaming';

interface UseWebSocketChatReturn {
  status: WebSocketStatus;
  connect: () => void;
  disconnect: () => void;
  sendMessage: (messages: ChatMessage[], model: string) => void;
  isConnected: boolean;
  isStreaming: boolean;
  currentMessageId: string | null;
  currentText: string;
}

/**
 * Hook for WebSocket-based chat streaming
 * Maintains connection and handles message streaming
 */
export function useWebSocketChat(options: WebSocketChatOptions): UseWebSocketChatReturn {
  const { chatId, onMessage, onTextDelta, onError, onDone } = options;

  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Build WebSocket URL
  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/chat`;
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus('connecting');
    const url = getWebSocketUrl();
    console.log('[WebSocketChat] Connecting to:', url);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WebSocketChat] Connected');
      setStatus('connected');

      // Clear any reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (error) {
        console.error('[WebSocketChat] Failed to parse message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[WebSocketChat] Error:', error);
      onError?.('WebSocket connection error');
    };

    ws.onclose = (event) => {
      console.log('[WebSocketChat] Closed:', event.code, event.reason);
      setStatus('disconnected');
      wsRef.current = null;

      // Auto-reconnect after 3 seconds if not intentionally closed
      if (event.code !== 1000) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[WebSocketChat] Attempting reconnect...');
          connect();
        }, 3000);
      }
    };
  }, [getWebSocketUrl, onError]);

  // Handle incoming WebSocket messages
  const handleWebSocketMessage = useCallback((data: any) => {
    switch (data.type) {
      case 'connected':
        console.log('[WebSocketChat] Server ready');
        break;

      case 'start':
        console.log('[WebSocketChat] Stream started for chat:', data.chatId);
        setStatus('streaming');
        break;

      case 'message_start':
        console.log('[WebSocketChat] Message started:', data.messageId);
        setCurrentMessageId(data.messageId);
        setCurrentText('');
        break;

      case 'text_delta':
        setCurrentText((prev) => prev + data.delta);
        onTextDelta?.(data.delta, data.messageId);
        break;

      case 'message_end':
        console.log('[WebSocketChat] Message ended:', data.messageId, data.finishReason);
        break;

      case 'done':
        console.log('[WebSocketChat] Stream done:', data.messageId);
        setStatus('connected');

        // Create final message object
        if (currentText || data.messageId) {
          const finalMessage: ChatMessage = {
            id: data.messageId,
            role: 'assistant',
            parts: currentText ? [{ type: 'text', text: currentText }] : [],
            createdAt: new Date(),
            attachments: [],
          };
          onMessage?.(finalMessage);
        }

        onDone?.({
          messageId: data.messageId,
          finishReason: data.finishReason,
        });

        setCurrentMessageId(null);
        break;

      case 'warning':
        console.warn('[WebSocketChat] Warning:', data.message);
        break;

      case 'error':
        console.error('[WebSocketChat] Error:', data.error);
        setStatus('connected');
        onError?.(data.error);
        break;

      default:
        console.log('[WebSocketChat] Unknown message type:', data.type);
    }
  }, [currentText, onMessage, onTextDelta, onDone, onError]);

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

    setStatus('disconnected');
  }, []);

  // Send chat message
  const sendMessage = useCallback((messages: ChatMessage[], model: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      onError?.('WebSocket not connected');
      return;
    }

    const payload = {
      type: 'chat',
      chatId,
      messages,
      selectedChatModel: model,
    };

    console.log('[WebSocketChat] Sending chat message:', {
      chatId,
      messageCount: messages.length,
      model,
    });

    wsRef.current.send(JSON.stringify(payload));
  }, [chatId, onError]);

  // Auto-connect on mount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, []);

  // Reconnect when chatId changes
  useEffect(() => {
    if (status === 'connected' && wsRef.current) {
      // Already connected, no need to reconnect
    }
  }, [chatId, status]);

  return {
    status,
    connect,
    disconnect,
    sendMessage,
    isConnected: status === 'connected' || status === 'streaming',
    isStreaming: status === 'streaming',
    currentMessageId,
    currentText,
  };
}
