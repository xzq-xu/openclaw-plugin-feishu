/**
 * Configuration schema definitions using Zod.
 * All configuration types are derived from schemas via inference.
 */

import { z } from "zod";

// ============================================================================
// Enums
// ============================================================================

export const DmPolicySchema = z.enum(["open", "pairing", "allowlist"]);
export const GroupPolicySchema = z.enum(["open", "allowlist", "disabled"]);
export const DomainSchema = z.enum(["feishu", "lark"]);
export const ConnectionModeSchema = z.literal("websocket");
export const MarkdownModeSchema = z.enum(["native", "escape", "strip"]);
export const TableModeSchema = z.enum(["native", "ascii", "simple"]);
export const ChunkModeSchema = z.enum(["length", "newline"]);
export const HeartbeatVisibilitySchema = z.enum(["visible", "hidden"]);
export const ReplyToModeSchema = z.enum(["off", "first", "all"]);

// ============================================================================
// Sub-schemas
// ============================================================================

/** Tool policy for groups */
export const ToolPolicySchema = z
  .object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

/** DM-specific configuration */
export const DmConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    systemPrompt: z.string().optional(),
  })
  .strict()
  .optional();

/** Markdown rendering options */
export const MarkdownConfigSchema = z
  .object({
    mode: MarkdownModeSchema.optional(),
    tableMode: TableModeSchema.optional(),
  })
  .strict()
  .optional();

/** Streaming coalesce settings */
export const StreamingCoalesceSchema = z
  .object({
    enabled: z.boolean().optional(),
    minDelayMs: z.number().int().positive().optional(),
    maxDelayMs: z.number().int().positive().optional(),
  })
  .strict()
  .optional();

/** Heartbeat visibility settings */
export const HeartbeatConfigSchema = z
  .object({
    visibility: HeartbeatVisibilitySchema.optional(),
    intervalMs: z.number().int().positive().optional(),
  })
  .strict()
  .optional();

/** Group-specific configuration */
export const GroupConfigSchema = z
  .object({
    requireMention: z.boolean().optional(),
    tools: ToolPolicySchema,
    skills: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    systemPrompt: z.string().optional(),
  })
  .strict();

// ============================================================================
// Main Configuration Schema
// ============================================================================

export const ConfigSchema = z
  .object({
    // Core settings
    enabled: z.boolean().optional(),
    appId: z.string().optional(),
    appSecret: z.string().optional(),
    domain: DomainSchema.optional().default("feishu"),
    // Connection (websocket only, webhook removed)
    connectionMode: ConnectionModeSchema.optional().default("websocket"),

    // DM settings
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    dmHistoryLimit: z.number().int().min(0).optional(),
    dms: z.record(z.string(), DmConfigSchema).optional(),

    // Group settings
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    requireMention: z.boolean().optional().default(true),
    groups: z.record(z.string(), GroupConfigSchema.optional()).optional(),
    historyLimit: z.number().int().min(0).optional(),

    // Message formatting
    markdown: MarkdownConfigSchema,
    textChunkLimit: z.number().int().positive().optional(),
    chunkMode: ChunkModeSchema.optional(),
    blockStreamingCoalesce: StreamingCoalesceSchema,

    // Media
    mediaMaxMb: z.number().positive().optional(),

    // UI
    heartbeat: HeartbeatConfigSchema,
    capabilities: z.array(z.string()).optional(),

    // Threading
    replyToMode: ReplyToModeSchema.optional().default("first"),
    configWrites: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Validate that "open" DM policy requires wildcard in allowFrom
    if (value.dmPolicy === "open") {
      const allowFrom = value.allowFrom ?? [];
      const hasWildcard = allowFrom.some((entry) => String(entry).trim() === "*");
      if (!hasWildcard) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowFrom"],
          message: 'dmPolicy="open" requires allowFrom to include "*" wildcard',
        });
      }
    }
  });

// ============================================================================
// Type Exports (inferred from schemas)
// ============================================================================

export type Config = z.infer<typeof ConfigSchema>;
export type GroupConfig = z.infer<typeof GroupConfigSchema>;
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;
export type DmConfig = z.infer<typeof DmConfigSchema>;
export type MarkdownConfig = z.infer<typeof MarkdownConfigSchema>;
export type StreamingCoalesce = z.infer<typeof StreamingCoalesceSchema>;
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;

// ============================================================================
// Credential Resolution
// ============================================================================

export interface Credentials {
  appId: string;
  appSecret: string;
  domain: "feishu" | "lark";
}

/**
 * Resolve credentials from config, with environment variable fallback.
 * Returns null if required credentials are missing.
 */
export function resolveCredentials(config: Config | undefined): Credentials | null {
  const appId = config?.appId?.trim() || process.env["FEISHU_APP_ID"]?.trim();
  const appSecret = config?.appSecret?.trim() || process.env["FEISHU_APP_SECRET"]?.trim();

  if (!appId || !appSecret) {
    return null;
  }

  return {
    appId,
    appSecret,
    domain: config?.domain ?? "feishu",
  };
}
