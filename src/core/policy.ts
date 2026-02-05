/**
 * Access policy engine for DM and group messages.
 */

import type { Config, GroupConfig } from "../config/schema.js";

// Types

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

export interface AllowlistMatch {
  allowed: boolean;
  matchKey?: string;
  matchSource?: "wildcard" | "id" | "name";
}

// Allowlist Matching

/**
 * Check if a sender matches an allowlist.
 */
export function matchAllowlist(
  allowFrom: (string | number)[],
  senderId: string,
  senderName?: string | null
): AllowlistMatch {
  const normalized = allowFrom.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);

  if (normalized.length === 0) {
    return { allowed: false };
  }

  // Check for wildcard
  if (normalized.includes("*")) {
    return { allowed: true, matchKey: "*", matchSource: "wildcard" };
  }

  // Check by ID
  const lowerSenderId = senderId.toLowerCase();
  if (normalized.includes(lowerSenderId)) {
    return { allowed: true, matchKey: lowerSenderId, matchSource: "id" };
  }

  // Check by name
  const lowerName = senderName?.toLowerCase();
  if (lowerName && normalized.includes(lowerName)) {
    return { allowed: true, matchKey: lowerName, matchSource: "name" };
  }

  return { allowed: false };
}

// DM Policy

/**
 * Check if a DM from a sender is allowed.
 */
export function checkDmPolicy(
  config: Config,
  senderId: string,
  senderName?: string | null
): PolicyResult {
  const policy = config.dmPolicy ?? "pairing";

  switch (policy) {
    case "open":
      return { allowed: true };

    case "pairing":
      // Pairing requires verification flow handled elsewhere
      return { allowed: true };

    case "allowlist": {
      const allowFrom = config.allowFrom ?? [];
      const match = matchAllowlist(allowFrom, senderId, senderName);
      return match.allowed
        ? { allowed: true }
        : { allowed: false, reason: "Sender not in DM allowlist" };
    }

    default:
      return { allowed: false, reason: `Unknown DM policy: ${policy}` };
  }
}

// Group Policy

/**
 * Resolve group-specific configuration.
 */
export function resolveGroupConfig(
  config: Config,
  groupId: string | null | undefined
): GroupConfig | undefined {
  if (!groupId) return undefined;

  const groups = config.groups ?? {};
  const trimmed = groupId.trim();

  // Direct match
  const direct = groups[trimmed];
  if (direct) return direct;

  // Case-insensitive match
  const lowered = trimmed.toLowerCase();
  const matchKey = Object.keys(groups).find((key) => key.toLowerCase() === lowered);
  return matchKey ? groups[matchKey] : undefined;
}

/**
 * Check if a message in a group from a sender is allowed.
 */
export function checkGroupPolicy(
  config: Config,
  groupId: string,
  senderId: string,
  senderName?: string | null
): PolicyResult {
  const policy = config.groupPolicy ?? "allowlist";

  switch (policy) {
    case "disabled":
      return { allowed: false, reason: "Group messages disabled" };

    case "open":
      return { allowed: true };

    case "allowlist": {
      // Check group-specific allowlist first
      const groupConfig = resolveGroupConfig(config, groupId);
      const groupAllowFrom = groupConfig?.allowFrom ?? config.groupAllowFrom ?? [];

      if (groupAllowFrom.length === 0) {
        // No allowlist configured, deny by default
        return {
          allowed: false,
          reason: "No group allowlist configured",
        };
      }

      const match = matchAllowlist(groupAllowFrom, senderId, senderName);
      return match.allowed
        ? { allowed: true }
        : { allowed: false, reason: "Sender not in group allowlist" };
    }

    default:
      return { allowed: false, reason: `Unknown group policy: ${policy}` };
  }
}

// Mention Policy

/**
 * Check if an @mention is required for the given context.
 */
export function shouldRequireMention(
  config: Config,
  chatType: "p2p" | "group",
  groupId?: string | null
): boolean {
  // Never require mention in DMs
  if (chatType === "p2p") {
    return false;
  }

  // Check group-specific config
  const groupConfig = resolveGroupConfig(config, groupId);
  if (groupConfig?.requireMention !== undefined) {
    return groupConfig.requireMention;
  }

  // Fall back to global config
  return config.requireMention ?? true;
}

// Tool Policy

export interface ToolPolicySender {
  senderId?: string | null;
  senderName?: string | null;
}

/**
 * Normalize sender key for matching.
 */
function normalizeSenderKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  // Remove @ prefix if present
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return withoutAt.toLowerCase();
}

/**
 * Resolve tool policy by sender from toolsBySender config.
 * Returns undefined if no match found.
 */
export function resolveToolsBySender(
  toolsBySender: Record<string, { allow?: string[]; deny?: string[] } | undefined> | undefined,
  sender: ToolPolicySender
): { allow?: string[]; deny?: string[] } | undefined {
  if (!toolsBySender) return undefined;

  const entries = Object.entries(toolsBySender);
  if (entries.length === 0) return undefined;

  // Build normalized map and extract wildcard
  const normalized = new Map<string, { allow?: string[]; deny?: string[] }>();
  let wildcard: { allow?: string[]; deny?: string[] } | undefined;

  for (const [rawKey, policy] of entries) {
    if (!policy) continue;
    const key = normalizeSenderKey(rawKey);
    if (!key) continue;
    if (key === "*") {
      wildcard = policy;
      continue;
    }
    if (!normalized.has(key)) {
      normalized.set(key, policy);
    }
  }

  // Build candidate keys from sender info
  const candidates: string[] = [];
  if (sender.senderId?.trim()) candidates.push(sender.senderId.trim());
  if (sender.senderName?.trim()) candidates.push(sender.senderName.trim());

  // Try to match candidates
  for (const candidate of candidates) {
    const key = normalizeSenderKey(candidate);
    if (!key) continue;
    const match = normalized.get(key);
    if (match) return match;
  }

  // Fall back to wildcard
  return wildcard;
}

/**
 * Get tool policy for a group, with per-sender override support.
 * Priority: toolsBySender[senderId] > tools > wildcard toolsBySender["*"]
 */
export function resolveGroupToolPolicy(
  config: Config,
  groupId: string | null | undefined,
  sender?: ToolPolicySender
): { allow?: string[]; deny?: string[] } | undefined {
  const groupConfig = resolveGroupConfig(config, groupId);

  // Try sender-specific policy first
  if (sender && groupConfig?.toolsBySender) {
    const senderPolicy = resolveToolsBySender(groupConfig.toolsBySender, sender);
    if (senderPolicy) return senderPolicy;
  }

  // Fall back to group tools
  if (groupConfig?.tools) {
    return groupConfig.tools;
  }

  // Try wildcard group config ("*")
  const wildcardConfig = resolveGroupConfig(config, "*");
  if (sender && wildcardConfig?.toolsBySender) {
    const wildcardSenderPolicy = resolveToolsBySender(wildcardConfig.toolsBySender, sender);
    if (wildcardSenderPolicy) return wildcardSenderPolicy;
  }

  return wildcardConfig?.tools;
}
