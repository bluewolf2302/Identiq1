/**
 * Supabase GoTrue Auth Client for IdentIQ
 *
 * Provides typed, zero-external-dependency authentication against Supabase GoTrue endpoints.
 * Handles sign-up, sign-in, token refresh, user verification, and persistent session lifecycle.
 * Never stores or exposes service-role keys.
 */

export interface SupabaseUser {
  id: string;
  email: string;
  role?: string;
  aud?: string;
  user_metadata?: {
    full_name?: string;
    role?: string;
    [key: string]: unknown;
  };
  created_at?: string;
  last_sign_in_at?: string;
}

export interface SupabaseSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number; // Unix timestamp in seconds
  tokenType: string;
  user: SupabaseUser;
}

export type AuthChangeEvent =
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "INITIAL_SESSION";

export type AuthStateChangeListener = (
  event: AuthChangeEvent,
  session: SupabaseSession | null
) => void;

export interface AuthError {
  message: string;
  status?: number;
  code?: string;
}

export interface AuthResponse<T> {
  data: T | null;
  error: AuthError | null;
}

const SESSION_STORAGE_KEY = "identiq_auth_session";
const LEGACY_STORAGE_KEY = "identiq_auth_token";
const listeners = new Set<AuthStateChangeListener>();

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

function getAuthUrl(): { baseUrl: string; anonKey: string } | null {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || null;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null;
  if (!baseUrl || !anonKey) return null;
  let normalized = baseUrl.replace(/\/+$/, "");
  try {
    normalized = new URL(baseUrl).origin;
  } catch {
    normalized = baseUrl.replace(/\/+(rest|auth)\/v1\/?$/i, "").replace(/\/+$/, "");
  }
  return {
    baseUrl: normalized,
    anonKey,
  };
}

function notifyAuthState(event: AuthChangeEvent, session: SupabaseSession | null): void {
  listeners.forEach((listener) => {
    try {
      listener(event, session);
    } catch (err) {
      console.error("[IdentIQ Auth] Listener error:", err);
    }
  });
}

/**
 * Retrieve cached session from storage.
 */
export function getStoredSession(): SupabaseSession | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.accessToken === "string" &&
      typeof parsed.refreshToken === "string" &&
      parsed.user &&
      typeof parsed.user.id === "string"
    ) {
      return parsed as SupabaseSession;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Store authenticated session in storage.
 */
export function setStoredSession(session: SupabaseSession | null): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (session) {
      storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      // Clean up legacy string token if present
      storage.removeItem(LEGACY_STORAGE_KEY);
    } else {
      storage.removeItem(SESSION_STORAGE_KEY);
      storage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota or access issues
  }
}

/**
 * Clear stored session and all auth tokens from browser storage.
 */
export function clearStoredSession(): void {
  setStoredSession(null);
}

/**
 * Register listener for auth state transitions.
 */
export function onAuthStateChange(listener: AuthStateChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Sign up a new user with email and password.
 */
export async function signUp(params: {
  email: string;
  password: string;
  metadata?: Record<string, unknown>;
}): Promise<AuthResponse<{ user: SupabaseUser | null; session: SupabaseSession | null }>> {
  const config = getAuthUrl();
  if (!config) {
    return {
      data: null,
      error: { message: "Supabase authentication is not configured in environment.", status: 0 },
    };
  }

  try {
    const res = await fetch(`${config.baseUrl}/auth/v1/signup`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: params.email.trim(),
        password: params.password,
        data: params.metadata || {},
      }),
    });

    const body = await res.json();
    if (!res.ok) {
      return {
        data: null,
        error: {
          message: body.msg || body.message || body.error_description || "Sign-up failed",
          status: res.status,
          code: body.error_code || body.code,
        },
      };
    }

    let session: SupabaseSession | null = null;
    if (body.access_token) {
      session = {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresIn: body.expires_in,
        expiresAt: body.expires_at || Math.floor(Date.now() / 1000) + body.expires_in,
        tokenType: body.token_type || "bearer",
        user: body.user,
      };
      setStoredSession(session);
      notifyAuthState("SIGNED_IN", session);
    }

    return {
      data: {
        user: body.user || null,
        session,
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: {
        message: err instanceof Error ? err.message : "Network error during sign-up",
        status: 0,
      },
    };
  }
}

/**
 * Sign in using email and password.
 */
