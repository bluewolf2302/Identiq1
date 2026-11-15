/**
 * Supabase Server Client & Environment Boundary for IdentIQ
 *
 * Designed for Next.js App Router API routes and Server Actions.
 * Never exposes SUPABASE_SERVICE_ROLE_KEY to the browser.
 */

import { PostgrestError, PostgrestResponse, normalizeSupabaseUrl } from "./client";

export function getSupabaseServerConfig() {
  if (typeof window !== "undefined") {
    throw new Error("getSupabaseServerConfig must only be called on the server.");
  }

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || null;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
  const supabaseUrl = rawUrl ? normalizeSupabaseUrl(rawUrl) : null;

  return {
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    configured: Boolean(supabaseUrl && (serviceRoleKey || anonKey)),
  };
}

function isJwt(token: string | null | undefined): boolean {
  return Boolean(token && token.includes(".") && token.split(".").length === 3);
}

/**
 * Execute server-side PostgREST request using either authenticated user token
 * or service-role key (server-only).
 */
export async function callServerPostgrest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
    useServiceRole?: boolean;
    userToken?: string | null;
  } = {}
): Promise<PostgrestResponse<T>> {
  const config = getSupabaseServerConfig();
  if (!config.configured || !config.supabaseUrl) {
    return {
      data: null,
      error: {
        code: "SERVER_NOT_CONFIGURED",
        message: "Supabase server variables are not configured in environment.",
      },
      status: 0,
    };
  }

  // 1. Determine apikey header:
  // For service-role operations, use serviceRoleKey (e.g. sb_secret_...) to bypass RLS.
  // For user or anonymous operations, use anonKey (e.g. sb_publishable_...).
  const apiKey = options.useServiceRole
    ? (config.serviceRoleKey || config.anonKey)
    : config.anonKey;

  if (!apiKey) {
    return {
      data: null,
      error: {
        code: "MISSING_SERVER_TOKEN",
        message: "No valid server token available for request.",
      },
      status: 401,
    };
  }

  const headers: Record<string, string> = {
    apikey: apiKey,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...options.headers,
  };

  // 2. Determine Authorization Bearer header:
  // - Real user session JWTs are preserved in the Authorization header.
  // - Legacy JWT service-role or anon keys (containing dots) are preserved.
  // - Opaque keys (sb_secret_... or sb_publishable_...) are NEVER sent as Bearer tokens,
  //   as PostgREST/Kong will attempt to parse them as JWTs and fail with "Invalid JWT".
  if (options.userToken) {
    headers.Authorization = `Bearer ${options.userToken}`;
  } else if (options.useServiceRole && config.serviceRoleKey && isJwt(config.serviceRoleKey)) {
    headers.Authorization = `Bearer ${config.serviceRoleKey}`;
  } else if (!options.useServiceRole && config.anonKey && isJwt(config.anonKey)) {
    headers.Authorization = `Bearer ${config.anonKey}`;
  }

  const url = `${config.supabaseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    const res = await fetch(url, {
      method: options.method || (options.body ? "POST" : "GET"),
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });

    const contentType = res.headers.get("content-type") || "";
    let parsed: unknown = null;
    if (contentType.includes("application/json")) {
      parsed = await res.json();
    } else {
      const text = await res.text();
      parsed = text ? { message: text } : null;
    }

    if (!res.ok) {
      const errObj = (parsed && typeof parsed === "object" ? parsed : {}) as PostgrestError;
      return {
        data: null,
        error: {
          code: errObj.code || `HTTP_${res.status}`,
          message: errObj.message || `Request failed with status ${res.status}`,
          details: errObj.details,
          hint: errObj.hint,
        },
        status: res.status,
      };
    }

    return {
      data: parsed as T,
      error: null,
      status: res.status,
    };
  } catch (err: unknown) {
    return {
      data: null,
      error: {
        code: "SERVER_NETWORK_ERROR",
        message: err instanceof Error ? err.message : "Server network error occurred",
      },
      status: 0,
    };
  }
}
