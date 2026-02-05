/**
 * Feishu tools for Clawdbot agents.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { Config } from "../config/schema.js";
import { listMessages, sendCardMessage } from "../api/messages.js";

// Tool Schema Definitions

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

// Card element text content schema
const CardTextSchema = Type.Object({
  tag: Type.Union([Type.Literal("plain_text"), Type.Literal("lark_md")], {
    description: "Text type: plain_text for simple text, lark_md for markdown",
  }),
  content: Type.String({ description: "Text content" }),
});

// Card element schema (simplified but covers common use cases)
const CardElementSchema = Type.Object({
  tag: Type.String({
    description:
      "Element type: div (text block), hr (divider), note (footnote), action (buttons), markdown, img, column_set",
  }),
  text: Type.Optional(CardTextSchema),
  content: Type.Optional(Type.String({ description: "Direct content for markdown tag" })),
  elements: Type.Optional(
    Type.Array(Type.Unknown(), { description: "Nested elements for note/action tags" })
  ),
  actions: Type.Optional(Type.Array(Type.Unknown(), { description: "Button actions" })),
  columns: Type.Optional(Type.Array(Type.Unknown(), { description: "Columns for column_set" })),
  img_key: Type.Optional(Type.String({ description: "Image key for img tag" })),
  alt: Type.Optional(Type.Object({ content: Type.String() })),
});

// Send card tool schema
const SendCardToolSchema = Type.Object({
  to: Type.Optional(
    Type.String({
      description:
        "Target chat_id or user open_id. Omit to use current conversation context (if available).",
    })
  ),
  title: Type.Optional(
    Type.String({
      description: "Card header title (optional)",
    })
  ),
  titleTemplate: Type.Optional(
    Type.Union(
      [
        Type.Literal("blue"),
        Type.Literal("wathet"),
        Type.Literal("turquoise"),
        Type.Literal("green"),
        Type.Literal("yellow"),
        Type.Literal("orange"),
        Type.Literal("red"),
        Type.Literal("carmine"),
        Type.Literal("violet"),
        Type.Literal("purple"),
        Type.Literal("indigo"),
        Type.Literal("grey"),
      ],
      { description: "Header color template (default: blue)" }
    )
  ),
  elements: Type.Array(CardElementSchema, {
    description: "Card body elements array",
  }),
  replyToMessageId: Type.Optional(
    Type.String({
      description: "Message ID to reply to (creates a thread reply)",
    })
  ),
});

type SendCardParams = Static<typeof SendCardToolSchema>;

// Tool Result Helpers

interface ToolResultContent {
  type: "text";
  text: string;
}

interface ToolResult {
  content: ToolResultContent[];
  details?: unknown;
}

/**
 * Create a tool result in the format expected by Clawdbot.
 * Must return { content: [{ type: "text", text: "..." }], details?: ... }
 */
function jsonResult(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    details: data,
  };
}

// Tool Factories

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

// Interactive Card Tool

/**
 * Build Feishu card JSON structure from tool parameters.
 */
function buildCardFromParams(params: SendCardParams): Record<string, unknown> {
  const card: Record<string, unknown> = {
    config: {
      wide_screen_mode: true,
    },
    elements: params.elements,
  };

  // Add header if title is provided
  if (params.title) {
    card.header = {
      title: {
        tag: "plain_text",
        content: params.title,
      },
      template: params.titleTemplate ?? "blue",
    };
  }

  return card;
}

export interface SendCardToolOptions extends CreateToolOptions {
  /** Function to get the current conversation target (for omitting 'to' parameter) */
  getCurrentTarget?: () => string | undefined;
}

/**
 * Create the feishu_card tool for sending interactive cards.
 * Follows Clawdbot's tool interface with TypeBox schema and execute method.
 */
export function createSendCardTool(opts: SendCardToolOptions) {
  return {
    label: "Feishu Card",
    name: "feishu_card",
    description: `Send a Feishu interactive card with rich structured content. Use for:
- Formatted information display (tables, lists, key-value pairs)
- Status reports with colored headers
- Multi-column layouts
- Interactive buttons with URLs or callbacks

Card elements:
- div: text block with { tag: "div", text: { tag: "lark_md", content: "**bold** text" } }
- hr: horizontal divider { tag: "hr" }
- markdown: { tag: "markdown", content: "# Title\\n- item1\\n- item2" }
- note: footnote { tag: "note", elements: [{ tag: "plain_text", content: "Note text" }] }
- action: buttons { tag: "action", actions: [{ tag: "button", text: { tag: "plain_text", content: "Click" }, type: "primary", url: "https://..." }] }
- column_set: multi-column layout

Text types: plain_text (simple) or lark_md (supports **bold**, *italic*, ~~strike~~, [links](url), <at id=all>everyone</at>).
Button types: "default", "primary", "danger". Use "url" for links or "value" for callbacks.`,
    parameters: SendCardToolSchema,
    execute: async (_toolCallId: string, args: unknown) => {
      try {
        const config = opts.getConfig();
        if (!config) {
          return jsonResult({ error: "Feishu not configured" });
        }

        const params = args as SendCardParams;

        // Resolve target: explicit 'to' param, or fallback to current context
        const target = params.to ?? opts.getCurrentTarget?.();
        if (!target) {
          return jsonResult({
            error:
              "Target not specified. Provide 'to' parameter or ensure this is called within a conversation context.",
          });
        }

        // Validate elements array
        if (!params.elements || params.elements.length === 0) {
          return jsonResult({ error: "Card must have at least one element" });
        }

        // Build the card structure
        const card = buildCardFromParams(params);

        // Send the card
        const result = await sendCardMessage(config, {
          to: target,
          card,
          replyToMessageId: params.replyToMessageId,
        });

        return jsonResult({
          success: true,
          messageId: result.messageId,
          chatId: result.chatId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResult({ error: `Card send failed: ${message}` });
      }
    },
  };
}
