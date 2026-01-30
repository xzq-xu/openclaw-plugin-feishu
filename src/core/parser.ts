/**
 * Message event parsing utilities.
 * Uses Feishu native mention format throughout for compatibility.
 */

import type {
  MessageReceivedEvent,
  MessageMention,
  ParsedMessage,
  MentionInfo,
} from "../types/index.js";

// ============================================================================
// Content Parsing
// ============================================================================

/**
 * Parse message content based on message type.
 * Extracts human-readable content from various message types.
 */
export function parseMessageContent(content: string, messageType: string): string {
  try {
    const parsed: unknown = JSON.parse(content);

    if (typeof parsed !== "object" || parsed === null) {
      return content;
    }

    const obj = parsed as Record<string, unknown>;

    switch (messageType) {
      case "text":
        if ("text" in obj) {
          return String(obj.text);
        }
        break;

      case "image":
        if ("image_key" in obj) {
          return `[图片: ${obj.image_key}]`;
        }
        break;

      case "file":
        if ("file_key" in obj) {
          const fileName = "file_name" in obj ? String(obj.file_name) : "未知文件";
          return `[文件: ${fileName} (${obj.file_key})]`;
        }
        break;

      case "audio":
        if ("file_key" in obj) {
          return `[语音消息: ${obj.file_key}]`;
        }
        break;

      case "media":
        if ("file_key" in obj) {
          const fileName = "file_name" in obj ? String(obj.file_name) : "媒体文件";
          return `[媒体: ${fileName} (${obj.file_key})]`;
        }
        if ("image_key" in obj) {
          return `[媒体图片: ${obj.image_key}]`;
        }
        break;

      case "sticker":
        if ("file_key" in obj) {
          return `[表情包: ${obj.file_key}]`;
        }
        break;

      case "interactive":
        // Interactive card - extract title or fallback
        if ("header" in obj && typeof obj.header === "object" && obj.header !== null) {
          const header = obj.header as Record<string, unknown>;
          if ("title" in header && typeof header.title === "object" && header.title !== null) {
            const title = header.title as Record<string, unknown>;
            if ("content" in title) {
              return `[卡片: ${title.content}]`;
            }
          }
        }
        return "[交互卡片]";

      case "share_chat":
        if ("chat_id" in obj) {
          return `[分享群聊: ${obj.chat_id}]`;
        }
        break;

      case "share_user":
        if ("user_id" in obj) {
          return `[分享用户: ${obj.user_id}]`;
        }
        break;

      case "post":
        // Rich text post - try to extract text content
        if ("content" in obj && Array.isArray(obj.content)) {
          const texts: string[] = [];
          for (const paragraph of obj.content) {
            if (Array.isArray(paragraph)) {
              for (const element of paragraph) {
                if (
                  typeof element === "object" &&
                  element !== null &&
                  "tag" in element &&
                  element.tag === "text" &&
                  "text" in element
                ) {
                  texts.push(String((element as { text: unknown }).text));
                }
              }
            }
          }
          if (texts.length > 0) {
            return texts.join("");
          }
        }
        // Try zh_cn title
        if ("zh_cn" in obj && typeof obj.zh_cn === "object" && obj.zh_cn !== null) {
          const zhCn = obj.zh_cn as Record<string, unknown>;
          if ("title" in zhCn) {
            return `[富文本: ${zhCn.title}]`;
          }
        }
        return "[富文本消息]";

      case "system":
        // System event messages
        return "[系统消息]";

      case "location":
        if ("name" in obj) {
          return `[位置: ${obj.name}]`;
        }
        return "[位置分享]";

      case "video_chat":
        return "[视频会议]";

      default:
        // Unknown type - return type indicator
        return `[${messageType}消息]`;
    }

    return content;
  } catch {
    return content;
  }
}

// ============================================================================
// Mention Detection
// ============================================================================

/**
 * Check if the bot was mentioned in a message.
 */
export function isBotMentioned(
  mentions: MessageMention[] | undefined,
  botOpenId: string | undefined
): boolean {
  if (!mentions || mentions.length === 0) {
    return false;
  }

  // If we don't know our bot's open_id, cannot determine if mentioned
  if (!botOpenId) {
    return false;
  }

  return mentions.some((m) => m.id.open_id === botOpenId);
}

/**
 * Process mentions in message content.
 * Removes bot mentions completely, preserves non-bot mentions in Feishu native format.
 *
 * Feishu native format: <at user_id="open_id">Name</at>
 */
