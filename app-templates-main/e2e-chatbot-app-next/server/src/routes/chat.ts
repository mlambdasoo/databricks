import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import {
  convertToModelMessages,
  createUIMessageStream,
  streamText,
  generateText,
  type LanguageModelUsage,
  pipeUIMessageStreamToResponse,
} from 'ai';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';

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
            console.log(`[Chat] Filtering incomplete tool call: ${toolName} (${toolCallId})`);
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
      console.log(`[Chat] All parts filtered from message ${message.id}, adding placeholder`);
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

import {
  authMiddleware,
  requireAuth,
  requireChatAccess,
  getIdFromRequest,
} from '../middleware/auth';
import {
  deleteChatById,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatLastContextById,
  updateChatVisiblityById,
  isDatabaseAvailable,
} from '@chat-template/db';
import {
  type ChatMessage,
  checkChatAccess,
  convertToUIMessages,
  generateUUID,
  myProvider,
  postRequestBodySchema,
  type PostRequestBody,
  StreamCache,
  type VisibilityType,
  CONTEXT_HEADER_CONVERSATION_ID,
  CONTEXT_HEADER_USER_ID,
  truncateMessages,
} from '@chat-template/core';
import { ChatSDKError } from '@chat-template/core/errors';
import { setRequestContext } from '@chat-template/ai-sdk-providers';

export const chatRouter: RouterType = Router();

// Streaming configuration to prevent connection issues
const STREAM_CONFIG = {
  MAX_RESPONSE_SIZE: Number.parseInt(process.env.MAX_RESPONSE_SIZE || '50000', 10), // 50K chars per message
  MAX_MESSAGE_CHUNKS: Number.parseInt(process.env.MAX_MESSAGE_CHUNKS || '5', 10), // Max messages to split into
  STREAM_TIMEOUT_MS: Number.parseInt(process.env.STREAM_TIMEOUT_MS || '300000', 10), // 5 minutes default
};

const streamCache = new StreamCache();
// Apply auth middleware to all chat routes
chatRouter.use(authMiddleware);

/**
 * POST /api/chat - Send a message and get streaming response
 *
 * Note: Works in ephemeral mode when database is disabled.
 * Streaming continues normally, but no chat/message persistence occurs.
 */
chatRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const dbAvailable = isDatabaseAvailable();
  if (!dbAvailable) {
    console.log('[Chat] Running in ephemeral mode - no persistence');
  }

  console.log(`CHAT POST REQUEST ${Date.now()}`);

  let requestBody: PostRequestBody;

  try {
    requestBody = postRequestBodySchema.parse(req.body);
  } catch (_) {
    console.error('Error parsing request body:', _);
    const error = new ChatSDKError('bad_request:api');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message?: ChatMessage;
      selectedChatModel: string;
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = req.session;
    if (!session) {
      const error = new ChatSDKError('unauthorized:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    const { chat, allowed, reason } = await checkChatAccess(
      id,
      session?.user.id,
    );

    if (reason !== 'not_found' && !allowed) {
      const error = new ChatSDKError('forbidden:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    if (!chat) {
      // Only create new chat if we have a message (not a continuation)
      if (isDatabaseAvailable() && message) {
        const title = await generateTitleFromUserMessage({ message });

        await saveChat({
          id,
          userId: session.user.id,
          title,
          visibility: selectedVisibilityType,
        });
      }
    } else {
      if (chat.userId !== session.user.id) {
        const error = new ChatSDKError('forbidden:chat');
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
    }

    const messagesFromDb = await getMessagesByChatId({ id });

    // Use previousMessages from request body when:
    // 1. Ephemeral mode (DB not available) - always use client-side messages
    // 2. Continuation request (no message) - tool results only exist client-side
    const useClientMessages =
      !dbAvailable || (!message && requestBody.previousMessages);
    const previousMessages = useClientMessages
      ? (requestBody.previousMessages ?? [])
      : convertToUIMessages(messagesFromDb);

    // If message is provided, add it to the list and save it
    // If not (continuation/regeneration), just use previous messages
    let uiMessages: ChatMessage[];
    if (message) {
      uiMessages = [...previousMessages, message];
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: 'user',
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    } else {
      // Continuation: use existing messages without adding new user message
      uiMessages = previousMessages as ChatMessage[];

      // For continuations with database enabled, save any updated assistant messages
      // This ensures tool-result parts (like MCP approval responses) are persisted
      if (dbAvailable && requestBody.previousMessages) {
        const assistantMessages = requestBody.previousMessages.filter(
          (m: ChatMessage) => m.role === 'assistant',
        );
        if (assistantMessages.length > 0) {
          await saveMessages({
            messages: assistantMessages.map((m: ChatMessage) => ({
              chatId: id,
              id: m.id,
              role: m.role,
              parts: m.parts,
              attachments: [],
              createdAt: m.metadata?.createdAt
                ? new Date(m.metadata.createdAt)
                : new Date(),
            })),
          });

          // Check if this is an MCP denial - if so, we're done (no need to call LLM)
          // Denial is indicated by a dynamic-tool part with state 'output-denied'
          // or with approval.approved === false
          const hasMcpDenial = requestBody.previousMessages?.some(
            (m: ChatMessage) =>
              m.parts?.some(
                (p) =>
                  p.type === 'dynamic-tool' &&
                  (p.state === 'output-denied' ||
                    ('approval' in p &&
                      (p.approval)?.approved ===
                        false)),
              ),
          );

          if (hasMcpDenial) {
            // We don't need to call the LLM because the user has denied the tool call
            res.end();
            return;
          }
        }
      }
    }

    // Clear any previous active stream for this chat
    streamCache.clearActiveStream(id);

    // Track client disconnection for debugging
    let _clientDisconnected = false;
    req.on('close', () => {
      if (!res.writableEnded) {
        _clientDisconnected = true;
        console.warn(`[Client Disconnect] Client closed connection for chat ${id} before stream completed`);
      }
    });

    // Set request context with user's access token for OBO operations
    if (req.userAccessToken) {
      setRequestContext({
        userAccessToken: req.userAccessToken,
        userEmail: req.userEmail,
      });
      console.log('[OBO] Request context set for serving endpoint calls');
    }

    let finalUsage: LanguageModelUsage | undefined;
    const streamId = generateUUID();

    // Filter out incomplete tool calls (those without results) to prevent MissingToolResultsError
    const messagesWithCompleteTools = filterIncompleteToolCalls(uiMessages);

    // Truncate messages to prevent exceeding 4MB API request limit
    // Keeps the most recent 20 messages by default
    const truncatedMessages = truncateMessages(messagesWithCompleteTools);

    const model = await myProvider.languageModel(selectedChatModel);
    let finishReason: string | undefined;

    const result = streamText({
      model,
      messages: await convertToModelMessages(truncatedMessages),
      headers: {
        [CONTEXT_HEADER_CONVERSATION_ID]: id,
        [CONTEXT_HEADER_USER_ID]: session.user.email ?? session.user.id,
      },
      onFinish: ({ usage, finishReason: reason }) => {
        finalUsage = usage;
        finishReason = reason;
      },
    });

    /**
     * We manually create the stream to have access to the stream writer.
     * This allows us to inject custom stream parts like data-error.
     */
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Stream the response
        writer.merge(
          result.toUIMessageStream({
            originalMessages: uiMessages,
            generateMessageId: generateUUID,
            sendReasoning: true,
            sendSources: true,
            onError: (error) => {
              console.error('Stream error:', error);

              const errorMessage =
                error instanceof Error ? error.message : JSON.stringify(error);

              writer.write({ type: 'data-error', data: errorMessage });

              return errorMessage;
            },
          }),
        );

        // Wait for streaming to complete and get finish reason directly from result
        const [, streamFinishReason] = await Promise.all([
          result.usage,
          result.finishReason,
        ]);

        // Update finishReason for logging (use directly awaited value if callback didn't set it)
        if (!finishReason) {
          finishReason = streamFinishReason;
        }

        // Log finish reason
        console.log(`[Stream] Finished with reason: ${finishReason || 'unknown'}`);

        // If response was truncated due to token limit, notify the client
        if (finishReason === 'length') {
          console.warn('[Token Limit] Response was truncated due to output token limit');
          // Send error to client so they know to continue
          writer.write({
            type: 'data-error',
            data: '⚠️ Response truncated - output limit reached. Send "continue" to get more.',
          });
        }
      },
      onFinish: async ({ responseMessage }) => {
        console.log(
          'Finished message stream! Saving message...',
          `ID: ${responseMessage.id}, Parts: ${responseMessage.parts.length}, Role: ${responseMessage.role}, Finish: ${finishReason || 'unknown'}`,
        );

        // Log token usage
        if (finalUsage) {
          console.log(`[Tokens] Input: ${finalUsage.inputTokens}, Output: ${finalUsage.outputTokens}, Finish: ${finishReason}`);
        }

        // Size monitoring at save time (post-facto)
        const totalSize = responseMessage.parts
          .filter(p => p.type === 'text')
          .reduce((sum, p) => sum + (p.text?.length || 0), 0);

        if (totalSize > STREAM_CONFIG.MAX_RESPONSE_SIZE) {
          console.warn(`[Size Warning] Response ${responseMessage.id} is ${Math.floor(totalSize / 1000)}K chars (limit: ${Math.floor(STREAM_CONFIG.MAX_RESPONSE_SIZE / 1000)}K)`);
        }

        // Validate parts before saving
        if (responseMessage.parts.length === 0) {
          console.error('[CRITICAL] responseMessage has no parts! This will cause database save to fail.');
          console.error('Message details:', JSON.stringify(responseMessage, null, 2));
          throw new Error('Cannot save message with empty parts array');
        }

        await saveMessages({
          messages: [
            {
              id: responseMessage.id,
              role: responseMessage.role,
              parts: responseMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            },
          ],
        });

        if (finalUsage) {
          try {
            await updateChatLastContextById({
              chatId: id,
              context: toV3Usage(finalUsage),
            });
          } catch (err) {
            console.warn('Unable to persist last usage for chat', id, err);
          }
        }

        streamCache.clearActiveStream(id);
      },
    });

    pipeUIMessageStreamToResponse({
      stream,
      response: res,
      consumeSseStream({ stream }) {
        streamCache.storeStream({
          streamId,
          chatId: id,
          stream,
        });
      },
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    console.error('Unhandled error in chat API:', error);

    const chatError = new ChatSDKError('offline:chat');
    const response = chatError.toResponse();
    return res.status(response.status).json(response.json);
  }
});

