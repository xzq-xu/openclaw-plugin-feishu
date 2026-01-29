/**
 * Clawdbot plugin entry point.
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";
import { feishuChannel } from "./channel.js";
import { createFeishuTools } from "./tools.js";
import { initializeRuntime } from "../core/runtime.js";

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
    const apiWithTools = api as ClawdbotPluginApi & {
      registerTool?: (tool: unknown, opts?: unknown) => void;
    };
    
    if (typeof apiWithTools.registerTool === "function") {
      apiWithTools.registerTool(createFeishuTools, { 
        names: ["feishu_list_messages"],
        optional: true 
      });
    }
  },
};

export default plugin;

// Re-export channel for direct access
export { feishuChannel } from "./channel.js";
