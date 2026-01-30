/**
 * Mention trigger - checks if message @mention bot
 * Reuses ParsedMessage.mentionedBot field result from parser
 */

import type { ParsedMessage } from "../../types/index.js";
import type { Trigger, TriggerContext, TriggerResult } from "./types.js";

/**
 * Mention 触发器 - 检测消息是否 @mention 了 bot
 * 复用 ParsedMessage.mentionedBot 字段的结果
 */
export class MentionTrigger implements Trigger {
  readonly id = "mention";
  readonly priority = 100;

  check(message: ParsedMessage, _context: TriggerContext): TriggerResult {
    if (message.mentionedBot) {
      return {
        triggered: true,
        triggerId: `mention:${message.messageId}`,
        priority: this.priority,
        metadata: {
          messageId: message.messageId,
          senderId: message.senderOpenId,
        },
      };
    }

    return { triggered: false };
  }
}
