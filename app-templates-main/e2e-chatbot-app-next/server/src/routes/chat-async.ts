/**
 * Async chat routes for polling-based chat
 * Bypasses proxy timeout by returning immediately and processing in background
 */

import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import {
  streamText,
  convertToModelMessages,
  generateText,
  type LanguageModelUsage,
} from 'ai';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import {
  authMiddleware,
  requireAuth,
} from '../middleware/auth';
import {
  saveChat,
  saveMessages,
  updateChatLastContextById,
  isDatabaseAvailable,
} from '@chat-template/db';
import {
  type ChatMessage,
  type VisibilityType,
  checkChatAccess,
  generateUUID,
  myProvider,
  truncateMessages,
} from '@chat-template/core';
import { ChatSDKError } from '@chat-template/core/errors';
import { setRequestContext } from '@chat-template/ai-sdk-providers';
import {
  CONTEXT_HEADER_CONVERSATION_ID,
  CONTEXT_HEADER_USER_ID,
} from '@chat-template/ai-sdk-providers';
import {
  createJob,
  getJob,
  updateJobStatus,
  appendJobText,
  addJobPart,
  updateJobPart,
  setJobParts,
  completeJob,
  failJob,
  type JobMessagePart,
} from '../jobs/job-store';

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
            console.log(`[AsyncChat] Filtering incomplete tool call: ${toolName} (${toolCallId})`);
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
      console.log(`[AsyncChat] All parts filtered from message ${message.id}, adding placeholder`);
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

export const chatAsyncRouter: RouterType = Router();

// Apply auth middleware to all routes
chatAsyncRouter.use(authMiddleware);

/**
 * POST /api/chat-async/start
 * Start an async chat job - returns immediately with jobId
 */
chatAsyncRouter.post(
  '/start',
  requireAuth,
  async (req: Request, res: Response) => {
    const dbAvailable = isDatabaseAvailable();
    if (!dbAvailable) {
      console.log('[AsyncChat] Running in ephemeral mode - no persistence');
    }

    const {
      id: chatId,
      messages,
      selectedChatModel,
      selectedVisibilityType = 'private',
    } = req.body;

    if (!chatId || !messages || !selectedChatModel) {
      return res.status(400).json({
        error: 'Missing required fields: id, messages, selectedChatModel',
      });
    }

    const session = req.session;
    if (!session) {
      const error = new ChatSDKError('unauthorized:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    // Check chat access
    const { chat, allowed, reason } = await checkChatAccess(
      chatId,
      session.user.id,
    );

    if (reason !== 'not_found' && !allowed) {
      const error = new ChatSDKError('forbidden:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    // Get the last user message (the one being sent now)
    const userMessage = messages.length > 0
      ? messages[messages.length - 1]
      : null;

    // Create chat if it doesn't exist
    if (!chat && dbAvailable && userMessage) {
      try {
        const title = await generateTitleFromUserMessage({ message: userMessage });
        await saveChat({
          id: chatId,
          userId: session.user.id,
          title,
          visibility: selectedVisibilityType as VisibilityType,
        });
        console.log('[AsyncChat] Created new chat:', chatId);
      } catch (error) {
        console.error('[AsyncChat] Failed to create chat:', error);
        return res.status(500).json({ error: 'Failed to create chat' });
      }
    } else if (chat && chat.userId !== session.user.id) {
      const error = new ChatSDKError('forbidden:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    // Save user message to database
    if (dbAvailable && userMessage && userMessage.role === 'user') {
      try {
        await saveMessages({
          messages: [{
            chatId,
            id: userMessage.id,
            role: 'user',
            parts: userMessage.parts,
            attachments: userMessage.attachments || [],
            createdAt: userMessage.createdAt ? new Date(userMessage.createdAt) : new Date(),
          }],
        });
        console.log('[AsyncChat] Saved user message:', userMessage.id);
      } catch (error) {
        console.error('[AsyncChat] Failed to save user message:', error);
        // Continue anyway - don't block on this
      }
    }

    const jobId = generateUUID();

    // Create job immediately
    createJob(jobId, chatId);

    // Return jobId to client immediately (within proxy timeout)
    res.json({
      jobId,
      chatId,
      status: 'pending',
    });

    // Process chat in background (after response sent)
    setImmediate(() => {
      processChat({
        jobId,
        chatId,
        messages,
        selectedChatModel,
        userEmail: session.user.email,
        userId: session.user.id,
        userAccessToken: req.userAccessToken,
      }).catch((error) => {
        console.error('[AsyncChat] Background processing error:', error);
        failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
      });
    });
  }
);

/**
 * GET /api/chat-async/job/:jobId
 * Poll for job status and partial results
 */
chatAsyncRouter.get(
  '/job/:jobId',
  requireAuth,
  async (req: Request, res: Response) => {
    const { jobId } = req.params;

    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        jobId,
      });
    }

    // Return current job state
    res.json({
      jobId: job.id,
      chatId: job.chatId,
      status: job.status,
      messageId: job.messageId,
      partialText: job.partialText,
      parts: job.parts,
      partsReceived: job.partsReceived,
      finishReason: job.finishReason,
      error: job.error,
      updatedAt: job.updatedAt,
    });
  }
);

/**
 * POST /api/chat-async/job/:jobId/cancel
 * Cancel a running job
 */
chatAsyncRouter.post(
  '/job/:jobId/cancel',
  requireAuth,
  async (req: Request, res: Response) => {
    const { jobId } = req.params;

    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        jobId,
      });
    }

    // Mark job as cancelled (same as error state)
    if (job.status === 'pending' || job.status === 'streaming') {
      failJob(jobId, 'Cancelled by user');
      console.log('[AsyncChat] Job cancelled:', jobId);
    }

    res.json({
      jobId: job.id,
      status: 'cancelled',
    });
  }
);

