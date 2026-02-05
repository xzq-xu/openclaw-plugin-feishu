/** Message event parsing utilities */

import type { MessageReceivedEvent, MessageMention, ParsedMessage, MentionInfo } from "../types/index.js";

type Obj = Record<string, unknown>;

function parsePostElements(content: unknown[]): string[] {
  const parts: string[] = [];
  for (const para of content) {
    if (!Array.isArray(para)) continue;
    const pp: string[] = [];
    for (const el of para) {
      if (typeof el !== "object" || el === null || !("tag" in el)) continue;
      const e = el as Obj;
      if (e.tag === "text" && e.text) pp.push(String(e.text));
      else if (e.tag === "img" && e.image_key) pp.push(`[图片: ${e.image_key}]`);
      else if (e.tag === "a" && e.text) pp.push(`${e.text}(${e.href ?? ""})`);
      else if (e.tag === "at" && e.user_id) pp.push(`@${e.user_name ?? "用户"}`);
      else if (e.tag === "emotion" && e.emoji_type) pp.push(`[${e.emoji_type}]`);
    }
    if (pp.length) parts.push(pp.join(""));
  }
  return parts;
}

/** Parse message content based on message type */
export function parseMessageContent(content: string, messageType: string): string {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return content;
    const obj = parsed as Obj;

    switch (messageType) {
      case "text": return obj.text ? String(obj.text) : content;
      case "image": return obj.image_key ? `[图片: ${obj.image_key}]` : content;
      case "file": return obj.file_key ? `[文件: ${obj.file_name ?? "未知文件"} (${obj.file_key})]` : content;
      case "audio": return obj.file_key ? `[语音消息: ${obj.file_key}]` : content;
      case "sticker": return obj.file_key ? `[表情包: ${obj.file_key}]` : content;
      case "share_chat": return obj.chat_id ? `[分享群聊: ${obj.chat_id}]` : content;
      case "share_user": return obj.user_id ? `[分享用户: ${obj.user_id}]` : content;
      case "location": return obj.name ? `[位置: ${obj.name}]` : "[位置分享]";
      case "system": return "[系统消息]";
      case "video_chat": return "[视频会议]";
      case "media":
        if (obj.file_key) return `[媒体: ${obj.file_name ?? "媒体文件"} (${obj.file_key})]`;
        if (obj.image_key) return `[媒体图片: ${obj.image_key}]`;
        return content;
      case "interactive":
        const h = obj.header as Obj | undefined, t = h?.title as Obj | undefined;
        return t?.content ? `[卡片: ${t.content}]` : "[交互卡片]";
      case "post":
        if (Array.isArray(obj.content)) { const parts = parsePostElements(obj.content); if (parts.length) return parts.join("\n"); }
        const zhCn = obj.zh_cn as Obj | undefined;
        if (zhCn && Array.isArray(zhCn.content)) { const parts = parsePostElements(zhCn.content as unknown[]); if (parts.length) return (zhCn.title ? `${zhCn.title}\n` : "") + parts.join("\n"); }
        if (zhCn?.title) return `[富文本: ${zhCn.title}]`;
        return "[富文本消息]";
      default: return content;
    }
  } catch { return content; }
}

// Mention Detection

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
 * Bot mentions are replaced with plain name (preserving semantic meaning),
 * non-bot mentions are converted to Feishu native format.
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
      // Replace bot mentions with <at user_id="self">你</at> (preserve semantic meaning)
      // e.g., "交给@机器人来做" → "交给<at user_id="self">你</at>来做"
      // Uses "self" as special marker, consistent format with other mentions
      const replacement = `<at user_id="self">你</at>`;
      const namePattern = new RegExp(`@${escapeRegex(mention.name)}`, "g");
      result = result.replace(namePattern, replacement);
      result = result.replace(new RegExp(escapeRegex(mention.key), "g"), replacement);
    } else if (mentionOpenId) {
      // Replace with Feishu native format for non-bot mentions
      const replacement = `<at user_id="${mentionOpenId}">${mention.name}</at>`;
      const namePattern = new RegExp(`@${escapeRegex(mention.name)}`, "g");
      result = result.replace(namePattern, replacement);
      result = result.replace(new RegExp(escapeRegex(mention.key), "g"), replacement);
    } else {
      // Replace mentions without open_id with plain name
      const namePattern = new RegExp(`@${escapeRegex(mention.name)}`, "g");
      result = result.replace(namePattern, mention.name);
      result = result.replace(new RegExp(escapeRegex(mention.key), "g"), mention.name);
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

// Event Parsing

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
  const imageKeys: string[] = [];
  let fileKey: string | undefined;
  let fileName: string | undefined;

  try {
    const parsed: unknown = JSON.parse(message.content);
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      
      // Direct image message
      if ("image_key" in obj && typeof obj.image_key === "string") {
        imageKey = obj.image_key;
        imageKeys.push(obj.image_key);
      }
      
      // File/media message
      if ("file_key" in obj && typeof obj.file_key === "string") {
        fileKey = obj.file_key;
      }
      if ("file_name" in obj && typeof obj.file_name === "string") {
        fileName = obj.file_name;
      }
      
      // Rich text (post) message - extract all images
      if ("content" in obj && Array.isArray(obj.content)) {
        for (const paragraph of obj.content) {
          if (Array.isArray(paragraph)) {
            for (const element of paragraph) {
              if (
                typeof element === "object" &&
                element !== null &&
                "tag" in element &&
                (element as Record<string, unknown>).tag === "img" &&
                "image_key" in element &&
                typeof (element as Record<string, unknown>).image_key === "string"
              ) {
                const key = (element as Record<string, unknown>).image_key as string;
                imageKeys.push(key);
                if (!imageKey) imageKey = key; // First image as primary
              }
            }
          }
        }
      }
      
      // zh_cn content structure (alternative format)
      if ("zh_cn" in obj && typeof obj.zh_cn === "object" && obj.zh_cn !== null) {
        const zhCn = obj.zh_cn as Record<string, unknown>;
        if ("content" in zhCn && Array.isArray(zhCn.content)) {
          for (const paragraph of zhCn.content as unknown[]) {
            if (Array.isArray(paragraph)) {
              for (const element of paragraph) {
                if (
                  typeof element === "object" &&
                  element !== null &&
                  "tag" in element &&
                  (element as Record<string, unknown>).tag === "img" &&
                  "image_key" in element &&
                  typeof (element as Record<string, unknown>).image_key === "string"
                ) {
                  const key = (element as Record<string, unknown>).image_key as string;
                  imageKeys.push(key);
                  if (!imageKey) imageKey = key;
                }
              }
            }
          }
        }
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

// Outbound Mention Formatting (Legacy Support)

/**
 * Convert @[Name](open_id) format to Feishu native <at user_id="open_id">Name</at> format.
 * Also replaces <at user_id="self"> with the bot's actual open_id.
 *
 * Note: The preferred approach is to use Feishu native format directly.
 */
export function formatMentionsForFeishu(text: string, botOpenId?: string): string {
  // Convert @[Name](open_id) to Feishu native format
  const mentionPattern = /@\[([^\]]+)\]\(([^)]+)\)/g;
  let result = text.replace(mentionPattern, (_match, name: string, openId: string) => {
    return `<at user_id="${openId}">${name}</at>`;
  });

  // Replace <at user_id="self"> with bot's actual open_id
  if (botOpenId) {
    result = result.replace(/<at user_id="self">/g, `<at user_id="${botOpenId}">`);
  }

  return result;
}
