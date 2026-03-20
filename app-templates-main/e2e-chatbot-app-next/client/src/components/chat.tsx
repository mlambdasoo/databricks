import type { DataUIPart, LanguageModelUsage, UIMessageChunk } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { ChatHeader } from '@/components/chat-header';
import { fetchWithErrorHandlers, generateUUID } from '@/lib/utils';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type {
  Attachment,
  ChatMessage,
  CustomUIDataTypes,
  VisibilityType,
} from '@chat-template/core';
import { unstable_serialize } from 'swr/infinite';
import { getChatHistoryPaginationKey } from './sidebar-history';
import { toast } from './toast';
import { useSearchParams } from 'react-router-dom';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { ChatSDKError } from '@chat-template/core/errors';
import { useDataStream } from './data-stream-provider';
import { isCredentialErrorMessage } from '@/lib/oauth-error-utils';
import { ChatTransport } from '../lib/ChatTransport';
import type { ClientSession } from '@chat-template/auth';
import { softNavigateToChatId } from '@/lib/navigation';
import { useAppConfig } from '@/contexts/AppConfigContext';

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  initialLastContext,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: ClientSession;
  initialLastContext?: LanguageModelUsage;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  const { setDataStream } = useDataStream();
  const { chatHistoryEnabled } = useAppConfig();

  const [input, setInput] = useState<string>('');
  const [_usage, setUsage] = useState<LanguageModelUsage | undefined>(
    initialLastContext,
  );

  const [streamCursor, setStreamCursor] = useState(0);
  const streamCursorRef = useRef(streamCursor);
  streamCursorRef.current = streamCursor;
  const [lastPart, setLastPart] = useState<UIMessageChunk | undefined>();
  const lastPartRef = useRef<UIMessageChunk | undefined>(lastPart);
  lastPartRef.current = lastPart;

  // Auto-retry logic (retry from beginning, not resume from middle)
  const retryCountRef = useRef(0);
  const maxRetries = 2; // Will try up to 3 times total (initial + 2 retries)
  const lastMessageIdRef = useRef<string | null>(null);

  const abortController = useRef<AbortController | null>(new AbortController());
  useEffect(() => {
    return () => {
      abortController.current?.abort('ABORT_SIGNAL');
    };
  }, []);

  const fetchWithAbort = useMemo(() => {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      // useChat does not cancel /stream requests when the component is unmounted
      const signal = abortController.current?.signal;
      return fetchWithErrorHandlers(input, { ...init, signal });
    };
  }, []);

  const stop = useCallback(() => {
    abortController.current?.abort('USER_ABORT_SIGNAL');
  }, []);

  const isNewChat = initialMessages.length === 0;
  const didFetchHistoryOnNewChat = useRef(false);
  const fetchChatHistory = useCallback(() => {
    mutate(unstable_serialize(getChatHistoryPaginationKey));
  }, [mutate]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    resumeStream,
    clearError,
    addToolApprovalResponse,
    regenerate,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    // DISABLED: resume feature causes "Cannot read properties of undefined (reading 'state')" errors
    // resume: id !== undefined && initialMessages.length > 0,
    transport: new ChatTransport({
      onStreamPart: (part) => {
        console.log('[ChatTransport] Stream part received:', part.type, part);
        // As soon as we recive a stream part, we fetch the chat history again for new chats
        if (isNewChat && !didFetchHistoryOnNewChat.current) {
          fetchChatHistory();
          didFetchHistoryOnNewChat.current = true;
        }
        // Keep track of the number of stream parts received
        setStreamCursor((cursor) => {
          console.log('[ChatTransport] Stream cursor:', cursor, '->', cursor + 1);
          return cursor + 1;
        });
        setLastPart(part);
      },
      api: '/api/chat',
      fetch: fetchWithAbort,
      prepareSendMessagesRequest({ messages, id, body }) {
        const lastMessage = messages.at(-1);
        const isUserMessage = lastMessage?.role === 'user';

        // For continuations (non-user messages like tool results), we must always
        // send previousMessages because the tool result only exists client-side
        // and hasn't been saved to the database yet.
        const needsPreviousMessages = !chatHistoryEnabled || !isUserMessage;

        return {
          body: {
            id,
            // Only include message field for user messages (new messages)
            // For continuation (assistant messages with tool results), omit message field
            ...(isUserMessage ? { message: lastMessage } : {}),
            selectedChatModel: initialChatModel,
            selectedVisibilityType: visibilityType,
            nextMessageId: generateUUID(),
            // Send previous messages when:
            // 1. Database is disabled (ephemeral mode) - always need client-side messages
            // 2. Continuation request (tool results) - tool result only exists client-side
            ...(needsPreviousMessages
              ? {
                  previousMessages: isUserMessage
                    ? messages.slice(0, -1)
                    : messages,
                }
              : {}),
            ...body,
          },
        };
      },
      prepareReconnectToStreamRequest({ id }) {
        return {
          api: `/api/chat/${id}/stream`,
          credentials: 'include',
          headers: {
            // Pass the cursor to the server so it can resume the stream from the correct point
            'X-Resume-Stream-Cursor': streamCursorRef.current.toString(),
          },
        };
      },
    }),
    onData: (dataPart) => {
      console.log('[useChat] onData called:', dataPart.type, dataPart);
      setDataStream((ds) => {
        console.log('[useChat] setDataStream - current length:', ds?.length || 0);
        return [...(ds || []), dataPart as DataUIPart<CustomUIDataTypes>];
      });
      if (dataPart.type === 'data-usage') {
        setUsage(dataPart.data as LanguageModelUsage);
      }
    },
    onFinish: ({
      isAbort,
      isDisconnect,
      isError,
      messages: finishedMessages,
    }) => {
      console.log('[useChat] onFinish called:', { isAbort, isDisconnect, isError, messageCount: finishedMessages?.length });
      // Reset state for next message
      didFetchHistoryOnNewChat.current = false;

      // If user aborted, don't try to resume
      if (isAbort) {
        console.log('[Chat onFinish] Stream was aborted by user, not resuming');
        setStreamCursor(0);
        fetchChatHistory();
        return;
      }

      // Check if the last message contains an OAuth credential error
      // If so, don't try to resume - the user needs to authenticate first
      const lastMessage = finishedMessages?.at(-1);
      const hasOAuthError = lastMessage?.parts?.some(
        (part) =>
          part.type === 'data-error' &&
          typeof part.data === 'string' &&
          isCredentialErrorMessage(part.data),
      );

      if (hasOAuthError) {
        console.log(
          '[Chat onFinish] OAuth credential error detected, not resuming',
        );
        setStreamCursor(0);
        fetchChatHistory();
        clearError();
        return;
      }

      // Check if stream was incomplete
      const streamIncomplete = lastPartRef.current?.type !== 'finish';

      // Don't consider it "interrupted" if we received substantial content
      // (likely hit token limit, not actual interruption)
      const SUBSTANTIAL_CONTENT_THRESHOLD = 50; // More than 50 parts = substantial response
      const hasSubstantialContent = streamCursorRef.current > SUBSTANTIAL_CONTENT_THRESHOLD;
      const wasInterrupted = (isDisconnect || isError) && streamIncomplete && !hasSubstantialContent;

      console.log('[Chat onFinish] Stream ended:', {
        isComplete: !streamIncomplete,
        isDisconnect,
        isError,
        receivedParts: streamCursorRef.current,
        hasSubstantialContent,
        wasInterrupted,
      });

      // AUTO-RETRY: If stream was interrupted and we haven't exceeded retry limit
      // Skip retry if we received substantial content (likely token limit, not interruption)
      if (wasInterrupted && retryCountRef.current < maxRetries) {
        const currentMessageId = finishedMessages?.[finishedMessages.length - 1]?.id;
        const isSameMessage = currentMessageId === lastMessageIdRef.current;

        // Only retry if it's the same message (prevent retry loops)
        if (isSameMessage || lastMessageIdRef.current === null) {
          retryCountRef.current++;
          lastMessageIdRef.current = currentMessageId || null;

          console.log('[Chat onFinish] Auto-retrying...', {
            attempt: retryCountRef.current + 1,
            maxRetries: maxRetries + 1,
          });

          toast({
            type: 'info',
            description: `Connection interrupted. Retrying automatically... (Attempt ${retryCountRef.current + 1}/${maxRetries + 1})`,
          });

          // Wait a bit before retrying (exponential backoff)
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 5000);
          setTimeout(() => {
            // Retry by regenerating the last message
            if (finishedMessages && finishedMessages.length > 0) {
              regenerate({ message: finishedMessages[finishedMessages.length - 1] });
            }
          }, delay);
          return;
        }
      }

      // Reset retry counter for next message
      retryCountRef.current = 0;
      lastMessageIdRef.current = null;

      // Complete gracefully - show what we have
      setStreamCursor(0);
      fetchChatHistory();

      // If we exhausted retries, show a final message
      if (wasInterrupted && retryCountRef.current >= maxRetries) {
        toast({
          type: 'warning',
          description: 'Response was interrupted after multiple retries. Showing partial results. You can try again manually.',
        });
      }
    },
    onError: (error) => {
      console.log('[Chat onError] Error occurred:', error);

      // Only show toast for explicit ChatSDKError (backend validation errors)
      // Other errors (network, schema validation) are handled silently or in message parts
      if (error instanceof ChatSDKError) {
        toast({
          type: 'error',
          description: error.message,
        });
      } else {
        // Non-ChatSDKError: Could be network error or in-stream error
        // Log but don't toast - errors during streaming may be informational
        console.warn('[Chat onError] Error during streaming:', error.message);
      }
      // Note: We don't call resumeStream here because onError can be called
      // while the stream is still active (e.g., for data-error parts).
      // Resume logic is handled exclusively in onFinish.
    },
  });

  const [searchParams] = useSearchParams();
  const query = searchParams.get('query');

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: 'user' as const,
        parts: [{ type: 'text', text: query }],
      });

      setHasAppendedQuery(true);
      softNavigateToChatId(id, chatHistoryEnabled);
    }
  }, [query, sendMessage, hasAppendedQuery, id, chatHistoryEnabled]);

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);

  return (
    <>
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader />

        <Messages
          chatId={id}
          status={status}
          messages={messages}
          setMessages={setMessages}
          addToolApprovalResponse={addToolApprovalResponse}
          regenerate={regenerate}
          sendMessage={sendMessage}
          isReadonly={isReadonly}
          selectedModelId={initialChatModel}
        />

        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          {!isReadonly && (
            <MultimodalInput
              chatId={id}
              input={input}
              setInput={setInput}
              status={status}
              stop={stop}
              attachments={attachments}
              setAttachments={setAttachments}
              messages={messages}
              setMessages={setMessages}
              sendMessage={sendMessage}
              selectedVisibilityType={visibilityType}
            />
          )}
        </div>
      </div>
    </>
  );
}
