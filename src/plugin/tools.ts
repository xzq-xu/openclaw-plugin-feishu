/**
 * Feishu tools for Clawdbot agents.
 */

import type { Config } from "../config/schema.js";
import { listMessages } from "../api/messages.js";

// Tool types (matching Clawdbot's expected interface)
export interface FeishuTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: unknown) => Promise<unknown>;
}

export interface FeishuToolContext {
  config?: {
    channels?: {
      feishu?: Config;
    };
  };
  sandboxed?: boolean;
}

/**
 * Create the listMessages tool for fetching chat history.
 */
export function createListMessagesTool(getConfig: () => Config | undefined): FeishuTool {
  return {
    name: "feishu_list_messages",
    description: "Retrieve message history from a Feishu chat. Use this to understand conversation context or find previous messages.",
    parameters: {
      type: "object",
      properties: {
        chatId: {
          type: "string",
          description: "The chat ID to retrieve messages from (e.g., oc_xxx)",
        },
        pageSize: {
          type: "number",
          description: "Number of messages to retrieve (default: 20, max: 50)",
        },
        pageToken: {
          type: "string",
          description: "Pagination token from previous request",
        },
      },
      required: ["chatId"],
    },
    async handler(params: unknown) {
      const config = getConfig();
      if (!config) {
        return { error: "Feishu not configured" };
      }

      const { chatId, pageSize, pageToken } = params as {
        chatId: string;
        pageSize?: number;
        pageToken?: string;
      };

      const result = await listMessages(config, { chatId, pageSize, pageToken });
      
      if (!result) {
        return { error: "Failed to fetch messages or access denied" };
      }

      return {
        messages: result.messages.map(m => ({
          messageId: m.messageId,
          sender: m.senderOpenId,
          content: m.content,
          contentType: m.contentType,
          createTime: m.createTime,
        })),
        hasMore: result.hasMore,
        pageToken: result.pageToken,
      };
    },
  };
}

/**
 * Create all Feishu tools.
 * This is a ToolFactory function that Clawdbot will call with context.
 */
export function createFeishuTools(ctx: FeishuToolContext): FeishuTool[] | null {
  // Don't register tools in sandboxed environment
  if (ctx.sandboxed) {
    return null;
  }

  const feishuConfig = ctx.config?.channels?.feishu;
  
  if (!feishuConfig) {
    return null;
  }

  return [
    createListMessagesTool(() => feishuConfig),
  ];
}