/**
 * DELETE /api/chat?id=:id - Delete a chat
 */
chatRouter.delete(
  '/:id',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    const id = getIdFromRequest(req);
    if (!id) return;

    const deletedChat = await deleteChatById({ id });
    return res.status(200).json(deletedChat);
  },
);

/**
 * GET /api/chat/:id
 */

chatRouter.get(
  '/:id',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    const id = getIdFromRequest(req);
    if (!id) return;

    const { chat } = await checkChatAccess(id, req.session?.user.id);

    return res.status(200).json(chat);
  },
);

/**
 * GET /api/chat/:id/stream - Resume a stream
 */
chatRouter.get(
  '/:id/stream',
  [requireAuth],
  async (req: Request, res: Response) => {
    const chatId = getIdFromRequest(req);
    if (!chatId) return;
    const cursor = req.headers['x-resume-stream-cursor'] as string;

    console.log(`[Stream Resume] Cursor: ${cursor}`);

    console.log(`[Stream Resume] GET request for chat ${chatId}`);

    // Check if there's an active stream for this chat first
    const streamId = streamCache.getActiveStreamId(chatId);

    if (!streamId) {
      console.log(`[Stream Resume] No active stream for chat ${chatId}`);
      const streamError = new ChatSDKError('empty:stream');
      const response = streamError.toResponse();
      return res.status(response.status).json(response.json);
    }

    const { allowed, reason } = await checkChatAccess(
      chatId,
      req.session?.user.id,
    );

    // If chat doesn't exist in DB, it's a temporary chat from the homepage - allow it
    if (reason === 'not_found') {
      console.log(
        `[Stream Resume] Resuming stream for temporary chat ${chatId} (not yet in DB)`,
      );
    } else if (!allowed) {
      console.log(
        `[Stream Resume] User ${req.session?.user.id} does not have access to chat ${chatId} (reason: ${reason})`,
      );
      const streamError = new ChatSDKError('forbidden:chat', reason);
      const response = streamError.toResponse();
      return res.status(response.status).json(response.json);
    }

    // Get all cached chunks for this stream
    const stream = streamCache.getStream(streamId, {
      cursor: cursor ? Number.parseInt(cursor) : undefined,
    });

    if (!stream) {
      console.log(`[Stream Resume] No stream found for ${streamId}`);
      const streamError = new ChatSDKError('empty:stream');
      const response = streamError.toResponse();
      return res.status(response.status).json(response.json);
    }

    console.log(`[Stream Resume] Resuming stream ${streamId}`);

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Pipe the cached stream directly to the response
    stream.pipe(res);

    // Handle stream errors
    stream.on('error', (error) => {
      console.error('[Stream Resume] Stream error:', error);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });
  },
);

/**
 * POST /api/chat/title - Generate title from message
 */
chatRouter.post('/title', requireAuth, async (req: Request, res: Response) => {
  try {
    // Set request context with user's access token for OBO operations
    if (req.userAccessToken) {
      setRequestContext({
        userAccessToken: req.userAccessToken,
        userEmail: req.userEmail,
      });
    }

    const { message } = req.body;
    const title = await generateTitleFromUserMessage({ message });
    res.json({ title });
  } catch (error) {
    console.error('Error generating title:', error);
    res.status(500).json({ error: 'Failed to generate title' });
  }
});

/**
 * PATCH /api/chat/:id/visibility - Update chat visibility
 */
chatRouter.patch(
  '/:id/visibility',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    try {
      const id = getIdFromRequest(req);
      if (!id) return;
      const { visibility } = req.body;

      if (!visibility || !['public', 'private'].includes(visibility)) {
        return res.status(400).json({ error: 'Invalid visibility type' });
      }

      await updateChatVisiblityById({ chatId: id, visibility });
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating visibility:', error);
      res.status(500).json({ error: 'Failed to update visibility' });
    }
  },
);

// Helper function to generate title from user message
async function generateTitleFromUserMessage({
  message,
}: {
  message: ChatMessage;
}) {
  const model = await myProvider.languageModel('title-model');
  const { text: title } = await generateText({
    model,
    system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons. do not include other expository content ("I'll help...")`,
    prompt: JSON.stringify(message),
  });

  return title;
}
