/**
 * Message sending and retrieval operations.
 */

import type { Config } from "../config/schema.js";
import type {
  SendTextParams,
  SendCardParams,
  EditMessageParams,
  SendResult,
  MessageInfo,
  ReceiveIdType,
  ListMessagesParams,
  ListMessagesResult,
  HistoryMessage,
} from "../types/index.js";
import { getApiClient } from "./client.js";
import { formatMentionsForFeishu } from "../core/parser.js";

// Target Resolution

/**
 * Normalize a target string to a receive_id.
 * Handles prefixed formats like "feishu:", "lark:", "user:", "chat:", "group:", "dm:".
 * Compatible with framework's normalizeFeishuTarget behavior.
 */
export function normalizeTarget(target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed) return null;

  // Remove channel prefixes (feishu:, lark:)
  let normalized = trimmed.replace(/^(feishu|lark):/i, "").trim();
  // Remove target type prefixes (group:, chat:, user:, dm:)
  normalized = normalized.replace(/^(group|chat|user|dm):/i, "").trim();

  return normalized || null;
}

/**
 * Determine the receive_id_type based on ID format.
 */
export function resolveReceiveIdType(receiveId: string): ReceiveIdType {
  if (receiveId.startsWith("oc_")) return "chat_id";
  if (receiveId.startsWith("ou_")) return "open_id";
  if (receiveId.startsWith("on_")) return "union_id";
  // Default to open_id for DMs
  return "open_id";
}

/**
 * Check if a string looks like a Feishu ID.
 */
export function isValidId(id: string): boolean {
  const trimmed = id.trim();
  return (
    trimmed.startsWith("oc_") ||
    trimmed.startsWith("ou_") ||
    trimmed.startsWith("on_") ||
    trimmed.startsWith("u_") ||
    trimmed.length > 10
  );
}

// Message Retrieval

interface GetMessageResponse {
  code?: number;
  msg?: string;
  data?: {
    items?: {
      message_id?: string;
      chat_id?: string;
      msg_type?: string;
      body?: { content?: string };
      sender?: {
        id?: string;
        id_type?: string;
        sender_type?: string;
      };
      create_time?: string;
    }[];
  };
}

/**
 * Get a message by ID.
 * Returns null if message not found or access denied.
 */
export async function getMessage(config: Config, messageId: string): Promise<MessageInfo | null> {
  const client = getApiClient(config);

  try {
    const response = (await client.im.message.get({
      path: { message_id: messageId },
    })) as GetMessageResponse;

    if (response.code !== 0) {
      return null;
    }

    const item = response.data?.items?.[0];
    if (!item) {
      return null;
    }

    // Parse content based on message type
    let content = item.body?.content ?? "";
    try {
      const parsed: unknown = JSON.parse(content);
      if (
        item.msg_type === "text" &&
        typeof parsed === "object" &&
        parsed !== null &&
        "text" in parsed
      ) {
        content = String((parsed as { text: unknown }).text);
      }
    } catch {
      // Keep raw content if parsing fails
    }

    return {
      messageId: item.message_id ?? messageId,
      chatId: item.chat_id ?? "",
      senderId: item.sender?.id,
      senderOpenId: item.sender?.id_type === "open_id" ? item.sender?.id : undefined,
      content,
      contentType: item.msg_type ?? "text",
      createTime: item.create_time ? parseInt(item.create_time, 10) : undefined,
    };
  } catch {
    return null;
  }
}

// Message History

interface ListMessageResponse {
  code?: number;
  msg?: string;
  data?: {
    items?: {
      message_id?: string;
      chat_id?: string;
      msg_type?: string;
      body?: { content?: string };
      sender?: {
        id?: string;
        id_type?: string;
        sender_type?: string;
      };
      create_time?: string;
      deleted?: boolean;
      updated?: boolean;
    }[];
    has_more?: boolean;
    page_token?: string;
  };
}

/**
 * List messages in a chat with pagination support.
 * Returns null if chat not found or access denied.
 */
