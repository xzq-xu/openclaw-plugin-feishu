/**
 * Reply dispatcher for Feishu.
 * Creates a dispatcher that sends agent replies back to Feishu.
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import type { ClawdbotConfig, RuntimeEnv, ReplyPayload, PluginRuntime } from "clawdbot/plugin-sdk";
import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
} from "clawdbot/plugin-sdk";

import { getRuntime } from "./runtime.js";
import { sendTextMessage } from "../api/messages.js";
import { sendMedia } from "../api/media.js";
import { addReaction, removeReaction, Emoji } from "../api/reactions.js";
import { formatMentionsForFeishu } from "./parser.js";
import type { Config } from "../config/schema.js";

// ============================================================================
// Types
// ============================================================================

export interface CreateReplyDispatcherParams {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
}

interface TypingIndicatorState {
  messageId: string;
  emoji: string;
}

// ============================================================================
// Media Detection
// ============================================================================

/**
 * Common image and file extensions to detect in text.
 */
const MEDIA_EXTENSIONS = [
  // Images
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tiff",
  ".svg",
  // Documents
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  // Audio/Video
  ".mp3",
  ".wav",
  ".ogg",
  ".opus",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  // Archives
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  // Other
  ".txt",
  ".csv",
  ".json",
  ".xml",
];

/**
 * Detect if text contains a file path that should be sent as media.
 * Returns the file path if found, null otherwise.
 */
function detectFilePath(text: string): string | null {
  const trimmed = text.trim();

  // Check if entire text is a file path
  for (const ext of MEDIA_EXTENSIONS) {
    if (trimmed.toLowerCase().endsWith(ext)) {
      // Looks like a file path - check if it's a reasonable path format
      if (
        trimmed.startsWith("/") || // Unix absolute
        trimmed.startsWith("~") || // Unix home
        trimmed.startsWith("./") || // Relative
        /^[a-zA-Z]:/.test(trimmed) || // Windows absolute
        !trimmed.includes(" ") || // No spaces (likely a path)
        trimmed.includes("/") // Contains path separator
      ) {
        return trimmed;
      }
    }
  }

  // Check for URLs
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const urlParts = trimmed.split(/\s/);
    const url = urlParts[0];
    if (url) {
      for (const ext of MEDIA_EXTENSIONS) {
        if (url.toLowerCase().includes(ext)) {
          return url;
        }
      }
    }
  }

  return null;
}

/**
 * Extract file path from text that may contain additional content.
 * Returns { filePath, remainingText } or null if no file found.
 */
function extractFileFromText(text: string): { filePath: string; remainingText: string } | null {
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const filePath = detectFilePath(line.trim());
    if (filePath) {
      const remainingLines = [...lines.slice(0, i), ...lines.slice(i + 1)];
      return {
        filePath,
        remainingText: remainingLines.join("\n").trim(),
      };
    }
  }

  return null;
}

// ============================================================================
// Reply Dispatcher
// ============================================================================

export function createReplyDispatcher(params: CreateReplyDispatcherParams) {
  const core = getRuntime() as PluginRuntime;
  const { cfg, agentId, chatId, replyToMessageId } = params;
  const feishuCfg = cfg.channels?.feishu as Config | undefined;

  const prefixContext = createReplyPrefixContext({
    cfg,
    agentId,
  });

  // Typing indicator using reactions
  let typingState: TypingIndicatorState | null = null;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      if (!replyToMessageId || !feishuCfg) return;
      try {
        const reactionId = await addReaction(feishuCfg, {
          messageId: replyToMessageId,
          emojiType: Emoji.TYPING,
        });
        typingState = { messageId: replyToMessageId, emoji: reactionId };
        params.runtime.log?.(`Added typing indicator reaction`);
      } catch (err) {
        params.runtime.log?.(`Failed to add typing reaction: ${String(err)}`);
      }
    },
    stop: async () => {
      if (!typingState || !feishuCfg) return;
      try {
        await removeReaction(feishuCfg, {
          messageId: typingState.messageId,
          reactionId: typingState.emoji,
        });
        typingState = null;
        params.runtime.log?.(`Removed typing indicator reaction`);
      } catch (err) {
        params.runtime.log?.(`Failed to remove typing reaction: ${String(err)}`);
      }
    },
    onStartError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "start",
        error: err,
      });
    },
    onStopError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "stop",
        error: err,
      });
    },
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit({
    cfg,
    channel: "feishu",
    defaultLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "feishu");
  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "feishu",
  });

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: typingCallbacks.onReplyStart,
      deliver: async (payload: ReplyPayload) => {
        params.runtime.log?.(`Deliver called: text=${payload.text?.slice(0, 100)}`);
        const text = payload.text ?? "";
        if (!text.trim()) {
          params.runtime.log?.(`Deliver: empty text, skipping`);
          return;
        }

        // Check if text contains a file path to send as media
        const fileExtract = extractFileFromText(text);
        if (fileExtract && feishuCfg) {
          params.runtime.log?.(`Deliver: detected file path: ${fileExtract.filePath}`);

          // Send remaining text first if any
          if (fileExtract.remainingText.trim()) {
            const converted = core.channel.text.convertMarkdownTables(
              fileExtract.remainingText,
              tableMode
            );
            const formattedText = formatMentionsForFeishu(converted);
            const chunks = core.channel.text.chunkTextWithMode(
              formattedText,
              textChunkLimit,
              chunkMode
            );

            for (const chunk of chunks) {
              await sendTextMessage(feishuCfg, {
                to: chatId,
                text: chunk,
                replyToMessageId,
              });
            }
          }

          // Send the file
          try {
            params.runtime.log?.(`Deliver: sending media: ${fileExtract.filePath}`);
            await sendMedia(feishuCfg, {
              to: chatId,
              mediaUrl: fileExtract.filePath,
              replyToMessageId,
            });
            params.runtime.log?.(`Deliver: media sent successfully`);
          } catch (err) {
            params.runtime.error?.(`Deliver: sendMedia failed: ${String(err)}`);
            // Fallback to text with file path
            await sendTextMessage(feishuCfg, {
              to: chatId,
              text: `📎 ${fileExtract.filePath}`,
              replyToMessageId,
            });
          }
          return;
        }

        // Regular text delivery
        const converted = core.channel.text.convertMarkdownTables(text, tableMode);
        const formattedText = formatMentionsForFeishu(converted);
        const chunks = core.channel.text.chunkTextWithMode(
          formattedText,
          textChunkLimit,
          chunkMode
        );

        params.runtime.log?.(`Deliver: sending ${chunks.length} chunks to ${chatId}`);
        for (const chunk of chunks) {
          await sendTextMessage(feishuCfg!, {
            to: chatId,
            text: chunk,
            replyToMessageId,
          });
        }
      },
      onError: (err, info) => {
        params.runtime.error?.(`${info.kind} reply failed: ${String(err)}`);
        typingCallbacks.onIdle?.();
      },
      onIdle: typingCallbacks.onIdle,
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
    },
    markDispatchIdle,
  };
}
