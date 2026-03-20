import type { UIMessagePart } from 'ai';
import type { DBMessage } from '@chat-template/db';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';
import { formatISO } from 'date-fns';
import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from 'js-tiktoken/ranks/cl100k_base';

// Initialize tokenizer (cl100k_base is used by GPT-4, Claude, and most modern models)
const tokenizer = new Tiktoken(cl100k_base);

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as 'user' | 'assistant' | 'system',
    parts: message.parts as UIMessagePart<CustomUIDataTypes, ChatTools>[],
    metadata: {
      createdAt: formatISO(message.createdAt),
    },
  }));
}

/**
 * Estimates token count for a single message.
 * Counts tokens in all text content including parts.
 */
function countMessageTokens(message: ChatMessage): number {
  let totalTokens = 0;

  // Count tokens in each part
  for (const part of message.parts) {
    if (part.type === 'text' && part.text) {
      totalTokens += tokenizer.encode(part.text).length;
    } else if (part.type === 'dynamic-tool') {
      // Count tool input
      if (part.input) {
        const inputStr =
          typeof part.input === 'string'
            ? part.input
            : JSON.stringify(part.input);
        totalTokens += tokenizer.encode(inputStr).length;
      }

      // Count tool output (don't truncate - it's already in the conversation)
      if (part.output) {
        const outputStr =
          typeof part.output === 'string'
            ? part.output
            : JSON.stringify(part.output);
        totalTokens += tokenizer.encode(outputStr).length;
      }
    }
  }

  // Add overhead for message structure (role, metadata, etc)
  totalTokens += 4; // approximate overhead per message

  return totalTokens;
}

/**
 * Truncates messages to prevent exceeding API request size limits.
 * Uses token-based truncation to handle large data chunks properly.
 * Keeps the most recent messages up to maxTokens limit.
 *
 * Strategy: Drop OLD messages, not tool outputs. Tool outputs are already
 * in the conversation history - we just limit how much history we send.
 *
 * @param messages - Array of chat messages
 * @param maxTokens - Maximum tokens to keep (default: 100000, ~75% of typical 128k context)
 * @returns Truncated array of messages (drops oldest first)
 */
export function truncateMessages(
  messages: ChatMessage[],
  maxTokens = 100000,
): ChatMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  // Count tokens for each message from newest to oldest
  const messagesWithTokens: Array<{ message: ChatMessage; tokens: number }> =
    [];
  let totalTokens = 0;

  // Iterate from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const tokens = countMessageTokens(message);

    if (totalTokens + tokens <= maxTokens) {
      messagesWithTokens.unshift({ message, tokens });
      totalTokens += tokens;
    } else {
      // Check if we have at least 2 messages (for context)
      if (messagesWithTokens.length < 2) {
        // Force include at least 2 messages even if over limit
        messagesWithTokens.unshift({ message, tokens });
        totalTokens += tokens;
        console.warn(
          `[Truncate] Forced inclusion of message to maintain minimum context (${totalTokens} tokens, exceeds ${maxTokens} limit)`,
        );
      } else {
        // Stop adding older messages
        console.log(
          `[Truncate] Token limit reached. Keeping ${messagesWithTokens.length}/${messages.length} messages (${totalTokens}/${maxTokens} tokens)`,
        );
        break;
      }
    }
  }

  // If we kept all messages, no truncation needed
  if (messagesWithTokens.length === messages.length) {
    console.log(
      `[Truncate] All ${messages.length} messages fit within limit (${totalTokens} tokens)`,
    );
    return messages;
  }

  // Extract just the messages (drop token counts)
  const truncated = messagesWithTokens.map((m) => m.message);

  console.log(
    `[Truncate] Reduced from ${messages.length} to ${truncated.length} messages (${totalTokens}/${maxTokens} tokens)`,
  );

  return truncated;
}
