/**
 * Message handler for Feishu events.
 * Integrates with Clawdbot runtime for routing and agent execution.
 */

import type { OpenClawConfig, RuntimeEnv, HistoryEntry, PluginRuntime } from "openclaw/plugin-sdk";
import {
  buildPendingHistoryContextFromMap,
  recordPendingHistoryEntryIfEnabled,
  clearHistoryEntriesIfEnabled,
  DEFAULT_GROUP_HISTORY_LIMIT,
} from "openclaw/plugin-sdk";

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

import type { Config } from "../config/schema.js";
import type { MessageReceivedEvent } from "../types/index.js";
import type { ParsedMessage } from "../types/index.js";
import type { BatchProcessor, FlushParams } from "./batch-processor.js";
import { parseMessageEvent } from "./parser.js";
import { checkGroupPolicy, shouldRequireMention } from "./policy.js";
import { createReplyDispatcher } from "./reply-dispatcher.js";
import { getMessage, sendTextMessage } from "../api/messages.js";
import { downloadMessageResource } from "../api/media.js";
import { getUserByOpenId, getUserByUnionId } from "../api/directory.js";
import { getRuntime } from "./runtime.js";
import { matchAllowlist as matchAllowlistPolicy } from "./policy.js";

interface MediaInfo { path: string; contentType: string; }

const MIME_MAP: Record<string, string> = {
  ".txt": "text/plain", ".json": "application/json", ".pdf": "application/pdf",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
  ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".wav": "audio/wav", ".opus": "audio/opus", ".ogg": "audio/ogg",
};
const EXT_MAP = Object.fromEntries(Object.entries(MIME_MAP).map(([k, v]) => [v, k]));

function detectContentType(buffer: Buffer, fileName?: string): string {
  const magic = buffer.slice(0, 4);
  if (magic[0] === 0x89 && magic[1] === 0x50) return "image/png";
  if (magic[0] === 0x47 && magic[1] === 0x49) return "image/gif";
  if (magic[0] === 0x52 && magic[1] === 0x49) return "image/webp";
  if (magic[0] === 0xFF && magic[1] === 0xD8) return "image/jpeg";
  if (magic[0] === 0x25 && magic[1] === 0x50) return "application/pdf";
  if (magic[0] === 0x4F && magic[1] === 0x67 && magic[2] === 0x67 && magic[3] === 0x53) return "audio/ogg";
  if (fileName) { const m = MIME_MAP[path.extname(fileName).toLowerCase()]; if (m) return m; }
  return "application/octet-stream";
}

function getExtension(contentType: string, fileName?: string): string {
  if (fileName) { const ext = path.extname(fileName); if (ext) return ext; }
  return EXT_MAP[contentType] ?? "";
}

function getMediaDir(feishuCfg: Config): string {
  if (feishuCfg.mediaDir) {
    return feishuCfg.mediaDir.startsWith("~") ? feishuCfg.mediaDir.replace("~", os.homedir()) : feishuCfg.mediaDir;
  }
  // Default: system temp directory
  return path.join(os.tmpdir(), "openclaw-feishu-media");
}

/**
 * Download and save media from Feishu to a file.
 * Uses messageResource API for user-sent messages.
 * Save location is configurable via `mediaDir` config option.
 */
async function downloadAndSaveMedia(
  feishuCfg: Config,
  messageId: string,
  fileKey: string,
  resourceType: "image" | "file",
  log: (msg: string) => void,
  originalFileName?: string
): Promise<MediaInfo | null> {
  try {
    log(`[feishu] Downloading ${resourceType}: ${fileKey} from message ${messageId}`);
    const buffer = await downloadMessageResource(feishuCfg, {
      messageId,
      fileKey,
      type: resourceType,
    });
    
    const contentType = detectContentType(buffer, originalFileName);
    const ext = getExtension(contentType, originalFileName);
    
    // Get media directory from config or use default temp directory
    const mediaDir = getMediaDir(feishuCfg);
    await fs.mkdir(mediaDir, { recursive: true });
    
    // Use original filename or generate one
    const baseName = originalFileName 
      ? path.basename(originalFileName, path.extname(originalFileName))
      : crypto.randomUUID();
    const fileName = `${baseName}-${crypto.randomUUID().slice(0, 8)}${ext}`;
    const filePath = path.join(mediaDir, fileName);
    await fs.writeFile(filePath, buffer);
    
    log(`[feishu] Saved ${resourceType} to: ${filePath} (${contentType}, ${buffer.length} bytes)`);
    
    return { path: filePath, contentType };
  } catch (err) {
    log(`[feishu] Failed to download ${resourceType}: ${String(err)}`);
    return null;
  }
}

