/**
 * Feishu API client wrapper.
 * Provides singleton access to the Lark SDK client with connection pooling.
 */

import * as Lark from "@larksuiteoapi/node-sdk";
import type { Config, Credentials } from "../config/schema.js";
import { resolveCredentials } from "../config/schema.js";
import type { ProbeResult } from "../types/index.js";

// ============================================================================
// Client Cache (Singleton Pattern)
// ============================================================================

interface CachedClient {
  client: Lark.Client;
  credentials: Credentials;
}

let cachedClient: CachedClient | null = null;

/**
 * Resolve Lark domain enum from config.
 */
function resolveDomain(domain: "feishu" | "lark"): Lark.Domain {
  return domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
}

/**
 * Create or retrieve the Feishu API client.
 * Uses singleton pattern with credential-based cache invalidation.
 *
 * @throws Error if credentials are not configured
 */
export function getApiClient(config: Config): Lark.Client {
  const credentials = resolveCredentials(config);
  if (!credentials) {
    throw new Error("Feishu credentials not configured (appId, appSecret required)");
  }

  // Return cached client if credentials match
  if (
    cachedClient &&
    cachedClient.credentials.appId === credentials.appId &&
    cachedClient.credentials.appSecret === credentials.appSecret &&
    cachedClient.credentials.domain === credentials.domain
  ) {
    return cachedClient.client;
  }

  // Create new client
  const client = new Lark.Client({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveDomain(credentials.domain),
  });

  cachedClient = { client, credentials };
  return client;
}

/**
 * Create a WebSocket client for real-time events.
 *
 * @throws Error if credentials are not configured
 */
export function createWsClient(config: Config): Lark.WSClient {
  const credentials = resolveCredentials(config);
  if (!credentials) {
    throw new Error("Feishu credentials not configured (appId, appSecret required)");
  }

  return new Lark.WSClient({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    domain: resolveDomain(credentials.domain),
    loggerLevel: Lark.LoggerLevel.info,
  });
}



/**
 * Clear the client cache.
 * Useful for testing or when credentials change.
 */
export function clearClientCache(): void {
  cachedClient = null;
}

/**
 * Probe the Feishu API to verify credentials and get bot info.
 */
export async function probeConnection(config: Config | undefined): Promise<ProbeResult> {
  if (!config) {
    return { ok: false, error: "Configuration not provided" };
  }

  const credentials = resolveCredentials(config);
  if (!credentials) {
    return { ok: false, error: "Credentials not configured" };
  }

  try {
    const client = getApiClient(config);

    // Use bot info endpoint to verify credentials and get bot identity
    const response = (await client.request({
      method: "GET",
      url: "/open-apis/bot/v3/info",
    })) as {
      code?: number;
      msg?: string;
      bot?: {
        app_name?: string;
        open_id?: string;
      };
    };

    if (response.code !== 0) {
      return {
        ok: false,
        error: response.msg ?? `API error code ${response.code}`,
        appId: credentials.appId,
      };
    }

    return {
      ok: true,
      appId: credentials.appId,
      botName: response.bot?.app_name,
      botOpenId: response.bot?.open_id,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      appId: credentials.appId,
    };
  }
}
