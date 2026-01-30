/**
 * Unit tests for core/parser.ts
 * 
 * Note: stripMentions now outputs Feishu native format <at user_id="...">Name</at>
 * instead of the previous @[Name](open_id) format.
 */

import { describe, it, expect } from "vitest";
import {
  parseMessageContent,
  isBotMentioned,
  stripMentions,
  parseMessageEvent,
  extractMentions,
  formatMentionsForFeishu,
} from "../../../dist/core/parser.js";
import type { MessageReceivedEvent, MessageMention } from "../../../dist/types/index.js";

describe("parseMessageContent", () => {
  it("extracts text from text message JSON", () => {
    const content = JSON.stringify({ text: "Hello world" });
    expect(parseMessageContent(content, "text")).toBe("Hello world");
  });

  it("returns raw content for non-text message types", () => {
    const content = JSON.stringify({ text: "Hello" });
    expect(parseMessageContent(content, "image")).toBe(content);
  });

  it("returns raw content if JSON parse fails", () => {
    const content = "not json";
    expect(parseMessageContent(content, "text")).toBe("not json");
  });

  it("returns raw content if text field missing", () => {
    const content = JSON.stringify({ other: "field" });
    expect(parseMessageContent(content, "text")).toBe(content);
  });
});

describe("isBotMentioned", () => {
  const mention: MessageMention = {
    key: "@_user_123",
    id: { open_id: "ou_bot123" },
    name: "TestBot",
  };

  it("returns false for empty mentions", () => {
    expect(isBotMentioned([], "ou_bot123")).toBe(false);
    expect(isBotMentioned(undefined, "ou_bot123")).toBe(false);
  });

  it("returns true when bot ID matches", () => {
    expect(isBotMentioned([mention], "ou_bot123")).toBe(true);
  });

  it("returns false when bot ID does not match", () => {
    expect(isBotMentioned([mention], "ou_other")).toBe(false);
  });

  it("returns false when botOpenId undefined (cannot determine)", () => {
    expect(isBotMentioned([mention], undefined)).toBe(false);
  });
});

describe("stripMentions", () => {
  const mentions: MessageMention[] = [
    { key: "@_user_123", id: { open_id: "ou_123" }, name: "Alice" },
  ];

  it("preserves non-bot mention in Feishu native format when no botOpenId", () => {
    expect(stripMentions("@Alice hello", mentions)).toBe('<at user_id="ou_123">Alice</at> hello');
  });

  it("preserves mention key in Feishu native format", () => {
    expect(stripMentions("@_user_123 hello", mentions)).toBe('<at user_id="ou_123">Alice</at> hello');
  });

  it("handles empty mentions", () => {
    expect(stripMentions("hello", [])).toBe("hello");
    expect(stripMentions("hello", undefined)).toBe("hello");
  });

  it("handles special regex characters in name", () => {
    const specialMentions: MessageMention[] = [
      { key: "@_key", id: { open_id: "ou_x" }, name: "Bot.v2" },
    ];
    expect(stripMentions("@Bot.v2 test", specialMentions)).toBe('<at user_id="ou_x">Bot.v2</at> test');
  });

  it("preserves non-bot mentions in Feishu native format when botOpenId provided", () => {
    const result = stripMentions("@Alice hello", mentions, "ou_bot");
    expect(result).toBe('<at user_id="ou_123">Alice</at> hello');
  });

  it("removes bot mention but preserves others in Feishu native format", () => {
    const mixedMentions: MessageMention[] = [
      { key: "@_bot", id: { open_id: "ou_bot" }, name: "Bot" },
      { key: "@_alice", id: { open_id: "ou_alice" }, name: "Alice" },
    ];
    const result = stripMentions("@Bot @Alice hi", mixedMentions, "ou_bot");
    expect(result).toBe('<at user_id="ou_alice">Alice</at> hi');
  });

  it("removes all bot mentions when matching botOpenId", () => {
    const botMention: MessageMention[] = [{ key: "@_bot", id: { open_id: "ou_bot" }, name: "Bot" }];
    const result = stripMentions("@Bot hello", botMention, "ou_bot");
    expect(result).toBe("hello");
  });

  it("handles multiple non-bot mentions in Feishu native format", () => {
    const multiMentions: MessageMention[] = [
      { key: "@_alice", id: { open_id: "ou_alice" }, name: "Alice" },
      { key: "@_bob", id: { open_id: "ou_bob" }, name: "Bob" },
    ];
    const result = stripMentions("@Alice @Bob meeting", multiMentions, "ou_bot");
    expect(result).toBe('<at user_id="ou_alice">Alice</at> <at user_id="ou_bob">Bob</at> meeting');
  });

  it("removes mention without open_id", () => {
    const noOpenIdMention: MessageMention[] = [
      { key: "@_user", id: { user_id: "u_123" }, name: "User" },
    ];
    const result = stripMentions("@User hello", noOpenIdMention, "ou_bot");
    expect(result).toBe("hello");
  });

  it("handles names with special characters like brackets", () => {
    const specialNameMentions: MessageMention[] = [
      { key: "@_vacuum", id: { open_id: "ou_vacuum" }, name: "Vacuum[吸尘器]" },
    ];
    const result = stripMentions("@Vacuum[吸尘器] hello", specialNameMentions, "ou_bot");
    expect(result).toBe('<at user_id="ou_vacuum">Vacuum[吸尘器]</at> hello');
  });
});

