/**
 * Trigger registry implementation for managing and executing triggers
 */

import type { ParsedMessage } from "../../types/index.js";
import type { Trigger, TriggerContext, TriggerResult, TriggerRegistry } from "./types.js";

/**
 * Creates a trigger registry instance
 */
export function createTriggerRegistry(): TriggerRegistry {
  const triggers: Trigger[] = [];

  return {
    register(trigger: Trigger): void {
      // Insert in priority order, keeping triggers array sorted by priority descending
      const index = triggers.findIndex((t) => t.priority < trigger.priority);
      if (index === -1) {
        triggers.push(trigger);
      } else {
        triggers.splice(index, 0, trigger);
      }
    },

    unregister(triggerId: string): void {
      const index = triggers.findIndex((t) => t.id === triggerId);
      if (index !== -1) {
        triggers.splice(index, 1);
      }
    },

    check(message: ParsedMessage, context: TriggerContext): TriggerResult | null {
      // Check all triggers in priority order, return first match
      for (const trigger of triggers) {
        const result = trigger.check(message, context);
        if (result.triggered) {
          return result;
        }
      }
      return null;
    },
  };
}
