/**
 * WebSocket gateway for real-time Feishu events.
 * Includes automatic reconnection with exponential backoff.
 */

import * as Lark from "@larksuiteoapi/node-sdk";
import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { Config } from "../config/schema.js";
import type { MessageReceivedEvent, BotAddedEvent, BotRemovedEvent } from "../types/index.js";
import { createWsClient, probeConnection } from "../api/client.js";
import { handleMessage, createBatchFlushHandler } from "./handler.js";
import { BatchProcessor } from "./batch-processor.js";

// ============================================================================
// Reconnection Configuration
// ============================================================================

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 60000;
const RECONNECT_MAX_ATTEMPTS = 20;

// ============================================================================
// Types
// ============================================================================

export interface GatewayOptions {
  cfg: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}

export interface GatewayState {
  botOpenId: string | undefined;
  botName: string | undefined;
  wsClient: Lark.WSClient | null;
  chatHistories: Map<string, HistoryEntry[]>;
  batchProcessor: BatchProcessor | null;
  isReconnecting: boolean;
  reconnectAttempts: number;
  shouldStop: boolean;
}

// ============================================================================
// Gateway State
// ============================================================================

const state: GatewayState = {
  botName: undefined,
  botOpenId: undefined,
  wsClient: null,
  chatHistories: new Map(),
  batchProcessor: null,
  isReconnecting: false,
  reconnectAttempts: 0,
  shouldStop: false,
};

export function getBotName(): string | undefined {
  return state.botName;
}

export function setBotInfo(openId: string | undefined, name: string | undefined): void {
  state.botOpenId = openId;
  state.botName = name;
}

export function getBotOpenId(): string | undefined {
  return state.botOpenId;
}

// ============================================================================
// Reconnection Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBackoffDelay(attempt: number): number {
  const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, RECONNECT_MAX_DELAY_MS);
}

// ============================================================================
// Gateway Lifecycle
// ============================================================================

export async function startGateway(options: GatewayOptions): Promise<void> {
  const { cfg, runtime, abortSignal } = options;
  const feishuCfg = cfg.channels?.feishu as Config | undefined;
  const log = (msg: string) => runtime?.log?.(msg);
  const error = (msg: string) => runtime?.error?.(msg);

  if (!feishuCfg) {
    throw new Error("Feishu not configured");
  }

  // Reset state
  state.shouldStop = false;
  state.isReconnecting = false;
  state.reconnectAttempts = 0;

  try {
    const probeResult = await probeConnection(feishuCfg);
    if (probeResult.ok && probeResult.botOpenId) {
      state.botOpenId = probeResult.botOpenId;
      state.botName = probeResult.botName;
      log(`Gateway: bot identity resolved: ${state.botName} (${state.botOpenId})`);
    } else {
      log(`Gateway: probe failed or no bot info: ${probeResult.error ?? "unknown"}`);
    }
  } catch (err) {
    log(`Gateway: probe error: ${String(err)}`);
  }

  const onFlush = createBatchFlushHandler({
    cfg,
    runtime,
    chatHistories: state.chatHistories,
  });

  state.batchProcessor = new BatchProcessor({
    cfg,
    runtime,
    chatHistories: state.chatHistories,
    botOpenId: state.botOpenId,
    botName: state.botName,
    onFlush,
  });

  // Create event dispatcher (shared across reconnections)
  const eventDispatcher = new Lark.EventDispatcher({});

  eventDispatcher.register({
    "im.message.receive_v1": async (data: unknown) => {
      try {
        const event = data as MessageReceivedEvent;
        await handleMessage({
          cfg,
          event,
          botOpenId: state.botOpenId,
          botName: state.botName,
          runtime,
          chatHistories: state.chatHistories,
          batchProcessor: state.batchProcessor ?? undefined,
        });
      } catch (err) {
        error(`Gateway: error handling message: ${String(err)}`);
      }
    },

    "im.chat.member.bot.added_v1": async (data: unknown) => {
      const event = data as BotAddedEvent;
      log(`Gateway: bot added to chat ${event.chat_id}`);
    },

    "im.chat.member.bot.deleted_v1": async (data: unknown) => {
      const event = data as BotRemovedEvent;
      log(`Gateway: bot removed from chat ${event.chat_id}`);
      if (state.chatHistories.has(event.chat_id)) {
        state.chatHistories.delete(event.chat_id);
      }
    },
  });

  // Handle abort signal
  const onAbort = () => {
    log("Gateway: abort signal received, stopping...");
    state.shouldStop = true;
    if (state.batchProcessor) {
      state.batchProcessor.dispose();
      state.batchProcessor = null;
    }
    if (state.wsClient) {
      state.wsClient = null;
    }
  };

  if (abortSignal?.aborted) {
    onAbort();
    throw new Error("Gateway aborted before start");
  }

  abortSignal?.addEventListener("abort", onAbort, { once: true });

  // Start WebSocket with reconnection loop
  return startWithReconnect(feishuCfg, eventDispatcher, { log, error });
}

/**
 * Start WebSocket connection with automatic reconnection on failure.
 */
async function startWithReconnect(
  feishuCfg: Config,
  eventDispatcher: Lark.EventDispatcher,
  logger: { log: (msg: string) => void; error: (msg: string) => void }
): Promise<void> {
  const { log, error } = logger;

  while (!state.shouldStop && state.reconnectAttempts < RECONNECT_MAX_ATTEMPTS) {
    try {
      log(
        `Gateway: starting WebSocket connection... (attempt ${state.reconnectAttempts + 1}/${RECONNECT_MAX_ATTEMPTS})`
      );

      // Create fresh WebSocket client for each attempt
      const wsClient = createWsClient(feishuCfg);
      state.wsClient = wsClient;

      // Start the WebSocket client
      await wsClient.start({ eventDispatcher });

      // Connection successful - reset attempts
      state.reconnectAttempts = 0;
      state.isReconnecting = false;
      log("Gateway: WebSocket client started successfully");

      // The SDK's start() resolves immediately after connection.
      // We need to keep the gateway running, so we wait indefinitely
      // until shouldStop is set or the connection drops.
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (state.shouldStop) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 1000);
      });

      // If we reach here and shouldStop is true, exit cleanly
      if (state.shouldStop) {
        log("Gateway: stopping due to abort signal");
        return;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      state.reconnectAttempts++;
      state.isReconnecting = true;

      if (state.shouldStop) {
        log("Gateway: stopping due to abort signal during reconnection");
        return;
      }

      if (state.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
        error(
          `Gateway: max reconnection attempts (${RECONNECT_MAX_ATTEMPTS}) reached. Last error: ${errorMessage}`
        );
        throw new Error(`WebSocket connection failed after ${RECONNECT_MAX_ATTEMPTS} attempts`);
      }

      const delay = calculateBackoffDelay(state.reconnectAttempts);
      error(
        `Gateway: WebSocket connection failed: ${errorMessage}. Reconnecting in ${delay}ms (attempt ${state.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})`
      );

      await sleep(delay);
    }
  }

  if (state.shouldStop) {
    log("Gateway: stopped by user request");
  }
}

export async function stopGateway(): Promise<void> {
  state.shouldStop = true;
  if (state.batchProcessor) {
    state.batchProcessor.dispose();
    state.batchProcessor = null;
  }
  if (state.wsClient) {
    state.wsClient = null;
  }
  state.botOpenId = undefined;
  state.botName = undefined;
  state.chatHistories.clear();
  state.isReconnecting = false;
  state.reconnectAttempts = 0;
}