describe("extractMentions", () => {
  it("returns empty array for undefined mentions", () => {
    expect(extractMentions(undefined, "ou_bot")).toEqual([]);
  });

  it("returns empty array for empty mentions", () => {
    expect(extractMentions([], "ou_bot")).toEqual([]);
  });

  it("excludes bot from extracted mentions", () => {
    const mentions: MessageMention[] = [
      { key: "@_bot", id: { open_id: "ou_bot" }, name: "Bot" },
      { key: "@_alice", id: { open_id: "ou_alice" }, name: "Alice" },
    ];
    const result = extractMentions(mentions, "ou_bot");
    expect(result).toEqual([{ name: "Alice", openId: "ou_alice" }]);
  });

  it("extracts all mentions when no botOpenId provided", () => {
    const mentions: MessageMention[] = [
      { key: "@_alice", id: { open_id: "ou_alice" }, name: "Alice" },
      { key: "@_bob", id: { open_id: "ou_bob" }, name: "Bob" },
    ];
    const result = extractMentions(mentions, undefined);
    expect(result).toEqual([
      { name: "Alice", openId: "ou_alice" },
      { name: "Bob", openId: "ou_bob" },
    ]);
  });

  it("skips mentions without open_id", () => {
    const mentions: MessageMention[] = [
      { key: "@_alice", id: { user_id: "u_alice" }, name: "Alice" },
      { key: "@_bob", id: { open_id: "ou_bob" }, name: "Bob" },
    ];
    const result = extractMentions(mentions, undefined);
    expect(result).toEqual([{ name: "Bob", openId: "ou_bob" }]);
  });

  it("returns only non-bot mentions with correct structure", () => {
    const mentions: MessageMention[] = [
      { key: "@_bot", id: { open_id: "ou_bot" }, name: "MyBot" },
      { key: "@_user1", id: { open_id: "ou_user1" }, name: "User One" },
      { key: "@_user2", id: { open_id: "ou_user2" }, name: "User Two" },
    ];
    const result = extractMentions(mentions, "ou_bot");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "User One", openId: "ou_user1" });
    expect(result[1]).toEqual({ name: "User Two", openId: "ou_user2" });
  });
});

