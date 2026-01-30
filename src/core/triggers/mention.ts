/**
 * Mention trigger - checks if bot was mentioned in the message.
 */

import type { Trigger, TriggerContext } from "./index.js";

export class MentionTrigger implements Trigger {
  readonly name = "mention";

  check(ctx: TriggerContext): boolean {
    return ctx.parsed.mentionedBot;
  }
}

export const mentionTrigger = new MentionTrigger();
