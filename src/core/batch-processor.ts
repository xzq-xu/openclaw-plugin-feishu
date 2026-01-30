/**
 * Batch processor for group messages.
 * Buffers messages per-chat and flushes when triggered, enabling human-like message processing.
 */

import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { MessageReceivedEvent } from "../types/index.js";
import type { ParsedMessage } from "../types/index.js";
import type { Trigger, TriggerContext } from "./triggers/index.js";
import { mentionTrigger } from "./triggers/mention.js";

// ============================================================================
// Constants
// ============================================================================

const STARTUP_WINDOW_MS = 10_000;
const REALTIME_DEBOUNCE_MS = 2_000; // Increased from 500ms - wait for user to finish typing
const MAX_BATCH_WAIT_MS = 10_000; // Max time to wait before forcing flush after first trigger

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
  debounceTimer?: ReturnType<typeof setTimeout>;
  maxWaitTimer?: ReturnType<typeof setTimeout>;
  lastMessageAt: number;
  startupEndsAt: number;
  firstTriggerAt?: number;
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
  private log: (msg: string) => void;

  constructor(options: BatchProcessorOptions) {
    this.options = options;
    this.triggers = options.triggers ?? [mentionTrigger];
    this.connectedAt = Date.now();
    this.log = options.runtime?.log ?? console.log;
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
      this.log(`BatchProcessor: created state for ${chatId} (mode=${state.mode})`);
    }

    const buffered: BufferedMessage = { parsed, event };
    state.buffer.push(buffered);
    state.lastMessageAt = now;

    const ctx: TriggerContext = { parsed, event };
    const triggered = this.triggers.some((t) => t.check(ctx));

    if (triggered && !state.hasTrigger) {
      // First trigger in this batch
      state.hasTrigger = true;
      state.triggerMessage = buffered;
      state.firstTriggerAt = now;
      this.log(`BatchProcessor: trigger activated for ${chatId}`);

      // Set max wait timer - force flush after MAX_BATCH_WAIT_MS from first trigger
      this.scheduleMaxWaitFlush(state);
    } else if (triggered && state.hasTrigger) {
      // Update trigger message to the latest one
      state.triggerMessage = buffered;
      this.log(`BatchProcessor: trigger message updated for ${chatId}`);
    }

    // Always reset debounce timer on new message
    this.clearDebounceTimer(state);

    if (state.mode === "startup") {
      this.scheduleStartupFlush(state);
    } else {
      this.scheduleRealtimeFlush(state);
    }
  }

  private scheduleStartupFlush(state: ChatBatchState): void {
    // Don't set new debounce timer during startup, just wait for startup window to end
    if (state.debounceTimer) return;

    const now = Date.now();
    const timeUntilEnd = Math.max(0, state.startupEndsAt - now);

    this.log(`BatchProcessor: startup flush scheduled in ${timeUntilEnd}ms for ${state.chatId}`);

    state.debounceTimer = setTimeout(() => {
      this.flushIfTriggered(state);
    }, timeUntilEnd);
  }

  private scheduleRealtimeFlush(state: ChatBatchState): void {
    // Only schedule flush if we have a trigger
    if (!state.hasTrigger) {
      this.log(`BatchProcessor: no trigger for ${state.chatId}, waiting...`);
      return;
    }

    // Debounce: wait for user to stop typing
    this.log(`BatchProcessor: debounce timer set (${REALTIME_DEBOUNCE_MS}ms) for ${state.chatId}`);

    state.debounceTimer = setTimeout(() => {
      this.log(`BatchProcessor: debounce timer fired for ${state.chatId}`);
      this.flushIfTriggered(state);
    }, REALTIME_DEBOUNCE_MS);
  }

  private scheduleMaxWaitFlush(state: ChatBatchState): void {
    // Clear existing max wait timer if any
    this.clearMaxWaitTimer(state);

    this.log(`BatchProcessor: max wait timer set (${MAX_BATCH_WAIT_MS}ms) for ${state.chatId}`);

    state.maxWaitTimer = setTimeout(() => {
      this.log(`BatchProcessor: max wait timer fired for ${state.chatId}`);
      this.flushIfTriggered(state);
    }, MAX_BATCH_WAIT_MS);
  }

  private async flushIfTriggered(state: ChatBatchState): Promise<void> {
    this.clearDebounceTimer(state);
    this.clearMaxWaitTimer(state);

    if (!state.hasTrigger || !state.triggerMessage) {
      this.log(`BatchProcessor: no trigger, skipping flush for ${state.chatId}`);
      state.mode = "realtime";
      return;
    }

    const messages = [...state.buffer];
    const triggerMessage = state.triggerMessage;

    this.log(`BatchProcessor: flushing ${messages.length} messages for ${state.chatId}`);
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
      this.clearDebounceTimer(state);
      this.clearMaxWaitTimer(state);
    }
    this.chatStates.clear();
  }

  private resetState(state: ChatBatchState): void {
    state.buffer = [];
    state.hasTrigger = false;
    state.triggerMessage = undefined;
    state.mode = "realtime";
    state.firstTriggerAt = undefined;
  }

  private clearDebounceTimer(state: ChatBatchState): void {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = undefined;
    }
  }

  private clearMaxWaitTimer(state: ChatBatchState): void {
    if (state.maxWaitTimer) {
      clearTimeout(state.maxWaitTimer);
      state.maxWaitTimer = undefined;
    }
  }
}
