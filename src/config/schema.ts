/** Configuration schema definitions using Zod */

import { z } from "zod";

// Enums
export const DmPolicySchema = z.enum(["open", "pairing", "allowlist"]);
export const GroupPolicySchema = z.enum(["open", "allowlist", "disabled"]);
export const DomainSchema = z.enum(["feishu", "lark"]);
export const ConnectionModeSchema = z.literal("websocket");
export const MarkdownModeSchema = z.enum(["native", "escape", "strip"]);
export const TableModeSchema = z.enum(["native", "ascii", "simple"]);
export const ChunkModeSchema = z.enum(["length", "newline"]);
export const HeartbeatVisibilitySchema = z.enum(["visible", "hidden"]);
export const ReplyToModeSchema = z.enum(["off", "first", "all"]);

// Sub-schemas
export const ToolPolicySchema = z
  .object({
    allow: z.array(z.string()).optional(),
    alsoAllow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // SDK compatibility: cannot set both allow and alsoAllow
    if (value?.allow && value.allow.length > 0 && value?.alsoAllow && value.alsoAllow.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "tools policy cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)",
      });
    }
  })
  .optional();

/** Tool policy by sender (key: senderId, value: ToolPolicy) */
export const ToolsBySenderSchema = z.record(z.string(), ToolPolicySchema).optional();

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

