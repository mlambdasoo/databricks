import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage } from '@chat-template/core';
import { generateUUID } from '@/lib/utils';

interface MessagePart {
  type: string;
  [key: string]: any;
}

interface JobStatus {
  jobId: string;
  chatId: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  messageId: string | null;
  partialText: string;
  parts: MessagePart[];
  partsReceived: number;
  finishReason: string | null;
  error: string | null;
  updatedAt: string;
}

interface UseAsyncChatOptions {
  chatId: string;
  initialMessages: ChatMessage[];
  selectedChatModel: string;
  selectedVisibilityType?: 'private' | 'public';
  onFinish?: (message: ChatMessage) => void;
  onError?: (error: Error) => void;
  pollingInterval?: number;
}

type ChatStatus = 'idle' | 'starting' | 'streaming' | 'error';

/**
 * Async polling-based chat hook
 * Starts a background job and polls for results
 */
export function useAsyncChat(options: UseAsyncChatOptions) {
  const {
    chatId,
    initialMessages,
    selectedChatModel,
    selectedVisibilityType = 'private',
    onFinish,
    onError,
    pollingInterval = 500, // Poll every 500ms - client-side typewriter handles smooth appearance
  } = options;

  // Ensure initialMessages is always an array
  const safeInitialMessages = initialMessages ?? [];
  const [messages, setMessages] = useState<ChatMessage[]>(safeInitialMessages);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [partialText, setPartialText] = useState<string>('');

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const lastPartsReceivedRef = useRef<number>(0);
  const lastUpdateTimeRef = useRef<number>(Date.now());
  const STALE_JOB_TIMEOUT_MS = 120000; // 2 minutes without updates = stale

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Poll for job status
  const pollJobStatus = useCallback(async (jobId: string): Promise<JobStatus | null> => {
    try {
      const response = await fetch(`/api/chat-async/job/${jobId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.warn('[AsyncChat] Job not found:', jobId);
          return null;
        }
        throw new Error(`Failed to poll job: ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      console.error('[AsyncChat] Poll error:', err);
      return null;
    }
  }, []);

  // Start polling for a job
  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    lastPartsReceivedRef.current = 0;
    lastUpdateTimeRef.current = Date.now();

    console.log('[AsyncChat] Starting polling for job:', jobId);

    pollingRef.current = setInterval(async () => {
      const jobStatus = await pollJobStatus(jobId);

      if (!jobStatus) {
        // Check for stale job (no response for too long)
        const timeSinceLastUpdate = Date.now() - lastUpdateTimeRef.current;
        if (timeSinceLastUpdate > STALE_JOB_TIMEOUT_MS) {
          console.error('[AsyncChat] Job appears stale, stopping polling:', jobId);
          stopPolling();
          setStatus('idle'); // Reset to idle so user can send new messages
          setCurrentJobId(null);
          const err = new Error('Request timed out. Please try again.');
          setError(err);

          // Keep any streamed content and append timeout notice
          setMessages(prev => {
            const lastIdx = prev.length - 1;
            if (lastIdx >= 0 && prev[lastIdx].role === 'assistant') {
              const msg = prev[lastIdx];
              const hasContent = msg.parts && msg.parts.length > 0;
              if (hasContent) {
                // Keep content, add timeout notice, finalize
                const updated = [...prev];
                updated[lastIdx] = {
                  ...msg,
                  id: msg.id.replace('-streaming', '-timeout'),
                  parts: [
                    ...msg.parts,
                    { type: 'text', text: '\n\n---\n\n⚠️ *응답 시간이 초과되었습니다. **"계속"**이라고 입력하면 이어서 답변을 받을 수 있고, 새로운 질문을 입력할 수도 있습니다.*' },
                  ],
                };
                return updated;
              }
              // Empty placeholder — remove it
              return prev.slice(0, lastIdx);
            }
            return prev;
          });

          onError?.(err);
        }
        return;
      }

      // Update last update time
      lastUpdateTimeRef.current = Date.now();

      // Update message parts if new content
      if (jobStatus.partsReceived > lastPartsReceivedRef.current) {
        lastPartsReceivedRef.current = jobStatus.partsReceived;
        setPartialText(jobStatus.partialText);

        // Use parts array if available, fallback to partialText
        const streamingParts = jobStatus.parts?.length > 0
          ? jobStatus.parts
          : jobStatus.partialText
            ? [{ type: 'text', text: jobStatus.partialText }]
            : [];

        // Update streaming message in messages array
        setMessages(prev => {
          const lastIdx = prev.length - 1;
          if (lastIdx >= 0 && prev[lastIdx].role === 'assistant' && !prev[lastIdx].id.includes('-final')) {
            const updated = [...prev];
            updated[lastIdx] = {
              ...updated[lastIdx],
              parts: streamingParts,
            };
            return updated;
          }
          return prev;
        });
      }

      // Check for completion
      if (jobStatus.status === 'completed') {
        console.log('[AsyncChat] Job completed:', jobId);
        stopPolling();
        setStatus('idle');
        setCurrentJobId(null);

        // Use parts array if available, fallback to partialText
        const finalParts = jobStatus.parts?.length > 0
          ? jobStatus.parts
          : jobStatus.partialText
            ? [{ type: 'text', text: jobStatus.partialText }]
            : [];

        // Finalize the message with all parts (text, tool calls, tool results, etc.)
        const finalMessage: ChatMessage = {
          id: jobStatus.messageId || generateUUID(),
          role: 'assistant',
          parts: finalParts,
          createdAt: new Date(),
          attachments: [],
        };

        setMessages(prev => {
          // Replace the streaming message with final
          const lastIdx = prev.length - 1;
          if (lastIdx >= 0 && prev[lastIdx].role === 'assistant') {
            const updated = [...prev];
            updated[lastIdx] = finalMessage;
            return updated;
          }
          return prev;
        });

        onFinish?.(finalMessage);
      }

      // Check for error
      if (jobStatus.status === 'error') {
        console.error('[AsyncChat] Job failed:', jobStatus.error);
        stopPolling();
        setStatus('idle'); // Reset to idle so user can send new messages
        setCurrentJobId(null);

        const err = new Error(jobStatus.error || 'Chat failed');
        setError(err);

        // Remove streaming placeholder message on error
        setMessages(prev => {
          const lastIdx = prev.length - 1;
          if (lastIdx >= 0 && prev[lastIdx].role === 'assistant' && prev[lastIdx].id.includes('-streaming')) {
            return prev.slice(0, lastIdx);
          }
          return prev;
        });

        onError?.(err);
      }
    }, pollingInterval);
  }, [pollJobStatus, pollingInterval, stopPolling, onFinish, onError]);

  // Send a message (starts async job)
  const sendMessage = useCallback(async (content: string, attachments: any[] = []) => {
    setError(null);
    setStatus('starting');
    setPartialText('');

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

    // Create placeholder for assistant message
    const placeholderMessage: ChatMessage = {
      id: `${generateUUID()}-streaming`,
      role: 'assistant',
      parts: [],
      createdAt: new Date(),
      attachments: [],
    };

    // Add messages to state
    const updatedMessages = [...messages, userMessage];
    setMessages([...updatedMessages, placeholderMessage]);

    try {
      // Start async job
      const response = await fetch('/api/chat-async/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          id: chatId,
          messages: updatedMessages,
          selectedChatModel,
          selectedVisibilityType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to start chat: ${response.status}`);
      }

      const { jobId } = await response.json();
      console.log('[AsyncChat] Job started:', jobId);

      setCurrentJobId(jobId);
      setStatus('streaming');

      // Start polling
      startPolling(jobId);

    } catch (err) {
      console.error('[AsyncChat] Failed to start job:', err);
      setStatus('error');
      const error = err instanceof Error ? err : new Error('Failed to start chat');
      setError(error);
      onError?.(error);

      // Remove placeholder message
      setMessages(updatedMessages);
    }
  }, [chatId, messages, selectedChatModel, selectedVisibilityType, startPolling, onError]);

  // Stop/cancel current job
  const stop = useCallback(async () => {
    stopPolling();

    // Cancel job on server
    if (currentJobId) {
      try {
        await fetch(`/api/chat-async/job/${currentJobId}/cancel`, {
          method: 'POST',
          credentials: 'include',
        });
        console.log('[AsyncChat] Cancelled job:', currentJobId);
      } catch (err) {
        console.warn('[AsyncChat] Failed to cancel job on server:', err);
      }
    }

    setStatus('idle');
    setCurrentJobId(null);

    // Keep streamed content but finalize the message (remove -streaming suffix)
    setMessages(prev => {
      const lastIdx = prev.length - 1;
      if (lastIdx >= 0 && prev[lastIdx].role === 'assistant' && prev[lastIdx].id.includes('-streaming')) {
        const streamingMsg = prev[lastIdx];
        // If there's actual content, keep it; otherwise remove the empty placeholder
        if (streamingMsg.parts && streamingMsg.parts.length > 0) {
          const updated = [...prev];
          updated[lastIdx] = {
            ...streamingMsg,
            id: streamingMsg.id.replace('-streaming', '-stopped'),
          };
          return updated;
        }
        return prev.slice(0, lastIdx);
      }
      return prev;
    });
  }, [stopPolling, currentJobId]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
    setStatus('idle');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Update messages when initialMessages change (only on actual content change)
  const initialMessagesRef = useRef<string>('');
  useEffect(() => {
    const key = JSON.stringify(safeInitialMessages.map(m => m.id));
    if (key !== initialMessagesRef.current) {
      initialMessagesRef.current = key;
      // Only reset if we're not currently streaming (avoid interrupting active conversations)
      if (status === 'idle') {
        setMessages(safeInitialMessages);
      }
    }
  }, [safeInitialMessages, status]);

  return {
    messages,
    setMessages,
    status,
    isLoading: status === 'starting' || status === 'streaming',
    error,
    sendMessage,
    stop,
    clearError,
    currentJobId,
    partialText,
  };
}