export function stripMentions(
  text: string,
  mentions: MessageMention[] | undefined,
  botOpenId?: string
): string {
  if (!mentions || mentions.length === 0) {
    return text;
  }

  let result = text;
  for (const mention of mentions) {
    const mentionOpenId = mention.id.open_id;
    const isBotMention = botOpenId && mentionOpenId === botOpenId;

    if (isBotMention) {
      // Remove bot mentions entirely
      const namePattern = new RegExp(`@${escapeRegex(mention.name)}\\s*`, "g");
      result = result.replace(namePattern, "").trim();
      result = result.replace(new RegExp(escapeRegex(mention.key), "g"), "").trim();
    } else if (mentionOpenId) {
      // Replace with Feishu native format for non-bot mentions
      const replacement = `<at user_id="${mentionOpenId}">${mention.name}</at>`;
      const namePattern = new RegExp(`@${escapeRegex(mention.name)}`, "g");
      result = result.replace(namePattern, replacement);
      result = result.replace(new RegExp(escapeRegex(mention.key), "g"), replacement);
    } else {
      // Remove mentions without open_id
      const namePattern = new RegExp(`@${escapeRegex(mention.name)}\\s*`, "g");
      result = result.replace(namePattern, "").trim();
      result = result.replace(new RegExp(escapeRegex(mention.key), "g"), "").trim();
    }
  }

  return result;
}

/**
 * Extract non-bot mentions as structured MentionInfo array.
 */
export function extractMentions(
  mentions: MessageMention[] | undefined,
  botOpenId?: string
): MentionInfo[] {
  if (!mentions || mentions.length === 0) {
    return [];
  }

  const result: MentionInfo[] = [];
  for (const mention of mentions) {
    const mentionOpenId = mention.id.open_id;
    if (!mentionOpenId || (botOpenId && mentionOpenId === botOpenId)) {
      continue;
    }
    result.push({
      name: mention.name,
      openId: mentionOpenId,
    });
  }

  return result;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================================
// Event Parsing
// ============================================================================

/**
 * Parse a raw message event into a standardized format.
 */
export function parseMessageEvent(event: MessageReceivedEvent, botOpenId?: string): ParsedMessage {
  const message = event.message;
  const sender = event.sender;

  const rawContent = parseMessageContent(message.content, message.message_type);
  const mentionedBot = isBotMentioned(message.mentions, botOpenId);
  const content = stripMentions(rawContent, message.mentions, botOpenId);
  const mentions = extractMentions(message.mentions, botOpenId);

  // Extract media keys from message content
  let imageKey: string | undefined;
  let fileKey: string | undefined;
  let fileName: string | undefined;

  try {
    const parsed: unknown = JSON.parse(message.content);
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      if ("image_key" in obj && typeof obj.image_key === "string") {
        imageKey = obj.image_key;
      }
      if ("file_key" in obj && typeof obj.file_key === "string") {
        fileKey = obj.file_key;
      }
      if ("file_name" in obj && typeof obj.file_name === "string") {
        fileName = obj.file_name;
      }
    }
  } catch {
    // Keep undefined if parsing fails
  }

  return {
    chatId: message.chat_id,
    messageId: message.message_id,
    senderId: sender.sender_id.user_id ?? sender.sender_id.open_id ?? "",
    senderOpenId: sender.sender_id.open_id ?? "",
    senderUnionId: sender.sender_id.union_id ?? undefined,
    senderName: undefined,
    chatType: message.chat_type,
    mentionedBot,
    rootId: message.root_id ?? undefined,
    parentId: message.parent_id ?? undefined,
    content,
    contentType: message.message_type,
    mentions: mentions.length > 0 ? mentions : undefined,
    imageKey,
    fileKey,
    fileName,
  };
}

// ============================================================================
// Outbound Mention Formatting (Legacy Support)
// ============================================================================

/**
 * Convert @[Name](open_id) format to Feishu native <at user_id="open_id">Name</at> format.
 * This provides backward compatibility for any code still using the old format.
 *
 * Note: The preferred approach is to use Feishu native format directly.
 */
export function formatMentionsForFeishu(text: string): string {
  const mentionPattern = /@\[([^\]]+)\]\(([^)]+)\)/g;
  return text.replace(mentionPattern, (_match, name: string, openId: string) => {
    return `<at user_id="${openId}">${name}</at>`;
  });
}
