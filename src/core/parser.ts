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
        // Rich text post - extract all content including images
        if ("content" in obj && Array.isArray(obj.content)) {
          const parts: string[] = [];
          for (const paragraph of obj.content) {
            if (Array.isArray(paragraph)) {
              const paragraphParts: string[] = [];
              for (const element of paragraph) {
                if (typeof element === "object" && element !== null && "tag" in element) {
                  const el = element as Record<string, unknown>;
                  if (el.tag === "text" && "text" in el) {
                    paragraphParts.push(String(el.text));
                  } else if (el.tag === "img" && "image_key" in el) {
                    paragraphParts.push(`[图片: ${el.image_key}]`);
                  } else if (el.tag === "a" && "text" in el && "href" in el) {
                    paragraphParts.push(`${el.text}(${el.href})`);
                  } else if (el.tag === "at" && "user_id" in el) {
                    const userName = "user_name" in el ? String(el.user_name) : "用户";
                    paragraphParts.push(`@${userName}`);
                  } else if (el.tag === "emotion" && "emoji_type" in el) {
                    paragraphParts.push(`[${el.emoji_type}]`);
                  }
                }
              }
              if (paragraphParts.length > 0) {
                parts.push(paragraphParts.join(""));
              }
            }
          }
          if (parts.length > 0) {
            return parts.join("\n");
          }
        }
        // Try zh_cn content structure (alternative format)
        if ("zh_cn" in obj && typeof obj.zh_cn === "object" && obj.zh_cn !== null) {
          const zhCn = obj.zh_cn as Record<string, unknown>;
          if ("content" in zhCn && Array.isArray(zhCn.content)) {
            const parts: string[] = [];
            for (const paragraph of zhCn.content as unknown[]) {
              if (Array.isArray(paragraph)) {
                const paragraphParts: string[] = [];
                for (const element of paragraph) {
                  if (typeof element === "object" && element !== null && "tag" in element) {
                    const el = element as Record<string, unknown>;
                    if (el.tag === "text" && "text" in el) {
                      paragraphParts.push(String(el.text));
                    } else if (el.tag === "img" && "image_key" in el) {
                      paragraphParts.push(`[图片: ${el.image_key}]`);
                    }
                  }
                }
                if (paragraphParts.length > 0) {
                  parts.push(paragraphParts.join(""));
                }
              }
            }
            if (parts.length > 0) {
              const title = "title" in zhCn && zhCn.title ? `${zhCn.title}\n` : "";
              return title + parts.join("\n");
            }
          }
          if ("title" in zhCn && zhCn.title) {
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

// ============================================================================
// Outbound Mention Formatting (Legacy Support)
// ============================================================================

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