/** Streaming card settings */
export const StreamingCardSchema = z
  .object({
    enabled: z.boolean().optional(),
    title: z.string().optional(),
    /** Update interval in ms for streaming card (default: 200ms) */
    updateIntervalMs: z.number().int().positive().optional(),
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

/** Auto-reply settings for autonomous response in groups */
export const AutoReplyConfigSchema = z
  .object({
    /** Enable autonomous reply mode (agent decides whether to respond) */
    enabled: z.boolean().optional(),
    /** Minimum number of messages before considering auto-reply (default: 5) */
    minMessages: z.number().int().min(1).optional(),
    /** Minimum time window in ms since first message (default: 60000 = 1 min) */
    minTimeMs: z.number().int().positive().optional(),
    /** Debounce time in ms - wait for no new messages (default: 3000) */
    debounceMs: z.number().int().positive().optional(),
    /** System prompt hint for agent to decide whether to reply */
    systemHint: z.string().optional(),
  })
  .strict()
  .optional();

/** Group-specific configuration */
export const GroupConfigSchema = z
  .object({
    requireMention: z.boolean().optional(),
    tools: ToolPolicySchema,
    /** Per-sender tool policy override (key: senderId/name, value: ToolPolicy) */
    toolsBySender: ToolsBySenderSchema,
    skills: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    systemPrompt: z.string().optional(),
  })
  .strict();

// Account Schema (for multi-account support)

/** Account-level configuration (can override base config) */
export const AccountConfigSchema = z
  .object({
    // Account identity
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    appId: z.string().optional(),
    appSecret: z.string().optional(),
    appSecretFile: z.string().optional(),
    domain: DomainSchema.optional(),
    botName: z.string().optional(),

    // DM settings (account-level override)
    dmPolicy: DmPolicySchema.optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    dmHistoryLimit: z.number().int().min(0).optional(),

    // Group settings (account-level override)
    groupPolicy: GroupPolicySchema.optional(),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    requireMention: z.boolean().optional(),
    historyLimit: z.number().int().min(0).optional(),
    groups: z.record(z.string(), GroupConfigSchema.optional()).optional(),

    // Message formatting (account-level override)
    markdown: MarkdownConfigSchema,
    textChunkLimit: z.number().int().positive().optional(),
    chunkMode: ChunkModeSchema.optional(),
    blockStreamingCoalesce: StreamingCoalesceSchema,
    streamingCard: StreamingCardSchema,

    // Media (account-level override)
    mediaMaxMb: z.number().positive().optional(),
  })
  .strict();

// Main Configuration Schema

export const ConfigSchema = z
  .object({
    // Core settings
    enabled: z.boolean().optional(),
    appId: z.string().optional(),
    appSecret: z.string().optional(),
    appSecretFile: z.string().optional(),
    domain: DomainSchema.optional().default("feishu"),
    botName: z.string().optional(),
    // Connection (websocket only, webhook removed)
    connectionMode: ConnectionModeSchema.optional().default("websocket"),

    // Multi-account support
    accounts: z.record(z.string(), AccountConfigSchema).optional(),

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
    /** Auto-reply: agent autonomously decides whether to respond in groups */
    autoReply: AutoReplyConfigSchema,

    // Message formatting
    markdown: MarkdownConfigSchema,
    textChunkLimit: z.number().int().positive().optional(),
    chunkMode: ChunkModeSchema.optional(),
    blockStreamingCoalesce: StreamingCoalesceSchema,
    streamingCard: StreamingCardSchema,

    // Media
    mediaMaxMb: z.number().positive().optional(),
    /** Directory to save downloaded media files. Defaults to system temp directory. */
    mediaDir: z.string().optional(),

    // UI
    heartbeat: HeartbeatConfigSchema,
    capabilities: z.array(z.string()).optional(),

    // Debugging
    debugRawEvents: z.boolean().optional(),

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

// Type Exports (inferred from schemas)

export type Config = z.infer<typeof ConfigSchema>;
export type AccountConfig = z.infer<typeof AccountConfigSchema>;
export type GroupConfig = z.infer<typeof GroupConfigSchema>;
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;
export type DmConfig = z.infer<typeof DmConfigSchema>;
export type MarkdownConfig = z.infer<typeof MarkdownConfigSchema>;
export type StreamingCoalesce = z.infer<typeof StreamingCoalesceSchema>;
export type StreamingCard = z.infer<typeof StreamingCardSchema>;
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;
export type AutoReplyConfig = z.infer<typeof AutoReplyConfigSchema>;

// Constants

/** Default account ID when not using multi-account */
export const DEFAULT_ACCOUNT_ID = "default";

// Credential Resolution

/** Token source for credentials tracking */
export type TokenSource = "config" | "file" | "env" | "none";

export interface Credentials {
  appId: string;
  appSecret: string;
  domain: "feishu" | "lark";
  tokenSource: TokenSource;
}

/** Resolved account with merged configuration */
export interface ResolvedAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  credentials: Credentials | null;
  config: MergedAccountConfig;
}

/** Merged configuration from base + account override */
export interface MergedAccountConfig {
  domain: "feishu" | "lark";
  dmPolicy: "open" | "pairing" | "allowlist";
  groupPolicy: "open" | "allowlist" | "disabled";
  allowFrom: (string | number)[];
  groupAllowFrom: (string | number)[];
  requireMention: boolean;
  historyLimit?: number;
  dmHistoryLimit?: number;
  textChunkLimit?: number;
  chunkMode?: "length" | "newline";
  mediaMaxMb?: number;
  markdown?: MarkdownConfig;
  blockStreamingCoalesce?: StreamingCoalesce;
  streamingCard?: StreamingCard;
  groups?: Record<string, GroupConfig | undefined>;
}

/**
 * Normalize account ID (lowercase, trim, default if empty).
 */
export function normalizeAccountId(accountId?: string | null): string {
  const trimmed = accountId?.trim().toLowerCase();
  return trimmed || DEFAULT_ACCOUNT_ID;
}

/**
 * Read file contents if path exists, returns undefined otherwise.
 */
function readFileIfExists(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");
    return (fs.readFileSync(filePath, "utf-8") as string).trim();
  } catch {
    return undefined;
  }
}

/**
 * List all configured account IDs.
 */
export function listAccountIds(config: Config | undefined): string[] {
  const ids = new Set<string>();

  // Check if base config has credentials
  const baseConfigured = Boolean(
    config?.appId?.trim() && (config?.appSecret?.trim() || config?.appSecretFile)
  );
  const envConfigured = Boolean(
    process.env["FEISHU_APP_ID"]?.trim() && process.env["FEISHU_APP_SECRET"]?.trim()
  );
  if (baseConfigured || envConfigured) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }

  // Add account IDs from accounts object
  if (config?.accounts) {
    for (const id of Object.keys(config.accounts)) {
      ids.add(normalizeAccountId(id));
    }
  }

  return Array.from(ids);
}

/**
 * Get the default account ID.
 */
export function getDefaultAccountId(config: Config | undefined): string {
  const ids = listAccountIds(config);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

/**
 * Resolve credentials for a specific account.
 * Priority: account config > base config > env vars
 */
export function resolveCredentials(
  config: Config | undefined,
  accountId?: string | null
): Credentials | null {
  const normalizedId = normalizeAccountId(accountId);
  const isDefault = normalizedId === DEFAULT_ACCOUNT_ID;
  const accountCfg = config?.accounts?.[normalizedId];

  // Resolve appId
  const appId =
    accountCfg?.appId?.trim() ||
    config?.appId?.trim() ||
    (isDefault ? process.env["FEISHU_APP_ID"]?.trim() : undefined);

  // Resolve appSecret with source tracking
  let appSecret: string | undefined;
  let tokenSource: TokenSource = "none";

  // Try account config first
  if (accountCfg?.appSecret?.trim()) {
    appSecret = accountCfg.appSecret.trim();
    tokenSource = "config";
  } else if (accountCfg?.appSecretFile) {
    const fromFile = readFileIfExists(accountCfg.appSecretFile);
    if (fromFile) {
      appSecret = fromFile;
      tokenSource = "file";
    }
  }

  // Fall back to base config
  if (!appSecret && config?.appSecret?.trim()) {
    appSecret = config.appSecret.trim();
    tokenSource = "config";
  } else if (!appSecret && config?.appSecretFile) {
    const fromFile = readFileIfExists(config.appSecretFile);
    if (fromFile) {
      appSecret = fromFile;
      tokenSource = "file";
    }
  }

  // Fall back to env vars (only for default account)
  if (!appSecret && isDefault && process.env["FEISHU_APP_SECRET"]?.trim()) {
    appSecret = process.env["FEISHU_APP_SECRET"].trim();
    tokenSource = "env";
  }

  if (!appId || !appSecret) {
    return null;
  }

  const domain = accountCfg?.domain ?? config?.domain ?? "feishu";

  return { appId, appSecret, domain, tokenSource };
}

/**
 * Resolve full account configuration with merged settings.
 */
export function resolveAccount(
  config: Config | undefined,
  accountId?: string | null
): ResolvedAccount {
  const normalizedId = normalizeAccountId(accountId);
  const accountCfg = config?.accounts?.[normalizedId];
  const credentials = resolveCredentials(config, normalizedId);

  // Merge configuration: account overrides base
  const mergedConfig: MergedAccountConfig = {
    domain: accountCfg?.domain ?? config?.domain ?? "feishu",
    dmPolicy: accountCfg?.dmPolicy ?? config?.dmPolicy ?? "pairing",
    groupPolicy: accountCfg?.groupPolicy ?? config?.groupPolicy ?? "allowlist",
    allowFrom: accountCfg?.allowFrom ?? config?.allowFrom ?? [],
    groupAllowFrom: accountCfg?.groupAllowFrom ?? config?.groupAllowFrom ?? [],
    requireMention: accountCfg?.requireMention ?? config?.requireMention ?? true,
    historyLimit: accountCfg?.historyLimit ?? config?.historyLimit,
    dmHistoryLimit: accountCfg?.dmHistoryLimit ?? config?.dmHistoryLimit,
    textChunkLimit: accountCfg?.textChunkLimit ?? config?.textChunkLimit,
    chunkMode: accountCfg?.chunkMode ?? config?.chunkMode,
    mediaMaxMb: accountCfg?.mediaMaxMb ?? config?.mediaMaxMb,
    markdown: accountCfg?.markdown ?? config?.markdown,
    blockStreamingCoalesce: accountCfg?.blockStreamingCoalesce ?? config?.blockStreamingCoalesce,
    streamingCard: accountCfg?.streamingCard ?? config?.streamingCard,
    groups: { ...config?.groups, ...accountCfg?.groups },
  };

  const baseEnabled = config?.enabled !== false;
  const accountEnabled = accountCfg?.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  const name = accountCfg?.name ?? accountCfg?.botName ?? config?.botName;

  return {
    accountId: normalizedId,
    name,
    enabled,
    credentials,
    config: mergedConfig,
  };
}
