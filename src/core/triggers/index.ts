/**
 * Trigger interface for batch processing.
 * Triggers determine when to wake up the agent and process accumulated messages.
 */

import type { ParsedMessage } from "../../types/index.js";
import type { MessageReceivedEvent } from "../../types/index.js";

export interface TriggerContext {
  parsed: ParsedMessage;
  event: MessageReceivedEvent;
}

export interface Trigger {
  readonly name: string;
  check(ctx: TriggerContext): boolean;
}