export async function listMessages(
  config: Config,
  params: ListMessagesParams
): Promise<ListMessagesResult | null> {
  const client = getApiClient(config);

  try {
    const response = (await client.im.message.list({
      params: {
        container_id_type: "chat",
        container_id: params.chatId,
        page_size: params.pageSize ?? 20,
        page_token: params.pageToken,
        start_time: params.startTime?.toString(),
        end_time: params.endTime?.toString(),
        sort_type: "ByCreateTimeDesc", // Return newest messages first
      },
    })) as ListMessageResponse;

    if (response.code !== 0) {
      console.error("[feishu] listMessages API error:", response.code, response.msg);
      return null;
    }

    const items = response.data?.items;
    if (!items || !Array.isArray(items)) {
      console.warn("[feishu] listMessages: items is not an array", typeof items);
      return {
        messages: [],
        pageToken: response.data?.page_token,
        hasMore: response.data?.has_more ?? false,
      };
    }

    const messages: HistoryMessage[] = items.map((item) => {
      let content = item.body?.content ?? "";
      try {
        const parsed: unknown = JSON.parse(content);
        if (
          item.msg_type === "text" &&
          typeof parsed === "object" &&
          parsed !== null &&
          "text" in parsed
        ) {
          content = String((parsed as { text: unknown }).text);
        }
      } catch {
        // Keep raw content if parsing fails
      }

      return {
        messageId: item.message_id ?? "",
        chatId: item.chat_id ?? params.chatId,
        senderId: item.sender?.id,
        senderOpenId: item.sender?.id_type === "open_id" ? item.sender?.id : undefined,
        content,
        contentType: item.msg_type ?? "text",
        createTime: item.create_time ? parseInt(item.create_time, 10) : undefined,
        deleted: item.deleted,
        updated: item.updated,
      };
    });

    return {
      messages,
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more ?? false,
    };
  } catch (err) {
    console.error("[feishu] listMessages exception:", err);
    return null;
  }
}

// Message Sending

interface SendMessageResponse {
  code?: number;
  msg?: string;
  data?: {
    message_id?: string;
  };
}

/**
 * Send a text message.
 * Automatically converts @[Name](open_id) format to Feishu native <at> tags.
 *
 * @throws Error if target is invalid or send fails
 */
export async function sendTextMessage(config: Config, params: SendTextParams): Promise<SendResult> {
  const client = getApiClient(config);
  const receiveId = normalizeTarget(params.to);

  if (!receiveId) {
    throw new Error(`Invalid target: ${params.to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  // Convert @[Name](open_id) to Feishu native <at> format
  const formattedText = formatMentionsForFeishu(params.text);
  const content = JSON.stringify({ text: formattedText });

  // Reply to existing message
  if (params.replyToMessageId) {
    const response = (await client.im.message.reply({
      path: { message_id: params.replyToMessageId },
      data: { content, msg_type: "text" },
    })) as SendMessageResponse;

    if (response.code !== 0) {
      throw new Error(`Reply failed: ${response.msg ?? `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  // Create new message
  const response = (await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: { receive_id: receiveId, content, msg_type: "text" },
  })) as SendMessageResponse;

  if (response.code !== 0) {
    throw new Error(`Send failed: ${response.msg ?? `code ${response.code}`}`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId: receiveId,
  };
}

/**
 * Send an interactive card message.
 *
 * @throws Error if target is invalid or send fails
 */
export async function sendCardMessage(config: Config, params: SendCardParams): Promise<SendResult> {
  const client = getApiClient(config);
  const receiveId = normalizeTarget(params.to);

  if (!receiveId) {
    throw new Error(`Invalid target: ${params.to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const content = JSON.stringify(params.card);

  // Reply with card
  if (params.replyToMessageId) {
    const response = (await client.im.message.reply({
      path: { message_id: params.replyToMessageId },
      data: { content, msg_type: "interactive" },
    })) as SendMessageResponse;

    if (response.code !== 0) {
      throw new Error(`Card reply failed: ${response.msg ?? `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  // Create card message
  const response = (await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: { receive_id: receiveId, content, msg_type: "interactive" },
  })) as SendMessageResponse;

  if (response.code !== 0) {
    throw new Error(`Card send failed: ${response.msg ?? `code ${response.code}`}`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId: receiveId,
  };
}

/**
 * Update an interactive card message.
 *
 * @throws Error if update fails
 */
export async function updateCard(
  config: Config,
  messageId: string,
  card: Record<string, unknown>
): Promise<void> {
  const client = getApiClient(config);
  const content = JSON.stringify(card);

  const response = (await client.im.message.patch({
    path: { message_id: messageId },
    data: { content },
  })) as SendMessageResponse;

  if (response.code !== 0) {
    throw new Error(`Card update failed: ${response.msg ?? `code ${response.code}`}`);
  }
}

/**
 * Edit an existing text message.
 * Automatically converts @[Name](open_id) format to Feishu native <at> tags.
 * Note: Feishu only allows editing messages within 24 hours.
 *
 * @throws Error if edit fails
 */
export async function editMessage(config: Config, params: EditMessageParams): Promise<void> {
  const client = getApiClient(config);
  const formattedText = formatMentionsForFeishu(params.text);
  const content = JSON.stringify({ text: formattedText });

  const response = (await client.im.message.update({
    path: { message_id: params.messageId },
    data: { msg_type: "text", content },
  })) as SendMessageResponse;

  if (response.code !== 0) {
    throw new Error(`Edit failed: ${response.msg ?? `code ${response.code}`}`);
  }
}
