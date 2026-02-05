/**
 * Reply dispatcher for Feishu.
 * Creates a dispatcher that sends agent replies back to Feishu.
 */

import type { OpenClawConfig, RuntimeEnv, ReplyPayload, PluginRuntime } from "openclaw/plugin-sdk";
import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
} from "openclaw/plugin-sdk";

import { getRuntime } from "./runtime.js";
import { getBotOpenId } from "./gateway.js";
import { sendCardMessage, sendTextMessage, updateCard } from "../api/messages.js";
import { addReaction, removeReaction, Emoji } from "../api/reactions.js";
import { formatMentionsForFeishu } from "./parser.js";
import type { Config } from "../config/schema.js";

// Types

export interface CreateReplyDispatcherParams {
  cfg: OpenClawConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
}

interface TypingIndicatorState {
  messageId: string;
  emoji: string;
}

// Reply Dispatcher

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

  // Type assertion helper - we know feishuCfg is available when used in deliver callback
  const safeFeishuCfg = feishuCfg as Config | undefined;
  const streamingCardConfig = safeFeishuCfg?.streamingCard;
  const streamingCardEnabled = Boolean(streamingCardConfig?.enabled);
  const streamingCardTitle = streamingCardConfig?.title;
  const streamingUpdateIntervalMs = streamingCardConfig?.updateIntervalMs ?? 200;
  let streamingCardMessageId: string | null = null;
  let streamingCardBuffer = "";
  let streamingLastUpdateAt = 0;
  let streamingPendingUpdate = false;
  let streamingUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let streamingUpdatePromise: Promise<void> | null = null;

  const coalesceConfig = safeFeishuCfg?.blockStreamingCoalesce;
  const coalesceEnabled = Boolean(coalesceConfig?.enabled) && !streamingCardEnabled; // Disable coalesce when streaming card is enabled
  const coalesceMinDelayMs = coalesceConfig?.minDelayMs ?? 400;
  const coalesceMaxDelayMs = coalesceConfig?.maxDelayMs ?? 2000;
  let coalesceBuffer = "";
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  let coalesceFirstAt: number | null = null;
  let coalesceFlushPromise: Promise<void> | null = null;

  const sendTextPayload = async (text: string) => {
    if (!safeFeishuCfg) return;
    const converted = core.channel.text.convertMarkdownTables(text, tableMode);
    const formattedText = formatMentionsForFeishu(converted, getBotOpenId());
    const chunks = core.channel.text.chunkTextWithMode(formattedText, textChunkLimit, chunkMode);

    params.runtime.log?.(`Deliver: sending ${chunks.length} chunks to ${chatId}`);
    for (const chunk of chunks) {
      await sendTextMessage(safeFeishuCfg, {
        to: chatId,
        text: chunk,
        replyToMessageId,
      });
    }
  };

  const buildStreamingCard = (text: string): Record<string, unknown> => {
    const converted = core.channel.text.convertMarkdownTables(text, tableMode);
    const formattedText = formatMentionsForFeishu(converted, getBotOpenId());
    const content = formattedText.trim() ? formattedText : " ";
    const card: Record<string, unknown> = {
      config: { wide_screen_mode: true },
      elements: [
        {
          tag: "div",
          text: { tag: "lark_md", content },
        },
      ],
    };

    if (streamingCardTitle?.trim()) {
      card["header"] = {
        title: { tag: "plain_text", content: streamingCardTitle },
      };
    }

    return card;
  };

  const sendStreamingCard = async (text: string) => {
    if (!safeFeishuCfg) return;
    const card = buildStreamingCard(text);
    if (!streamingCardMessageId) {
      const result = await sendCardMessage(safeFeishuCfg, {
        to: chatId,
        card,
        replyToMessageId,
      });
      streamingCardMessageId = result.messageId;
      streamingLastUpdateAt = Date.now();
      return;
    }

    await updateCard(safeFeishuCfg, streamingCardMessageId, card);
    streamingLastUpdateAt = Date.now();
  };

  /**
   * Throttled streaming card update - ensures smooth typewriter effect
   * - First content: send immediately
   * - Subsequent: update at fixed intervals (default 200ms)
   */
  const throttledStreamingUpdate = async () => {
    if (!streamingCardBuffer.trim()) return;

    const now = Date.now();
    const timeSinceLastUpdate = now - streamingLastUpdateAt;

    // First message or enough time has passed - send immediately
    if (!streamingCardMessageId || timeSinceLastUpdate >= streamingUpdateIntervalMs) {
      streamingPendingUpdate = false;
      if (streamingUpdateTimer) {
        clearTimeout(streamingUpdateTimer);
        streamingUpdateTimer = null;
      }
      await sendStreamingCard(streamingCardBuffer);
      return;
    }

    // Schedule update for later if not already scheduled
    if (!streamingPendingUpdate) {
      streamingPendingUpdate = true;
      const delay = streamingUpdateIntervalMs - timeSinceLastUpdate;
      streamingUpdateTimer = setTimeout(() => {
        streamingPendingUpdate = false;
        streamingUpdateTimer = null;
        // Chain the promise to avoid concurrent updates
        streamingUpdatePromise = (streamingUpdatePromise ?? Promise.resolve())
          .then(() => sendStreamingCard(streamingCardBuffer))
          .catch((err) => params.runtime.error?.(`Streaming card update failed: ${String(err)}`));
      }, delay);
    }
  };

  const clearCoalesceTimer = () => {
    if (coalesceTimer) {
      clearTimeout(coalesceTimer);
      coalesceTimer = null;
    }
  };

  const flushCoalesced = async (reason: string) => {
    clearCoalesceTimer();
    const text = coalesceBuffer;
    coalesceBuffer = "";
    coalesceFirstAt = null;

    const content = streamingCardEnabled ? streamingCardBuffer : text;
    if (!content.trim()) {
      return;
    }

    params.runtime.log?.(`Deliver: flushing coalesced text (${reason})`);
    if (streamingCardEnabled) {
      await sendStreamingCard(content);
    } else {
      await sendTextPayload(text);
    }
  };

  const enqueueFlush = async (reason: string) => {
    const next = (coalesceFlushPromise ?? Promise.resolve()).then(() => flushCoalesced(reason));
    coalesceFlushPromise = next;
    await next;
  };

  const scheduleFlush = () => {
    clearCoalesceTimer();
    coalesceTimer = setTimeout(() => {
      void enqueueFlush("idle");
    }, coalesceMinDelayMs);
  };

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

        // Check for NO_RESPONSE - agent decided not to reply (auto-reply mode)
        // Support both [NO_RESPONSE] and NO_RESPONSE formats (AI may output either)
        const trimmedText = text.trim();
        if (
          trimmedText === "[NO_RESPONSE]" ||
          trimmedText === "NO_RESPONSE" ||
          text.includes("[NO_RESPONSE]") ||
          text.includes("NO_RESPONSE")
        ) {
          params.runtime.log?.(`Deliver: agent chose not to respond (auto-reply mode)`);
          return;
        }

        if (!feishuCfg) {
          params.runtime.error?.(`Deliver: feishuCfg not available`);
          return;
        }

        // Text delivery only - media is handled by Clawdbot's outbound.sendMedia
        if (streamingCardEnabled) {
          streamingCardBuffer += text;
          // Use throttled update for smooth typewriter effect
          await throttledStreamingUpdate();
          return;
        }

        if (coalesceEnabled) {
          coalesceBuffer += text;
          if (coalesceFirstAt === null) {
            coalesceFirstAt = Date.now();
          }

          const elapsed = Date.now() - coalesceFirstAt;
          if (elapsed >= coalesceMaxDelayMs) {
            await enqueueFlush("max-delay");
            return;
          }

          scheduleFlush();
          return;
        }

        await sendTextPayload(text);
      },
      onError: (err, info) => {
        params.runtime.error?.(`${info.kind} reply failed: ${String(err)}`);
        typingCallbacks.onIdle?.();
      },
      onIdle: () => {
        // Flush any remaining streaming card content
        if (streamingCardEnabled && streamingCardBuffer.trim()) {
          if (streamingUpdateTimer) {
            clearTimeout(streamingUpdateTimer);
            streamingUpdateTimer = null;
          }
          streamingPendingUpdate = false;
          void sendStreamingCard(streamingCardBuffer);
        }
        if (coalesceEnabled) {
          void enqueueFlush("idle");
        }
        typingCallbacks.onIdle?.();
      },
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