// Types

export interface MessageHandlerParams {
  cfg: OpenClawConfig;
  event: MessageReceivedEvent;
  botOpenId?: string;
  botName?: string;
  runtime?: RuntimeEnv;
  chatHistories?: Map<string, HistoryEntry[]>;
  batchProcessor?: BatchProcessor;
}

export interface DispatchParams {
  cfg: OpenClawConfig;
  feishuCfg: Config;
  parsed: ParsedMessage;
  runtime?: RuntimeEnv;
  chatHistories?: Map<string, HistoryEntry[]>;
  historyLimit: number;
  batchedMessages?: FlushParams["messages"];
  /** If true, agent decides whether to respond (no typing indicator, no reply-to) */
  isAutoReply?: boolean;
}

// Message Handler

export async function handleMessage(params: MessageHandlerParams): Promise<void> {
  const {
    cfg,
    event,
    botOpenId,
    botName: _botName,
    runtime,
    chatHistories,
    batchProcessor,
  } = params;
  const feishuCfg = cfg.channels?.feishu as Config | undefined;
  const log = runtime?.log ?? console.log;

  if (!feishuCfg) {
    log("Feishu config not found, skipping message");
    return;
  }

  if (feishuCfg.debugRawEvents) {
    try {
      log(`[feishu] Raw event: ${JSON.stringify(event)}`);
    } catch {
      log("[feishu] Raw event: <unserializable>");
    }
  }

  const parsed = parseMessageEvent(event, botOpenId);
  if (!parsed.senderName && parsed.senderOpenId) {
    try {
      const user = await getUserByOpenId(feishuCfg, parsed.senderOpenId);
      if (user?.name) {
        parsed.senderName = user.name;
      }
    } catch {
      // Ignore lookup failures; senderName stays undefined
    }
  }
  if (!parsed.senderName && parsed.senderUnionId) {
    try {
      const user = await getUserByUnionId(feishuCfg, parsed.senderUnionId);
      if (user?.name) {
        parsed.senderName = user.name;
      }
    } catch {
      // Ignore lookup failures; senderName stays undefined
    }
  }
  const senderLabel = parsed.senderName ?? parsed.senderOpenId;
  if (feishuCfg.debugRawEvents) {
    log(
      `[feishu] Sender lookup: open_id=${parsed.senderOpenId} union_id=${
        parsed.senderUnionId ?? "none"
      } name=${parsed.senderName ?? "unknown"}`
    );
  }
  const isGroup = parsed.chatType === "group";

  log(`Received message from ${senderLabel} in ${parsed.chatId} (${parsed.chatType})`);

  const historyLimit = Math.max(
    0,
    feishuCfg.historyLimit ?? cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT
  );

  if (isGroup) {
    const result = checkGroupPolicy(feishuCfg, parsed.chatId, parsed.senderOpenId);

    if (!result.allowed) {
      log(`Sender ${parsed.senderOpenId} not in group allowlist`);
      return;
    }

    if (batchProcessor) {
      batchProcessor.processMessage(parsed, event);
      return;
    }

    const requireMention = shouldRequireMention(feishuCfg, parsed.chatType, parsed.chatId);

    if (requireMention && !parsed.mentionedBot) {
      log(`Message in group ${parsed.chatId} did not mention bot, recording to history`);
      if (chatHistories) {
        recordPendingHistoryEntryIfEnabled({
          historyMap: chatHistories,
          historyKey: parsed.chatId,
          limit: historyLimit,
          entry: {
            sender: senderLabel,
            body: parsed.content,
            timestamp: Date.now(),
            messageId: parsed.messageId,
          },
        });
      }
      return;
    }
  } else {
    // DM policy check with pairing support
    const dmPolicy = feishuCfg?.dmPolicy ?? "pairing";

    if (dmPolicy !== "open") {
      const core = getRuntime() as PluginRuntime;
      
      // Merge config allowFrom with store allowFrom
      const configAllowFrom = (feishuCfg?.allowFrom ?? []).map((entry) => String(entry));
      const storeAllowFrom = await core.channel.pairing
        .readAllowFromStore("feishu")
        .catch(() => []);
      const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom]
        .map((entry) => String(entry).trim())
        .filter(Boolean);

      // Check if sender is in allowlist
      const match = matchAllowlistPolicy(
        effectiveAllowFrom as (string | number)[],
        parsed.senderOpenId,
        parsed.senderName
      );

      if (!match.allowed) {
        if (dmPolicy === "pairing") {
          // Create pairing request
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: "feishu",
            id: parsed.senderOpenId,
            meta: { name: parsed.senderName },
          });

          log(`[feishu] pairing request sender=${parsed.senderOpenId} created=${created}`);

          if (created) {
            // Send pairing code to user
            try {
              const pairingMessage = core.channel.pairing.buildPairingReply({
                channel: "feishu",
                idLine: `Your Feishu user ID: ${parsed.senderOpenId}`,
                code,
              });
              await sendTextMessage(feishuCfg, {
                to: parsed.chatId,
                text: pairingMessage,
              });
              log(`[feishu] pairing code sent to ${parsed.senderOpenId}`);
            } catch (err) {
              runtime?.error?.(`[feishu] pairing reply failed: ${String(err)}`);
            }
          }
        } else {
          log(`Sender ${parsed.senderOpenId} not in DM allowlist (dmPolicy=${dmPolicy})`);
        }
        return;
      }
    }
  }

  await dispatchToAgent({
    cfg,
    feishuCfg,
    parsed,
    runtime,
    chatHistories,
    historyLimit,
  });
}