describe("parseMessageEvent", () => {
  const baseEvent: MessageReceivedEvent = {
    sender: {
      sender_id: { open_id: "ou_sender", user_id: "u_sender" },
      sender_type: "user",
    },
    message: {
      message_id: "msg_123",
      chat_id: "oc_chat",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: "@Bot hello" }),
      mentions: [{ key: "@_bot", id: { open_id: "ou_bot" }, name: "Bot" }],
    },
  };

  it("parses event into ParsedMessage", () => {
    const result = parseMessageEvent(baseEvent, "ou_bot");
    expect(result.chatId).toBe("oc_chat");
    expect(result.messageId).toBe("msg_123");
    expect(result.senderId).toBe("u_sender");
    expect(result.senderOpenId).toBe("ou_sender");
    expect(result.chatType).toBe("group");
    expect(result.mentionedBot).toBe(true);
    expect(result.content).toBe("hello");
  });

  it("sets mentionedBot false when bot not mentioned", () => {
    const result = parseMessageEvent(baseEvent, "ou_other");
    expect(result.mentionedBot).toBe(false);
  });

  it("includes mentions array for non-bot mentions in Feishu native format", () => {
    const eventWithUserMention: MessageReceivedEvent = {
      ...baseEvent,
      message: {
        ...baseEvent.message,
        content: JSON.stringify({ text: "@Bot @Alice hello" }),
        mentions: [
          { key: "@_bot", id: { open_id: "ou_bot" }, name: "Bot" },
          { key: "@_alice", id: { open_id: "ou_alice" }, name: "Alice" },
        ],
      },
    };
    const result = parseMessageEvent(eventWithUserMention, "ou_bot");
    expect(result.mentions).toEqual([{ name: "Alice", openId: "ou_alice" }]);
    expect(result.content).toBe('<at user_id="ou_alice">Alice</at> hello');
  });

  it("has undefined mentions when only bot is mentioned", () => {
    const result = parseMessageEvent(baseEvent, "ou_bot");
    expect(result.mentions).toBeUndefined();
  });

  // Media key extraction tests
  it("extracts imageKey from image message", () => {
    const imageEvent: MessageReceivedEvent = {
      sender: baseEvent.sender,
      message: {
        ...baseEvent.message,
        message_type: "image",
        content: JSON.stringify({ image_key: "img_abc123" }),
      },
    };
    const result = parseMessageEvent(imageEvent, "ou_bot");
    expect(result.imageKey).toBe("img_abc123");
    expect(result.contentType).toBe("image");
    expect(result.content).toBe("[图片: img_abc123]");
  });

  it("extracts fileKey and fileName from file message", () => {
    const fileEvent: MessageReceivedEvent = {
      sender: baseEvent.sender,
      message: {
        ...baseEvent.message,
        message_type: "file",
        content: JSON.stringify({ file_key: "file_xyz789", file_name: "report.pdf" }),
      },
    };
    const result = parseMessageEvent(fileEvent, "ou_bot");
    expect(result.fileKey).toBe("file_xyz789");
    expect(result.fileName).toBe("report.pdf");
    expect(result.contentType).toBe("file");
    expect(result.content).toBe("[文件: report.pdf (file_xyz789)]");
  });

  it("extracts fileKey from audio message", () => {
    const audioEvent: MessageReceivedEvent = {
      sender: baseEvent.sender,
      message: {
        ...baseEvent.message,
        message_type: "audio",
        content: JSON.stringify({ file_key: "audio_voice456" }),
      },
    };
    const result = parseMessageEvent(audioEvent, "ou_bot");
    expect(result.fileKey).toBe("audio_voice456");
    expect(result.contentType).toBe("audio");
    expect(result.content).toBe("[语音消息: audio_voice456]");
  });

  it("handles media message with both image_key and file_key", () => {
    const mediaEvent: MessageReceivedEvent = {
      sender: baseEvent.sender,
      message: {
        ...baseEvent.message,
        message_type: "media",
        content: JSON.stringify({ file_key: "media_doc", file_name: "document.docx" }),
      },
    };
    const result = parseMessageEvent(mediaEvent, "ou_bot");
    expect(result.fileKey).toBe("media_doc");
    expect(result.fileName).toBe("document.docx");
    expect(result.content).toBe("[媒体: document.docx (media_doc)]");
  });

  it("handles malformed JSON content gracefully", () => {
    const badEvent: MessageReceivedEvent = {
      sender: baseEvent.sender,
      message: {
        ...baseEvent.message,
        content: "not valid json",
      },
    };
    const result = parseMessageEvent(badEvent, "ou_bot");
    expect(result.imageKey).toBeUndefined();
    expect(result.fileKey).toBeUndefined();
    expect(result.fileName).toBeUndefined();
  });

  it("handles image message without image_key gracefully", () => {
    const incompleteImageEvent: MessageReceivedEvent = {
      sender: baseEvent.sender,
      message: {
        ...baseEvent.message,
        message_type: "image",
        content: JSON.stringify({ other_field: "value" }),
      },
    };
    const result = parseMessageEvent(incompleteImageEvent, "ou_bot");
    expect(result.imageKey).toBeUndefined();
  });
});

describe("formatMentionsForFeishu", () => {
  it("converts @[Name](open_id) to Feishu native format (legacy support)", () => {
    const input = "@[Alice](ou_123) hello";
    const expected = '<at user_id="ou_123">Alice</at> hello';
    expect(formatMentionsForFeishu(input)).toBe(expected);
  });

  it("converts multiple mentions", () => {
    const input = "@[Alice](ou_alice) @[Bob](ou_bob) meeting";
    const expected = '<at user_id="ou_alice">Alice</at> <at user_id="ou_bob">Bob</at> meeting';
    expect(formatMentionsForFeishu(input)).toBe(expected);
  });

  it("returns text unchanged when no mentions", () => {
    const input = "Hello world, no mentions here";
    expect(formatMentionsForFeishu(input)).toBe(input);
  });

  it("handles special characters in name", () => {
    const input = "@[张三.李四](ou_xxx) 你好";
    const expected = '<at user_id="ou_xxx">张三.李四</at> 你好';
    expect(formatMentionsForFeishu(input)).toBe(expected);
  });

  it("leaves malformed mentions unchanged", () => {
    const input = "@[Name] missing parens @[](ou_123) empty name";
    expect(formatMentionsForFeishu(input)).toBe(input);
  });

  it("handles mention at end of text", () => {
    const input = "Please contact @[Alice](ou_alice)";
    const expected = 'Please contact <at user_id="ou_alice">Alice</at>';
    expect(formatMentionsForFeishu(input)).toBe(expected);
  });

  it("passes through Feishu native format unchanged", () => {
    const input = '<at user_id="ou_alice">Alice</at> hello';
    expect(formatMentionsForFeishu(input)).toBe(input);
  });
});
