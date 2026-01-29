/**
 * Feishu tools for Clawdbot agents.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { Config } from "../config/schema.js";
import { listMessages } from "../api/messages.js";

// ============================================================================
// Tool Schema Definitions
// ============================================================================

const ListMessagesToolSchema = Type.Object({
  chatId: Type.String({
    description: "The chat ID to retrieve messages from (e.g., oc_xxx)",
  }),
  pageSize: Type.Optional(
    Type.Number({
      description: "Number of messages to retrieve (default: 20, max: 50)",
      minimum: 1,
      maximum: 50,
    })
  ),
  pageToken: Type.Optional(
    Type.String({
      description: "Pagination token from previous request",
    })
  ),
});

type ListMessagesParams = Static<typeof ListMessagesToolSchema>;

// ============================================================================
// Tool Result Helpers
// ============================================================================

function jsonResult(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// ============================================================================
// Tool Factories
// ============================================================================

export interface CreateToolOptions {
  getConfig: () => Config | undefined;
}

/**
 * Create the listMessages tool for fetching chat history.
 * Follows Clawdbot's tool interface with TypeBox schema and execute method.
 */
export function createListMessagesTool(opts: CreateToolOptions) {
  return {
    label: "Feishu Messages",
    name: "feishu_list_messages",
    description:
      "Retrieve message history from a Feishu chat. Use this to understand conversation context or find previous messages.",
    parameters: ListMessagesToolSchema,
    execute: async (_toolCallId: string, args: unknown) => {
      try {
        const config = opts.getConfig();
        if (!config) {
          return jsonResult({ error: "Feishu not configured" });
        }

        const params = args as ListMessagesParams;
        if (!params.chatId) {
          return jsonResult({ error: "chatId is required" });
        }

        const result = await listMessages(config, {
          chatId: params.chatId,
          pageSize: params.pageSize ?? 20,
          pageToken: params.pageToken,
        });

        if (!result) {
          return jsonResult({ error: "Failed to fetch messages or access denied" });
        }

        const messages = (result.messages ?? []).map((m) => ({
          messageId: m.messageId,
          sender: m.senderOpenId,
          content: m.content,
          contentType: m.contentType,
          createTime: m.createTime,
        }));

        return jsonResult({
          messages,
          hasMore: result.hasMore ?? false,
          pageToken: result.pageToken,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResult({ error: `Tool execution failed: ${message}` });
      }
    },
  };
}
