/**
 * Emoji reactions operations.
 */

import type { Config } from "../config/schema.js";
import type { AddReactionParams, RemoveReactionParams, Reaction } from "../types/index.js";
import { getApiClient } from "./client.js";

// Constants

/**
 * Common Feishu emoji types for convenience.
 * @see https://open.feishu.cn/document/server-docs/im-v1/message-reaction/emojis-introduce
 */
export const Emoji = {
  // Common reactions
  THUMBSUP: "THUMBSUP",
  THUMBSDOWN: "THUMBSDOWN",
  HEART: "HEART",
  SMILE: "SMILE",
  GRINNING: "GRINNING",
  LAUGHING: "LAUGHING",
  CRY: "CRY",
  ANGRY: "ANGRY",
  SURPRISED: "SURPRISED",
  THINKING: "THINKING",
  CLAP: "CLAP",
  OK: "OK",
  FIST: "FIST",
  PRAY: "PRAY",
  FIRE: "FIRE",
  PARTY: "PARTY",
  CHECK: "CHECK",
  CROSS: "CROSS",
  QUESTION: "QUESTION",
  EXCLAMATION: "EXCLAMATION",
  // Typing indicator (commonly used)
  WRITING: "WRITING",
  EYES: "EYES",
  TYPING: "Typing",
} as const;

export type EmojiType = (typeof Emoji)[keyof typeof Emoji];

// API Operations

interface AddReactionResponse {
  code?: number;
  msg?: string;
  data?: { reaction_id?: string };
}

/**
 * Add a reaction (emoji) to a message.
 *
 * @throws Error if add fails
 */
export async function addReaction(config: Config, params: AddReactionParams): Promise<string> {
  const client = getApiClient(config);

  const response = (await client.im.messageReaction.create({
    path: { message_id: params.messageId },
    data: {
      reaction_type: { emoji_type: params.emojiType },
    },
  })) as AddReactionResponse;

  if (response.code !== 0) {
    throw new Error(`Add reaction failed: ${response.msg ?? `code ${response.code}`}`);
  }

  const reactionId = response.data?.reaction_id;
  if (!reactionId) {
    throw new Error("Add reaction failed: no reaction_id returned");
  }

  return reactionId;
}

interface RemoveReactionResponse {
  code?: number;
  msg?: string;
}

/**
 * Remove a reaction from a message.
 *
 * @throws Error if remove fails
 */
export async function removeReaction(config: Config, params: RemoveReactionParams): Promise<void> {
  const client = getApiClient(config);

  const response = (await client.im.messageReaction.delete({
    path: {
      message_id: params.messageId,
      reaction_id: params.reactionId,
    },
  })) as RemoveReactionResponse;

  if (response.code !== 0) {
    throw new Error(`Remove reaction failed: ${response.msg ?? `code ${response.code}`}`);
  }
}

interface ListReactionsResponse {
  code?: number;
  msg?: string;
  data?: {
    items?: {
      reaction_id?: string;
      reaction_type?: { emoji_type?: string };
      operator_type?: string;
      operator_id?: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
    }[];
  };
}

/**
 * List all reactions for a message.
 *
 * @throws Error if list fails
 */
export async function listReactions(
  config: Config,
  messageId: string,
  emojiType?: string
): Promise<Reaction[]> {
  const client = getApiClient(config);

  const response = (await client.im.messageReaction.list({
    path: { message_id: messageId },
    params: emojiType ? { reaction_type: emojiType } : undefined,
  })) as ListReactionsResponse;

  if (response.code !== 0) {
    throw new Error(`List reactions failed: ${response.msg ?? `code ${response.code}`}`);
  }

  const items = response.data?.items ?? [];
  return items.map((item) => ({
    reactionId: item.reaction_id ?? "",
    emojiType: item.reaction_type?.emoji_type ?? "",
    operatorType: item.operator_type === "app" ? ("app" as const) : ("user" as const),
    operatorId:
      item.operator_id?.open_id ?? item.operator_id?.user_id ?? item.operator_id?.union_id ?? "",
  }));
}
