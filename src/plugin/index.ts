/**
 * Clawdbot plugin entry point.
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";
import { feishuChannel } from "./channel.js";
import { initializeRuntime } from "../core/runtime.js";
import { listMessages } from "../api/messages.js";
import type { Config } from "../config/schema.js";

// Re-export runtime management from core
export { initializeRuntime, getRuntime } from "../core/runtime.js";

const plugin = {
  id: "feishu",
  name: "Feishu",
  description: "Feishu/Lark channel plugin for Clawdbot",
  configSchema: emptyPluginConfigSchema(),

  register(api: ClawdbotPluginApi) {
    initializeRuntime(api.runtime);
    api.registerChannel({ plugin: feishuChannel });
    
    // Register tools if the API supports it
    const apiAny = api as unknown as Record<string, unknown>;
    if (typeof apiAny.registerTool === "function") {
      const registerTool = apiAny.registerTool as (tool: unknown) => void;
      
      registerTool({
        name: "feishu_list_messages",
        description: "Retrieve message history from a Feishu chat. Returns recent messages with sender, content, and timestamp.",
        parameters: {
          type: "object",
          properties: {
            chatId: {
              type: "string",
              description: "The chat ID to retrieve messages from (e.g., oc_xxx). You can get this from the current conversation context.",
            },
            pageSize: {
              type: "number",
              description: "Number of messages to retrieve (default: 20, max: 50)",
            },
          },
          required: ["chatId"],
        },
        handler: async (params: { chatId: string; pageSize?: number }) => {
          const config = (api as unknown as { config?: { channels?: { feishu?: Config } } })
            .config?.channels?.feishu;
          
          if (!config) {
            return { error: "Feishu not configured" };
          }

          const result = await listMessages(config, {
            chatId: params.chatId,
            pageSize: params.pageSize ?? 20,
          });
          
          if (!result) {
            return { error: "Failed to fetch messages or access denied" };
          }

          return {
            messages: result.messages.map(m => ({
              sender: m.senderOpenId,
              content: m.content,
              time: m.createTime ? new Date(m.createTime).toISOString() : undefined,
            })),
            hasMore: result.hasMore,
          };
        },
      });
    }
  },
};

export default plugin;

// Re-export channel for direct access
export { feishuChannel } from "./channel.js";
