/**
 * Batch processor for group messages.
 * Buffers messages per-chat and flushes when triggered, enabling human-like message processing.
 * 
 * Supports two modes:
 * 1. Trigger mode (@bot): Must respond, immediate dispatch with typing indicator
 * 2. Auto-reply mode: Agent autonomously decides whether to respond based on accumulated messages
 */

import type { OpenClawConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { MessageReceivedEvent } from "../types/index.js";
import type { ParsedMessage } from "../types/index.js";
import type { Trigger, TriggerContext } from "./triggers/index.js";
import { mentionTrigger } from "./triggers/mention.js";
import type { AutoReplyConfig } from "../config/schema.js";

// Constants

const STARTUP_WINDOW_MS = 10_000;
const REALTIME_DEBOUNCE_MS = 2_000; // Increased from 500ms - wait for user to finish typing
const MAX_BATCH_WAIT_MS = 10_000; // Max time to wait before forcing flush after first trigger

// Auto-reply defaults
const AUTO_REPLY_MIN_MESSAGES = 5;
const AUTO_REPLY_MIN_TIME_MS = 60_000; // 1 minute
const AUTO_REPLY_DEBOUNCE_MS = 3_000;

// Types

export interface BufferedMessage {
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
  autoReplyTimer?: ReturnType<typeof setTimeout>;
  lastMessageAt: number;
  startupEndsAt: number;
  firstTriggerAt?: number;
  firstMessageAt?: number; // For auto-reply time window
}

export interface FlushParams {
  chatId: string;
  messages: BufferedMessage[];
  triggerMessage?: BufferedMessage; // Optional for auto-reply mode
  isAutoReply?: boolean; // True if this is an autonomous reply (agent decides)
}

export interface BatchProcessorOptions {
  cfg: OpenClawConfig;
  runtime?: RuntimeEnv;
  chatHistories: Map<string, HistoryEntry[]>;
  botOpenId?: string;
  botName?: string;
  triggers?: Trigger[];
  autoReply?: AutoReplyConfig;
  onFlush: (params: FlushParams) => Promise<void>;
}

// BatchProcessor

export class BatchProcessor {
  private chatStates = new Map<string, ChatBatchState>();
  private options: BatchProcessorOptions;
  private triggers: Trigger[];
  private connectedAt: number;
  private log: (msg: string) => void;
  private autoReplyConfig: AutoReplyConfig | undefined;

  constructor(options: BatchProcessorOptions) {
    this.options = options;
    this.triggers = options.triggers ?? [mentionTrigger];
    this.connectedAt = Date.now();
    this.log = options.runtime?.log ?? console.log;
    this.autoReplyConfig = options.autoReply;
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
        firstMessageAt: now, // Track first message for auto-reply time window
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
      // First trigger in this batch - MUST respond
      state.hasTrigger = true;
      state.triggerMessage = buffered;
      state.firstTriggerAt = now;
      this.log(`BatchProcessor: trigger activated for ${chatId}`);

      // Cancel any pending auto-reply check since we now have a real trigger
      this.clearAutoReplyTimer(state);

      // Set max wait timer - force flush after MAX_BATCH_WAIT_MS from first trigger
      this.scheduleMaxWaitFlush(state);
    } else if (triggered && state.hasTrigger) {
      // Update trigger message to the latest one
      state.triggerMessage = buffered;
      this.log(`BatchProcessor: trigger message updated for ${chatId}`);
    }

    // Always reset debounce timer on new message
    this.clearDebounceTimer(state);

    // Also reset auto-reply timer on new message (防抖)
    this.clearAutoReplyTimer(state);

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
    // If we have a trigger, schedule normal flush
    if (state.hasTrigger) {
      // Debounce: wait for user to stop typing
      this.log(`BatchProcessor: debounce timer set (${REALTIME_DEBOUNCE_MS}ms) for ${state.chatId}`);

      state.debounceTimer = setTimeout(() => {
        this.log(`BatchProcessor: debounce timer fired for ${state.chatId}`);
        this.flushIfTriggered(state);
      }, REALTIME_DEBOUNCE_MS);
      return;
    }

    // No trigger - check if auto-reply is enabled
    if (!this.autoReplyConfig?.enabled) {
      this.log(`BatchProcessor: no trigger for ${state.chatId}, waiting...`);
      return;
    }

    // Schedule auto-reply check with debounce
    this.scheduleAutoReplyCheck(state);
  }

  private scheduleAutoReplyCheck(state: ChatBatchState): void {
    const debounceMs = this.autoReplyConfig?.debounceMs ?? AUTO_REPLY_DEBOUNCE_MS;

    this.log(`BatchProcessor: auto-reply debounce set (${debounceMs}ms) for ${state.chatId}`);

    state.autoReplyTimer = setTimeout(() => {
      this.log(`BatchProcessor: auto-reply debounce fired for ${state.chatId}`);
      this.checkAutoReplyConditions(state);
    }, debounceMs);
  }

  private checkAutoReplyConditions(state: ChatBatchState): void {
    if (state.hasTrigger) {
      // Already has trigger, will be handled by normal flush
      return;
    }

    const minMessages = this.autoReplyConfig?.minMessages ?? AUTO_REPLY_MIN_MESSAGES;
    const minTimeMs = this.autoReplyConfig?.minTimeMs ?? AUTO_REPLY_MIN_TIME_MS;
    const now = Date.now();

    const messageCount = state.buffer.length;
    const timeElapsed = now - (state.firstMessageAt ?? now);

    this.log(
      `BatchProcessor: auto-reply check for ${state.chatId}: ` +
        `messages=${messageCount}/${minMessages}, time=${timeElapsed}ms/${minTimeMs}ms`
    );

    // Both conditions must be met
    if (messageCount >= minMessages && timeElapsed >= minTimeMs) {
      this.log(`BatchProcessor: auto-reply conditions met for ${state.chatId}, flushing...`);
      this.flushAutoReply(state);
    } else if (messageCount >= minMessages && timeElapsed < minTimeMs) {
      // Messages enough, but time not enough - schedule a timer for remaining time
      const remainingTime = minTimeMs - timeElapsed;
      this.log(
        `BatchProcessor: messages enough but time not met for ${state.chatId}, ` +
          `waiting ${remainingTime}ms more...`
      );
      this.scheduleTimeConditionCheck(state, remainingTime);
    } else {
      this.log(`BatchProcessor: auto-reply conditions NOT met for ${state.chatId}, continuing to buffer`);
      // Keep buffering, conditions not met yet
    }
  }

  private scheduleTimeConditionCheck(state: ChatBatchState, delayMs: number): void {
    // Clear any existing timer
    this.clearAutoReplyTimer(state);

    this.log(`BatchProcessor: time condition check scheduled in ${delayMs}ms for ${state.chatId}`);

    state.autoReplyTimer = setTimeout(() => {
      this.log(`BatchProcessor: time condition check fired for ${state.chatId}`);
      // Re-check conditions (in case new messages arrived and we need more time)
      this.checkAutoReplyConditions(state);
    }, delayMs);
  }

  private async flushAutoReply(state: ChatBatchState): Promise<void> {
    this.clearDebounceTimer(state);
    this.clearMaxWaitTimer(state);
    this.clearAutoReplyTimer(state);

    if (state.buffer.length === 0) {
      this.log(`BatchProcessor: no messages to auto-reply for ${state.chatId}`);
      return;
    }

    const messages = [...state.buffer];

    this.log(`BatchProcessor: auto-reply flushing ${messages.length} messages for ${state.chatId}`);
    this.resetState(state);

    try {
      await this.options.onFlush({
        chatId: state.chatId,
        messages,
        triggerMessage: undefined, // No specific trigger message
        isAutoReply: true, // Mark as auto-reply mode
      });
    } catch (err) {
      this.options.runtime?.error?.(`BatchProcessor auto-reply flush error: ${String(err)}`);
    }
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
    this.clearAutoReplyTimer(state);

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
        isAutoReply: false,
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
      this.clearAutoReplyTimer(state);
    }
    this.chatStates.clear();
  }

  private resetState(state: ChatBatchState): void {
    state.buffer = [];
    state.hasTrigger = false;
    state.triggerMessage = undefined;
    state.mode = "realtime";
    state.firstTriggerAt = undefined;
    state.firstMessageAt = Date.now(); // Reset for next batch
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

  private clearAutoReplyTimer(state: ChatBatchState): void {
    if (state.autoReplyTimer) {
      clearTimeout(state.autoReplyTimer);
      state.autoReplyTimer = undefined;
    }
  }
}
