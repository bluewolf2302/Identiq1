/**
 * Supabase Browser Client & Configuration Boundary for IdentIQ
 *
 * Provides typed access to Supabase PostgREST endpoints without requiring
 * external SDK dependencies or exposing server service keys.
 * Supports three explicit operational modes:
 * 1. DEMO_LOCAL: No Supabase configured; in-memory/localStorage prototype active.
 * 2. CONFIGURED_UNAUTHENTICATED: Supabase URL/key configured, but no user authenticated.
 * 3. AUTHENTICATED_SUPABASE: Authenticated user with valid organisation tenancy.
 */

import { getStoredSession, clearStoredSession, SupabaseSession } from "./auth";

export type PersistenceMode =
  | "DEMO_LOCAL"
  | "CONFIGURED_UNAUTHENTICATED"
  | "SHARED_DEMO"
  | "AUTHENTICATED_NO_ORGANISATION"
  | "AUTHENTICATED_SUPABASE";

export interface SupabaseConfigStatus {
  configured: boolean;
  urlPresent: boolean;
  anonKeyPresent: boolean;
  mode: PersistenceMode;
  supabaseUrl: string | null;
}

export const DEMO_MODE_STORAGE_KEY = "identiq_demo_mode";

/**
 * Normalize Supabase project URL to its root origin without trailing service paths.
 */
export function normalizeSupabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin;
  } catch {
    return rawUrl.replace(/\/+(rest|auth)\/v1\/?$/i, "").replace(/\/+$/, "");
  }
}

/**
 * Get stored demo mode preference ("shared" or "local").
 */
export function getDemoModePreference(): "shared" | "local" | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const val = storage.getItem(DEMO_MODE_STORAGE_KEY);
    return val === "shared" || val === "local" ? val : null;
  } catch {
    return null;
  }
}

/**
 * Set demo mode preference in browser storage.
 */
export function setDemoModePreference(pref: "shared" | "local" | null): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (pref) {
      storage.setItem(DEMO_MODE_STORAGE_KEY, pref);
    } else {
      storage.removeItem(DEMO_MODE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage issues
  }
}

export interface PostgrestError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export interface PostgrestResponse<T> {
  data: T | null;
  error: PostgrestError | null;
  status: number;
}

/**
 * Inspect runtime environment and auth state to determine persistence mode.
 * Supports checking both session validity and organization tenancy.
 */
export function getSupabaseIntegrationStatus(
  sessionOrToken?: SupabaseSession | string | boolean | null,
  hasOrganisation?: boolean,
  isSharedDemo?: boolean
): SupabaseConfigStatus {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || null;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null;
  const urlPresent = Boolean(rawUrl);
  const anonKeyPresent = Boolean(anonKey);
  const configured = urlPresent && anonKeyPresent;
  const supabaseUrl = rawUrl ? normalizeSupabaseUrl(rawUrl) : null;

  let mode: PersistenceMode = "DEMO_LOCAL";
  if (configured) {
    const hasSession =
      typeof sessionOrToken === "boolean"
        ? sessionOrToken
        : typeof sessionOrToken === "string"
        ? Boolean(sessionOrToken)
        : Boolean(sessionOrToken || getStoredSession());

    if (!hasSession) {
      const demoPref = isSharedDemo ?? (getDemoModePreference() === "shared");
      if (demoPref) {
        mode = "SHARED_DEMO";
      } else {
        mode = "CONFIGURED_UNAUTHENTICATED";
      }
    } else if (hasOrganisation === false) {
      mode = "AUTHENTICATED_NO_ORGANISATION";
    } else {
      mode = "AUTHENTICATED_SUPABASE";
    }
  }

  return {
    configured,
    urlPresent,
    anonKeyPresent,
    mode,
    supabaseUrl,
  };
}

function getStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as unknown as { localStorage?: Storage }).localStorage
  ) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return null;
}

/**
 * Retrieve cached auth token from verified session.
 */
export function getClientAuthToken(): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const session = getStoredSession();
    if (session?.accessToken) {
      return session.accessToken;
    }
    // Fallback only if legacy token is present
    return storage.getItem("identiq_auth_token") || null;
  } catch {
    return null;
  }
}

/**
 * Set or clear auth token in browser storage.
 */
export function setClientAuthToken(token: string | null): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (token) {
      storage.setItem("identiq_auth_token", token);
    } else {
      storage.removeItem("identiq_auth_token");
      clearStoredSession();
    }
  } catch {
    // Ignore storage restrictions
  }
}

/**
 * Generic typed PostgREST caller for RPC and Table operations.
 */
export async function callPostgrest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
    authToken?: string | null;
  } = {}
): Promise<PostgrestResponse<T>> {
  const status = getSupabaseIntegrationStatus(options.authToken);
  if (!status.configured || !status.supabaseUrl) {
    return {
      data: null,
      error: {
        code: "NOT_CONFIGURED",
        message: "Supabase integration is not configured in environment.",
      },
      status: 0,
    };
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const userToken = options.authToken ?? getClientAuthToken();
  const method = options.method || (options.body ? "POST" : "GET");

  const headers: Record<string, string> = {
    apikey: anonKey,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...options.headers,
  };

  // Only send Authorization header when a genuine user session JWT exists or anonKey is a legacy JWT.
  // Never send opaque sb_publishable_... keys as Bearer tokens.
  if (userToken) {
    headers.Authorization = `Bearer ${userToken}`;
  } else if (anonKey && anonKey.includes(".") && anonKey.split(".").length === 3) {
    headers.Authorization = `Bearer ${anonKey}`;
  }

  const url = `${status.supabaseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
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
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "Network error occurred",
      },
      status: 0,
    };
  }
}
