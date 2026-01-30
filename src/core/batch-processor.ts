/**
 * Batch processor for group messages.
 * Buffers messages per-chat and flushes when triggered, enabling human-like message processing.
 */

import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "clawdbot/plugin-sdk";
import type { MessageReceivedEvent } from "../types/index.js";
import type { ParsedMessage } from "../types/index.js";
import type { Trigger, TriggerContext } from "./triggers/index.js";
import { mentionTrigger } from "./triggers/mention.js";

// ============================================================================
// Constants
// ============================================================================

const STARTUP_WINDOW_MS = 10_000;
const IDLE_FLUSH_DELAY_MS = 1_000;
const REALTIME_DEBOUNCE_MS = 500;

// ============================================================================
// Types
// ============================================================================

interface BufferedMessage {
  parsed: ParsedMessage;
  event: MessageReceivedEvent;
}

interface ChatBatchState {
  chatId: string;
  mode: "startup" | "realtime";
  buffer: BufferedMessage[];
  hasTrigger: boolean;
  triggerMessage?: BufferedMessage;
  batchTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  lastMessageAt: number;
  startupEndsAt: number;
}

export interface FlushParams {
  chatId: string;
  messages: BufferedMessage[];
  triggerMessage: BufferedMessage;
}

export interface BatchProcessorOptions {
  cfg: ClawdbotConfig;
  runtime?: RuntimeEnv;
  chatHistories: Map<string, HistoryEntry[]>;
  botOpenId?: string;
  botName?: string;
  triggers?: Trigger[];
  onFlush: (params: FlushParams) => Promise<void>;
}

// ============================================================================
// BatchProcessor
// ============================================================================

export class BatchProcessor {
  private chatStates = new Map<string, ChatBatchState>();
  private options: BatchProcessorOptions;
  private triggers: Trigger[];
  private connectedAt: number;

  constructor(options: BatchProcessorOptions) {
    this.options = options;
    this.triggers = options.triggers ?? [mentionTrigger];
    this.connectedAt = Date.now();
  }

  processMessage(parsed: ParsedMessage, event: MessageReceivedEvent): void {
    const chatId = parsed.chatId;
    const now = Date.now();

    let state = this.chatStates.get(chatId);
    if (!state) {
      const isStartup = now - this.connectedAt < STARTUP_WINDOW_MS;
      state = {
        chatId,
        mode: isStartup ? "startup" : "realtime",
        buffer: [],
        hasTrigger: false,
        lastMessageAt: now,
        startupEndsAt: this.connectedAt + STARTUP_WINDOW_MS,
      };
      this.chatStates.set(chatId, state);
    }

    const buffered: BufferedMessage = { parsed, event };
    state.buffer.push(buffered);
    state.lastMessageAt = now;

    const ctx: TriggerContext = { parsed, event };
    const triggered = this.triggers.some((t) => t.check(ctx));

    if (triggered) {
      state.hasTrigger = true;
      state.triggerMessage = buffered;
    }

    this.clearIdleTimer(state);

    if (state.mode === "startup") {
      this.scheduleStartupFlush(state);
    } else {
      this.scheduleRealtimeFlush(state);
    }
  }

  private scheduleStartupFlush(state: ChatBatchState): void {
    if (state.batchTimer) return;

    const now = Date.now();
    const timeUntilEnd = Math.max(0, state.startupEndsAt - now);

    state.batchTimer = setTimeout(() => {
      this.flushIfTriggered(state);
    }, timeUntilEnd);

    this.scheduleIdleFlush(state);
  }

  private scheduleRealtimeFlush(state: ChatBatchState): void {
    this.clearBatchTimer(state);

    if (state.hasTrigger) {
      state.batchTimer = setTimeout(() => {
        this.flushIfTriggered(state);
      }, REALTIME_DEBOUNCE_MS);
    }

    this.scheduleIdleFlush(state);
  }

  private scheduleIdleFlush(state: ChatBatchState): void {
    state.idleTimer = setTimeout(() => {
      this.flushIfTriggered(state);
    }, IDLE_FLUSH_DELAY_MS);
  }

  private async flushIfTriggered(state: ChatBatchState): Promise<void> {
    this.clearBatchTimer(state);
    this.clearIdleTimer(state);

    if (!state.hasTrigger || !state.triggerMessage) {
      state.mode = "realtime";
      return;
    }

    const messages = [...state.buffer];
    const triggerMessage = state.triggerMessage;

    this.resetState(state);

    try {
      await this.options.onFlush({
        chatId: state.chatId,
        messages,
        triggerMessage,
      });
    } catch (err) {
      this.options.runtime?.error?.(`BatchProcessor flush error: ${String(err)}`);
    }
  }

  async flush(chatId: string): Promise<void> {
    const state = this.chatStates.get(chatId);
    if (state) {
      await this.flushIfTriggered(state);
    }
  }

  dispose(): void {
    for (const state of this.chatStates.values()) {
      this.clearBatchTimer(state);
      this.clearIdleTimer(state);
    }
    this.chatStates.clear();
  }

  private resetState(state: ChatBatchState): void {
    state.buffer = [];
    state.hasTrigger = false;
    state.triggerMessage = undefined;
    state.mode = "realtime";
  }

  private clearBatchTimer(state: ChatBatchState): void {
    if (state.batchTimer) {
      clearTimeout(state.batchTimer);
      state.batchTimer = undefined;
    }
  }

  private clearIdleTimer(state: ChatBatchState): void {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = undefined;
    }
  }
}