// Batch Flush Handler

export function createBatchFlushHandler(params: {
  cfg: OpenClawConfig;
  runtime?: RuntimeEnv;
  chatHistories: Map<string, HistoryEntry[]>;
}): (flushParams: FlushParams) => Promise<void> {
  const { cfg, runtime, chatHistories } = params;
  const feishuCfg = cfg.channels?.feishu as Config | undefined;
  const log = runtime?.log ?? console.log;

  const historyLimit = Math.max(
    0,
    feishuCfg?.historyLimit ?? cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT
  );

  return async (flushParams: FlushParams) => {
    if (!feishuCfg) return;

    const { messages, triggerMessage, isAutoReply } = flushParams;

    if (isAutoReply) {
      // Auto-reply mode: use last message as context, let agent decide whether to respond
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage) return;

      log(`[feishu] Auto-reply mode: ${messages.length} messages, agent will decide`);

      await dispatchToAgent({
        cfg,
        feishuCfg,
        parsed: lastMessage.parsed,
        runtime,
        chatHistories,
        historyLimit,
        batchedMessages: messages,
        isAutoReply: true,
      });
    } else {
      // Trigger mode: must respond
      if (!triggerMessage) return;

      await dispatchToAgent({
        cfg,
        feishuCfg,
        parsed: triggerMessage.parsed,
        runtime,
        chatHistories,
        historyLimit,
        batchedMessages: messages,
        isAutoReply: false,
      });
    }
  };
}

// Agent Dispatch

