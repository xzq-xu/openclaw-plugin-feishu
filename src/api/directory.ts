/** User and group directory operations */

import type { Config } from "../config/schema.js";
import type { DirectoryUser, DirectoryGroup, ListDirectoryParams } from "../types/index.js";
import { getApiClient } from "./client.js";
import { resolveCredentials } from "../config/schema.js";
import { normalizeTarget } from "./messages.js";

const userCache = new Map<string, DirectoryUser>();

function collectIds(sources: (Record<string, unknown> | (string | number)[] | undefined)[]): Set<string> {
  const ids = new Set<string>();
  for (const src of sources) {
    if (!src) continue;
    const entries = Array.isArray(src) ? src : Object.keys(src);
    for (const e of entries) { const t = String(e).trim(); if (t && t !== "*") ids.add(t); }
  }
  return ids;
}

function filterIds(ids: Set<string>, query: string, limit: number | undefined, transform?: (id: string) => string): string[] {
  const q = query.trim().toLowerCase();
  return Array.from(ids)
    .map((id) => transform ? transform(id) : id)
    .filter((id) => !q || id.toLowerCase().includes(q))
    .slice(0, limit && limit > 0 ? limit : undefined);
}

export function listUsersFromConfig(config: Config, params: ListDirectoryParams): DirectoryUser[] {
  return filterIds(collectIds([config.allowFrom, config.dms]), params.query ?? "", params.limit, (id) => normalizeTarget(id) ?? id)
    .map((id) => ({ kind: "user" as const, id }));
}

export function listGroupsFromConfig(config: Config, params: ListDirectoryParams): DirectoryGroup[] {
  return filterIds(collectIds([config.groups, config.groupAllowFrom]), params.query ?? "", params.limit)
    .map((id) => ({ kind: "group" as const, id }));
}

interface GetUserResponse { code?: number; msg?: string; data?: { user?: { open_id?: string; name?: string; en_name?: string; nickname?: string } } }

async function getUserById(config: Config, userId: string, idType: "open_id" | "union_id"): Promise<DirectoryUser | null> {
  const cached = userCache.get(userId);
  if (cached) return cached;
  if (!resolveCredentials(config)) return null;
  try {
    const response = (await getApiClient(config).contact.user.get({ path: { user_id: userId }, params: { user_id_type: idType } })) as GetUserResponse;
    if (response.code !== 0) {
      console.warn(`[feishu] getUser(${idType}) failed: code=${response.code} msg=${response.msg} (${userId})`);
      return null;
    }
    const user = response.data?.user;
    if (!user) return null;
    const result: DirectoryUser = { kind: "user", id: user.open_id ?? userId, name: user.name ?? user.en_name ?? user.nickname ?? undefined };
    userCache.set(userId, result);
    return result;
  } catch (e) {
    console.warn(`[feishu] getUser(${idType}) exception: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export async function getUserByOpenId(config: Config, openId: string): Promise<DirectoryUser | null> {
  return getUserById(config, openId, "open_id");
}

export async function getUserByUnionId(config: Config, unionId: string): Promise<DirectoryUser | null> {
  return getUserById(config, unionId, "union_id");
}

export async function listUsers(config: Config, params: ListDirectoryParams): Promise<DirectoryUser[]> {
  if (!resolveCredentials(config)) return listUsersFromConfig(config, params);
  try {
    const limit = params.limit ?? 50, query = params.query?.trim().toLowerCase() ?? "", users: DirectoryUser[] = [];
    for await (const page of await getApiClient(config).contact.user.listWithIterator({ params: { page_size: Math.min(limit, 50) } })) {
      for (const u of page?.items ?? []) {
        if (!u.open_id) continue;
        if (!query || u.open_id.toLowerCase().includes(query) || (u.name ?? "").toLowerCase().includes(query))
          users.push({ kind: "user", id: u.open_id, name: u.name ?? undefined });
        if (users.length >= limit) break;
      }
      if (users.length >= limit) break;
    }
    return users;
  } catch { return listUsersFromConfig(config, params); }
}

export async function listGroups(config: Config, params: ListDirectoryParams): Promise<DirectoryGroup[]> {
  if (!resolveCredentials(config)) return listGroupsFromConfig(config, params);
  try {
    const limit = params.limit ?? 50, query = params.query?.trim().toLowerCase() ?? "", groups: DirectoryGroup[] = [];
    for await (const page of await getApiClient(config).im.chat.listWithIterator({ params: { page_size: Math.min(limit, 100) } })) {
      for (const c of page?.items ?? []) {
        if (!c.chat_id) continue;
        if (!query || c.chat_id.toLowerCase().includes(query) || (c.name ?? "").toLowerCase().includes(query))
          groups.push({ kind: "group", id: c.chat_id, name: c.name ?? undefined });
        if (groups.length >= limit) break;
      }
      if (groups.length >= limit) break;
    }
    return groups;
  } catch { return listGroupsFromConfig(config, params); }
}