/**
 * Background chat processing
 */
async function processChat(params: {
  jobId: string;
  chatId: string;
  messages: ChatMessage[];
  selectedChatModel: string;
  userEmail?: string;
  userId: string;
  userAccessToken?: string;
}): Promise<void> {
  const {
    jobId,
    chatId,
    messages: uiMessages,
    selectedChatModel,
    userEmail,
    userId,
    userAccessToken,
  } = params;

  console.log('[AsyncChat] Starting background processing:', {
    jobId,
    chatId,
    messageCount: uiMessages.length,
    model: selectedChatModel,
  });

  // Set request context for OBO operations
  if (userAccessToken) {
    setRequestContext({
      userAccessToken,
      userEmail,
    });
  }

  const dbAvailable = isDatabaseAvailable();
  let finalUsage: LanguageModelUsage | undefined;
  let finishReason: string | undefined;

  try {
    const model = await myProvider.languageModel(selectedChatModel);

    // Update job status to streaming
    updateJobStatus(jobId, 'streaming');

    // Filter out incomplete tool calls (those without results) to prevent MissingToolResultsError
    const messagesWithCompleteTools = filterIncompleteToolCalls(uiMessages);

    // Truncate messages to prevent exceeding 4MB API request limit
    const truncatedMessages = truncateMessages(messagesWithCompleteTools);

    const result = streamText({
      model,
      messages: await convertToModelMessages(truncatedMessages),
      headers: {
        [CONTEXT_HEADER_CONVERSATION_ID]: chatId,
        [CONTEXT_HEADER_USER_ID]: userEmail ?? userId,
      },
      onFinish: ({ usage, finishReason: reason }) => {
        finalUsage = usage;
        finishReason = reason;
      },
    });

    // Collect all message parts as they stream, preserving order
    const messageId = generateUUID();

    // Track ordered parts as they stream (text, tool calls, etc.)
    const orderedParts: JobMessagePart[] = [];
    let currentTextPart: { type: 'text', text: string } | null = null;
    let reasoningPart: { type: 'reasoning', text: string } | null = null;
    const toolCalls: Map<string, any> = new Map();

    // Track all part types seen for debugging
    const partTypesSeen = new Set<string>();

    // Use fullStream to capture all part types
    for await (const part of result.fullStream) {
      partTypesSeen.add(part.type);
      // Debug: Log each part type and content (only log non-text-delta for brevity)
      if (part.type !== 'text-delta') {
        console.log(`[AsyncChat Stream] Part type: ${part.type}`, JSON.stringify(part).slice(0, 500));
      }

      // Check for tool-related content in any part
      const partStr = JSON.stringify(part);
      if (partStr.includes('tool') || partStr.includes('function') || partStr.includes('query')) {
        console.log(`[AsyncChat] TOOL-RELATED PART: ${part.type}`, partStr.slice(0, 800));
      }

      switch (part.type) {
        case 'text-delta': {
          // AI SDK uses textDelta, but Databricks provider may use text
          const textContent = (part as any).textDelta ?? (part as any).text;
          if (textContent != null) {
            // Accumulate into current text part, or create new one
            if (!currentTextPart) {
              currentTextPart = { type: 'text', text: '' };
              orderedParts.push(currentTextPart);
            }
            currentTextPart.text += textContent;
            appendJobText(jobId, textContent);
          }
          break;
        }

        case 'reasoning': {
          const reasoningContent = (part as any).textDelta ?? (part as any).text;
          if (reasoningContent != null) {
            // Reasoning always goes at the beginning, create if not exists
            if (!reasoningPart) {
              reasoningPart = { type: 'reasoning', text: '' };
              // Insert at beginning of orderedParts
              orderedParts.unshift(reasoningPart);
              addJobPart(jobId, reasoningPart);
            }
            reasoningPart.text += reasoningContent;
            // Update reasoning part in job for live display
            updateJobPart(
              jobId,
              (p) => p.type === 'reasoning',
              { text: reasoningPart.text }
            );
          }
          break;
        }

        case 'tool-call': {
          console.log(`[AsyncChat] TOOL CALL DETECTED: ${(part as any).toolName}`, JSON.stringify(part).slice(0, 300));
          // Finalize any pending text before tool call
          currentTextPart = null;

          // Extract ID from any possible field name (different providers use different names)
          const toolCallId = (part as any).toolCallId ?? (part as any).call_id ?? (part as any).id;
          const toolCallPart = {
            type: 'dynamic-tool',  // UI expects 'dynamic-tool' not 'tool-invocation'
            // Include ALL ID field names for compatibility with different systems
            id: toolCallId,  // Required for model message conversion
            call_id: toolCallId,  // Databricks format
            toolCallId,  // AI SDK format
            toolName: (part as any).toolName ?? (part as any).name,
            name: (part as any).name ?? (part as any).toolName,
            args: (part as any).args ?? (part as any).input,  // AI SDK uses 'args', fallback to 'input'
            input: (part as any).input,  // Keep for backward compatibility
            state: 'input-available',  // Valid ToolState for UI to show parameters
          };
          toolCalls.set(toolCallId, toolCallPart);
          orderedParts.push(toolCallPart);
          // Add tool call immediately so UI shows it during streaming
          addJobPart(jobId, toolCallPart);
          console.log(`[AsyncChat] Tool call added to job parts, total toolCalls: ${toolCalls.size}`);
          break;
        }

        case 'tool-result': {
          // Update the existing tool call part in orderedParts (already added)
          const existingCall = toolCalls.get((part as any).toolCallId);
          if (existingCall) {
            const resultOutput = (part as any).result ?? (part as any).output;
            existingCall.state = 'output-available';
            existingCall.result = resultOutput;  // AI SDK expects 'result'
            existingCall.output = resultOutput;  // Keep for UI compatibility
            // Update the part in the job to show result
            updateJobPart(
              jobId,
              (p) => p.type === 'dynamic-tool' && p.toolCallId === (part as any).toolCallId,
              { state: 'output-available', result: resultOutput, output: resultOutput }
            );
          }
          break;
        }

        case 'source': {
          // In AI SDK v6 fullStream, source parts are flat:
          // { type: 'source', sourceType: 'url', id, url, title }
          // NOT nested under part.source
          const sourcePart = {
            type: 'source-url',
            sourceId: (part as any).id,
            url: (part as any).url,
            title: (part as any).title,
          };
          orderedParts.push(sourcePart);
          // Add source immediately so UI shows it during streaming
          addJobPart(jobId, sourcePart);
          break;
        }

        case 'finish':
          finishReason = part.finishReason;
          break;

        case 'step-start': {
          // Agent step starting - add to parts for UI
          console.log(`[AsyncChat] Step started:`, JSON.stringify(part).slice(0, 500));
          const stepStartPart = {
            type: 'step-start',
            ...(part as any),
          };
          orderedParts.push(stepStartPart);
          addJobPart(jobId, stepStartPart);
          break;
        }

        case 'step-finish':
        case 'finish-step':
          // Agent step finished
          console.log(`[AsyncChat] Step finished:`, JSON.stringify(part).slice(0, 500));
          break;

        case 'text-start':
        case 'text-end':
          // Text boundaries - skip
          break;

        case 'error': {
          // Handle error parts from the stream
          const errorInfo = (part as any).error;
          const errorName = errorInfo?.name || 'Unknown error';
          const errorMessage = errorInfo?.message || JSON.stringify(errorInfo);
          console.error(`[AsyncChat] Stream error: ${errorName}`, errorMessage);
          // Don't throw here - let the stream finish and catch block handle it
          break;
        }

        default:
          // Log any unhandled part types
          console.log(`[AsyncChat Stream] UNHANDLED part type: ${part.type}`, JSON.stringify(part).slice(0, 500));
          break;
      }
    }

    // Log all part types seen
    console.log(`[AsyncChat] All part types seen:`, Array.from(partTypesSeen));

    // Wait for completion
    await result.response;

    // Get accumulated text for fallback check
    const fullText = currentTextPart?.text || '';
    const reasoningText = reasoningPart?.text || '';

    // Debug: Log accumulated content
    console.log(`[AsyncChat] Stream finished - fullText length: ${fullText.length}, reasoning length: ${reasoningText.length}, toolCalls: ${toolCalls.size}, orderedParts: ${orderedParts.length}`);
    if (fullText.length > 0) {
      console.log(`[AsyncChat] fullText preview: ${fullText.slice(0, 200)}`);
    }

    // Try to get text from result.text as fallback (non-streaming accumulator)
    try {
      const resultText = await result.text;
      console.log(`[AsyncChat] result.text length: ${resultText?.length || 0}`);
      if (resultText && !fullText) {
        console.log(`[AsyncChat] Using result.text as fallback`);
        // Add fallback text to orderedParts
        orderedParts.push({ type: 'text', text: resultText });
      }
    } catch (e) {
      console.log(`[AsyncChat] result.text not available: ${e}`);
    }

    // Use orderedParts directly - they are already in stream order
    const parts: JobMessagePart[] = orderedParts;

    // Update job with final parts (preserving stream order)
    setJobParts(jobId, parts);

    // Save message to database (only if DB available)
    if (dbAvailable && parts.length > 0) {
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

        console.log('[AsyncChat] Message saved:', messageId);
      } catch (dbError) {
        console.error('[AsyncChat] Failed to save message to DB:', dbError);
        // Continue - job still completed successfully
      }
    }

    // Mark job as completed
    completeJob(jobId, messageId, finishReason || 'stop');

    // Log token usage
    if (finalUsage) {
      console.log(`[AsyncChat] Tokens - Input: ${finalUsage.inputTokens}, Output: ${finalUsage.outputTokens}, Finish: ${finishReason}`);
    }

    if (finishReason === 'length') {
      console.warn('[AsyncChat] Response truncated due to token limit');
      // Append a notice so the user knows the response was cut off
      const truncationNotice = {
        type: 'text',
        text: '\n\n---\n\n⚠️ *출력 제한으로 응답이 중단되었습니다. **"계속"**이라고 입력하면 이어서 답변을 받을 수 있고, **"위 내용을 요약해줘"**라고 입력하면 요약을 받을 수 있습니다.*',
      };
      orderedParts.push(truncationNotice);
      addJobPart(jobId, truncationNotice);
    }

  } catch (error) {
    console.error('[AsyncChat] Processing error:', error);
    failJob(jobId, error instanceof Error ? error.message : 'Chat processing failed');
  }
}

/**
 * Generate a title from user message
 */
async function generateTitleFromUserMessage({
  message,
}: {
  message: ChatMessage;
}): Promise<string> {
  try {
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
  } catch (error) {
    console.error('[AsyncChat] Failed to generate title:', error);
    // Return a default title if generation fails
    const textPart = message.parts?.find((p: any) => p.type === 'text');
    const text = textPart && 'text' in textPart ? textPart.text : '';
    return text.slice(0, 50) || 'New Chat';
  }
}
