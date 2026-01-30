/**
 * Trigger type definitions and interfaces
 */

import type { ParsedMessage } from "../../types/index.js";

/**
 * Trigger detection result
 */
export interface TriggerResult {
  triggered: boolean;
  triggerId?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Trigger interface - extensible for custom implementations
 */
export interface Trigger {
  readonly id: string;
  readonly priority: number;
  check(message: ParsedMessage, context: TriggerContext): TriggerResult;
}

/**
 * Trigger execution context
 */
export interface TriggerContext {
  botOpenId?: string;
  botName?: string;
  chatId: string;
  chatType: "p2p" | "group";
}

/**
 * Trigger registry interface for managing triggers
 */
export interface TriggerRegistry {
  register(trigger: Trigger): void;
  unregister(triggerId: string): void;
  check(message: ParsedMessage, context: TriggerContext): TriggerResult | null;
}
