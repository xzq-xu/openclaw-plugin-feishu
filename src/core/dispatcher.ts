/**
 * Message dispatch and reply handling.
 */

import type { Config } from "../config/schema.js";
import type { ParsedMessage, SendResult } from "../types/index.js";
import { sendTextMessage, getMessage } from "../api/messages.js";
import { addReaction, removeReaction, Emoji } from "../api/reactions.js";
import { checkDmPolicy, checkGroupPolicy, shouldRequireMention } from "./policy.js";

// Types

export interface DispatchContext {
  config: Config;
  message: ParsedMessage;
  botOpenId: string | undefined;
  onLog?: (message: string) => void;
  onError?: (message: string) => void;
}

export interface DispatchResult {
  processed: boolean;
  reason?: string;
}

export interface TypingIndicator {
  messageId: string;
  reactionId: string;
}

// Typing Indicator

/**
 * Add a typing indicator (reaction) to a message.
 */
export async function addTypingIndicator(
  config: Config,
  messageId: string
): Promise<TypingIndicator | null> {
  try {
    const reactionId = await addReaction(config, {
      messageId,
      emojiType: Emoji.TYPING,
    });
    return { messageId, reactionId };
  } catch {
    return null;
  }
}

/**
 * Remove a typing indicator.
 */
export async function removeTypingIndicator(
  config: Config,
  indicator: TypingIndicator
): Promise<void> {
  try {
    await removeReaction(config, {
      messageId: indicator.messageId,
      reactionId: indicator.reactionId,
    });
  } catch {
    // Ignore removal failures
  }
}

// Message Validation

/**
 * Validate an incoming message against policies.
 * Returns whether the message should be processed.
 */
export function validateMessage(ctx: DispatchContext): DispatchResult {
  const { config, message } = ctx;
  const log = ctx.onLog ?? console.log;

  const isGroup = message.chatType === "group";

  if (isGroup) {
    // Check group policy
    const policyResult = checkGroupPolicy(
      config,
      message.chatId,
      message.senderOpenId,
      message.senderName
    );

    if (!policyResult.allowed) {
      log(`Dispatch: group policy denied - ${policyResult.reason}`);
      return { processed: false, reason: policyResult.reason };
    }

    // Check mention requirement
    const requiresMention = shouldRequireMention(config, message.chatType, message.chatId);

    if (requiresMention && !message.mentionedBot) {
      log(`Dispatch: mention required but bot not mentioned`);
      return { processed: false, reason: "Mention required" };
    }
  } else {
    // Check DM policy
    const policyResult = checkDmPolicy(config, message.senderOpenId, message.senderName);

    if (!policyResult.allowed) {
      log(`Dispatch: DM policy denied - ${policyResult.reason}`);
      return { processed: false, reason: policyResult.reason };
    }
  }

  return { processed: true };
}

// Quoted Message Context

/**
 * Fetch quoted message content if replying to a message.
 */
export async function fetchQuotedContent(
  config: Config,
  parentId: string | undefined,
  onLog?: (message: string) => void
): Promise<string | undefined> {
  if (!parentId) {
    return undefined;
  }

  try {
    const quotedMsg = await getMessage(config, parentId);
    if (quotedMsg) {
      onLog?.(`Dispatch: fetched quoted message: ${quotedMsg.content.slice(0, 100)}`);
      return quotedMsg.content;
    }
  } catch (err) {
    onLog?.(`Dispatch: failed to fetch quoted: ${String(err)}`);
  }

  return undefined;
}

// Reply Sending

/**
 * Send a reply to a message.
 */
export async function sendReply(
  config: Config,
  chatId: string,
  text: string,
  replyToMessageId?: string
): Promise<SendResult> {
  return sendTextMessage(config, {
    to: chatId,
    text,
    replyToMessageId,
  });
}

/**
 * Send chunked replies for long messages.
 */
export async function sendChunkedReply(
  config: Config,
  chatId: string,
  text: string,
  replyToMessageId?: string,
  chunkLimit = 4000
): Promise<SendResult[]> {
  const chunks = chunkText(text, chunkLimit);
  const results: SendResult[] = [];

  for (const chunk of chunks) {
    const result = await sendTextMessage(config, {
      to: chatId,
      text: chunk,
      replyToMessageId,
    });
    results.push(result);
  }

  return results;
}

/**
 * Split text into chunks at reasonable boundaries.
 */
function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    // Find a good break point
    let breakPoint = remaining.lastIndexOf("\n\n", limit);
    if (breakPoint === -1 || breakPoint < limit / 2) {
      breakPoint = remaining.lastIndexOf("\n", limit);
    }
    if (breakPoint === -1 || breakPoint < limit / 2) {
      breakPoint = remaining.lastIndexOf(" ", limit);
    }
    if (breakPoint === -1 || breakPoint < limit / 2) {
      breakPoint = limit;
    }

    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}