async function dispatchToAgent(params: DispatchParams): Promise<void> {
  const { cfg, feishuCfg, parsed, runtime, chatHistories, historyLimit, batchedMessages, isAutoReply } = params;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;
  const isGroup = parsed.chatType === "group";

  try {
    const core = getRuntime() as PluginRuntime;

    const feishuFrom = isGroup ? `feishu:group:${parsed.chatId}` : `feishu:${parsed.senderOpenId}`;
    const feishuTo = isGroup ? `chat:${parsed.chatId}` : `user:${parsed.senderOpenId}`;

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "feishu",
      peer: {
        kind: isGroup ? "group" : "dm",
        id: isGroup ? parsed.chatId : parsed.senderOpenId,
      },
    });

    const senderLabel = parsed.senderName ?? parsed.senderOpenId;

    // Download media if present (image, file, or audio)
    let mediaInfo: MediaInfo | null = null;
    if (parsed.imageKey) {
      mediaInfo = await downloadAndSaveMedia(
        feishuCfg,
        parsed.messageId,
        parsed.imageKey,
        "image",
        log
      );
    } else if (parsed.fileKey) {
      // Feishu messageResource API uses "file" type for both files and audio
      // Audio messages should use "file" type, not "audio"
      let fileName = parsed.fileName;
      
      if (parsed.contentType === "audio") {
        // Feishu audio is Opus format
        fileName = fileName ?? "voice.opus";
      }
      
      mediaInfo = await downloadAndSaveMedia(
        feishuCfg,
        parsed.messageId,
        parsed.fileKey,
        "file",  // Always use "file" type for messageResource API
        log,
        fileName
      );
    }

    let quotedContent: string | undefined;
    if (parsed.parentId) {
      try {
        const quotedMsg = await getMessage(feishuCfg, parsed.parentId);
        if (quotedMsg) {
          quotedContent = quotedMsg.content;
          log(`Fetched quoted message: ${quotedContent?.slice(0, 100)}`);
        }
      } catch (err) {
        log(`Failed to fetch quoted message: ${String(err)}`);
      }
    }

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);

    let combinedBody: string;

    // Auto-reply system hint - tells agent it can choose not to respond
    const autoReplyHint = feishuCfg.autoReply?.systemHint ?? 
      `[System: You are observing a group chat. You do NOT need to respond to every message. ` +
      `Only reply if: (1) someone asks a question you can answer, (2) the topic is relevant to you, ` +
      `(3) you have something valuable to add. If you decide not to respond, reply with exactly: [NO_RESPONSE]]`;

    if (batchedMessages && batchedMessages.length > 0) {
      const formattedMessages = batchedMessages.map((m) =>
        core.channel.reply.formatAgentEnvelope({
          channel: "Feishu",
          from: m.parsed.senderName ?? m.parsed.senderOpenId,
          timestamp: new Date(),
          envelope: envelopeOptions,
          body: m.parsed.content,
        })
      );
      combinedBody = formattedMessages.join("\n\n");
      
      // Prepend auto-reply hint if in auto-reply mode
      if (isAutoReply) {
        combinedBody = `${autoReplyHint}\n\n---\n\n${combinedBody}`;
      }
    } else {
      let messageBody = parsed.content;
      if (quotedContent) {
        messageBody = `[Replying to: "${quotedContent}"]\n\n${parsed.content}`;
      }

      const body = core.channel.reply.formatAgentEnvelope({
        channel: "Feishu",
        from: isGroup ? parsed.chatId : senderLabel,
        timestamp: new Date(),
        envelope: envelopeOptions,
        body: messageBody,
      });

      combinedBody = body;
      const historyKey = isGroup ? parsed.chatId : undefined;

      if (isGroup && historyKey && chatHistories) {
        combinedBody = buildPendingHistoryContextFromMap({
          historyMap: chatHistories,
          historyKey,
          limit: historyLimit,
          currentMessage: combinedBody,
          formatEntry: (entry: HistoryEntry) =>
            core.channel.reply.formatAgentEnvelope({
              channel: "Feishu",
              from: parsed.chatId,
              timestamp: entry.timestamp,
              body: `${entry.sender}: ${entry.body}`,
              envelope: envelopeOptions,
            }),
        });
      }
    }

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: combinedBody,
      RawBody: parsed.content,
      CommandBody: parsed.content,
      From: feishuFrom,
      To: feishuTo,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? parsed.chatId : undefined,
      SenderName: senderLabel,
      SenderId: parsed.senderOpenId,
      Provider: "feishu" as const,
      Surface: "feishu" as const,
      MessageSid: parsed.messageId,
      Timestamp: Date.now(),
      WasMentioned: parsed.mentionedBot,
      CommandAuthorized: true,
      OriginatingChannel: "feishu" as const,
      OriginatingTo: feishuTo,
      // Media fields (following Telegram pattern)
      MediaPath: mediaInfo?.path,
      MediaType: mediaInfo?.contentType,
      MediaUrl: mediaInfo?.path,
      MediaPaths: mediaInfo ? [mediaInfo.path] : undefined,
      MediaUrls: mediaInfo ? [mediaInfo.path] : undefined,
      MediaTypes: mediaInfo ? [mediaInfo.contentType] : undefined,
    });

    // In auto-reply mode, don't set replyToMessageId (no typing indicator, no reply style)
    const { dispatcher, replyOptions, markDispatchIdle } = createReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime: runtime as RuntimeEnv,
      chatId: parsed.chatId,
      replyToMessageId: isAutoReply ? undefined : parsed.messageId,
    });

    log(`Dispatching to agent (session=${route.sessionKey}${isAutoReply ? ", autoReply=true" : ""})`);

    const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();

    const historyKey = isGroup ? parsed.chatId : undefined;
    if (isGroup && historyKey && chatHistories) {
      clearHistoryEntriesIfEnabled({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
      });
    }

    log(`Dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`);
  } catch (err) {
    error(`Failed to dispatch message: ${String(err)}`);
  }
}