export async function signInWithPassword(params: {
  email: string;
  password: string;
}): Promise<AuthResponse<{ user: SupabaseUser; session: SupabaseSession }>> {
  const config = getAuthUrl();
  if (!config) {
    return {
      data: null,
      error: { message: "Supabase authentication is not configured in environment.", status: 0 },
    };
  }

  try {
    const res = await fetch(`${config.baseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: params.email.trim(),
        password: params.password,
      }),
    });

    const body = await res.json();
    if (!res.ok) {
      return {
        data: null,
        error: {
          message: body.msg || body.error_description || body.message || "Invalid login credentials",
          status: res.status,
          code: body.error_code || body.code,
        },
      };
    }

    const session: SupabaseSession = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresIn: body.expires_in,
      expiresAt: body.expires_at || Math.floor(Date.now() / 1000) + body.expires_in,
      tokenType: body.token_type || "bearer",
      user: body.user,
    };

    setStoredSession(session);
    notifyAuthState("SIGNED_IN", session);

    return {
      data: { user: session.user, session },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: {
        message: err instanceof Error ? err.message : "Network error during sign-in",
        status: 0,
      },
    };
  }
}

/**
 * Refresh an active or expiring session.
 */
export async function refreshSession(
  refreshToken?: string
): Promise<AuthResponse<SupabaseSession>> {
  const config = getAuthUrl();
  if (!config) {
    return {
      data: null,
      error: { message: "Supabase is not configured.", status: 0 },
    };
  }

  const tokenToUse = refreshToken || getStoredSession()?.refreshToken;
  if (!tokenToUse) {
    return {
      data: null,
      error: { message: "No refresh token available", status: 401 },
    };
  }

  try {
    const res = await fetch(`${config.baseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: tokenToUse,
      }),
    });

    const body = await res.json();
    if (!res.ok) {
      clearStoredSession();
      notifyAuthState("SIGNED_OUT", null);
      return {
        data: null,
        error: {
          message: body.msg || body.error_description || "Session expired",
          status: res.status,
          code: body.error_code || body.code,
        },
      };
    }

    const session: SupabaseSession = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresIn: body.expires_in,
      expiresAt: body.expires_at || Math.floor(Date.now() / 1000) + body.expires_in,
      tokenType: body.token_type || "bearer",
      user: body.user,
    };

    setStoredSession(session);
    notifyAuthState("TOKEN_REFRESHED", session);

    return {
      data: session,
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: {
        message: err instanceof Error ? err.message : "Network error during token refresh",
        status: 0,
      },
    };
  }
}

/**
 * Validate access token with GoTrue /auth/v1/user endpoint.
 */
export async function getUser(accessToken?: string): Promise<AuthResponse<SupabaseUser>> {
  const config = getAuthUrl();
  if (!config) {
    return {
      data: null,
      error: { message: "Supabase is not configured.", status: 0 },
    };
  }

  const tokenToUse = accessToken || getStoredSession()?.accessToken;
  if (!tokenToUse) {
    return {
      data: null,
      error: { message: "No access token available", status: 401 },
    };
  }

  try {
    const res = await fetch(`${config.baseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${tokenToUse}`,
      },
    });

    const body = await res.json();
    if (!res.ok) {
      return {
        data: null,
        error: {
          message: body.msg || body.message || "Invalid or expired user session",
          status: res.status,
          code: body.error_code || body.code,
        },
      };
    }

    return {
      data: body as SupabaseUser,
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: {
        message: err instanceof Error ? err.message : "Network error validating user",
        status: 0,
      },
    };
  }
}

/**
 * Sign out and invalidate session on GoTrue.
 */
export async function signOut(): Promise<{ error: AuthError | null }> {
  const config = getAuthUrl();
  const session = getStoredSession();

  if (config && session?.accessToken) {
    try {
      await fetch(`${config.baseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
    } catch {
      // Ignore network errors on logout
    }
  }

  clearStoredSession();
  notifyAuthState("SIGNED_OUT", null);
  return { error: null };
}

/**
 * Comprehensive session validation and restoration:
 * 1. Checks stored session
 * 2. If expired or close to expiry, refreshes via refresh_token
 * 3. Validates against /auth/v1/user
 * 4. Clears storage if token is invalid or fabricated
 */
export async function restoreSession(): Promise<{
  session: SupabaseSession | null;
  error: AuthError | null;
}> {
  const stored = getStoredSession();
  if (!stored) {
    return { session: null, error: null };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const isExpiringSoon = stored.expiresAt - nowSec < 60; // Less than 60s remaining

  let currentSession = stored;

  if (isExpiringSoon) {
    const refreshRes = await refreshSession(stored.refreshToken);
    if (refreshRes.error || !refreshRes.data) {
      clearStoredSession();
      return { session: null, error: refreshRes.error };
    }
    currentSession = refreshRes.data;
  }

  // Validate session with GoTrue /auth/v1/user
  const userRes = await getUser(currentSession.accessToken);
  if (userRes.error || !userRes.data) {
    // Attempt one last refresh if token was rejected
    const refreshRes = await refreshSession(currentSession.refreshToken);
    if (refreshRes.data) {
      return { session: refreshRes.data, error: null };
    }
    clearStoredSession();
    return {
      session: null,
      error: userRes.error || { message: "Session validation failed", status: 401 },
    };
  }

  // Session is fully verified by server
  return { session: currentSession, error: null };
}
