/**
 * Shared Demo Workspace Configuration & Boundary Enforcement
 *
 * Defines the dedicated demo tenancy identifiers, strict server-side scoping,
 * rate limiting controls, and demo validation rules for IdentIQ.
 */

export const DEMO_CONFIG = {
  // Deterministic dedicated UUIDs for demo tenancy (isolated from customer organisations)
  ORGANISATION_ID: process.env.DEMO_ORGANISATION_ID || "e0000000-0000-0000-0000-000000000001",
  ORGANISATION_NAME: "IdentIQ Shared Demo Workspace",
  BRAND_ID: process.env.DEMO_BRAND_ID || "b0000000-0000-0000-0000-000000000001",
  BRAND_NAME: "Teralune Bio (Shared Demo)",
  DEFAULT_ACTOR: "Guest Reviewer (Demo)",
  DEFAULT_ROLE: "Guest Reviewer",

  // Rate Limiting (per IP window)
  RATE_LIMIT: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_READS_PER_WINDOW: 120,
    MAX_MUTATIONS_PER_WINDOW: 30,
    MAX_RESETS_PER_WINDOW: 5,
  },
} as const;

// In-memory rate-limiter store for server routes
interface ClientRateRecord {
  readCount: number;
  mutationCount: number;
  resetCount: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, ClientRateRecord>();

/**
 * Clean up stale rate limit entries every 5 minutes
 */
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (now - record.windowStart > DEMO_CONFIG.RATE_LIMIT.WINDOW_MS * 2) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}

export type RateLimitAction = "read" | "mutation" | "reset";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

/**
 * Check and record a client request against demo rate limits
 */
export function checkDemoRateLimit(clientId: string, action: RateLimitAction): RateLimitResult {
  const now = Date.now();
  let record = rateLimitStore.get(clientId);

  if (!record || now - record.windowStart > DEMO_CONFIG.RATE_LIMIT.WINDOW_MS) {
    record = {
      readCount: 0,
      mutationCount: 0,
      resetCount: 0,
      windowStart: now,
    };
    rateLimitStore.set(clientId, record);
  }

  const elapsed = now - record.windowStart;
  const resetSeconds = Math.max(1, Math.ceil((DEMO_CONFIG.RATE_LIMIT.WINDOW_MS - elapsed) / 1000));

  let allowed = true;
  let remaining = 0;

  if (action === "read") {
    record.readCount += 1;
    allowed = record.readCount <= DEMO_CONFIG.RATE_LIMIT.MAX_READS_PER_WINDOW;
    remaining = Math.max(0, DEMO_CONFIG.RATE_LIMIT.MAX_READS_PER_WINDOW - record.readCount);
  } else if (action === "mutation") {
    record.mutationCount += 1;
    allowed = record.mutationCount <= DEMO_CONFIG.RATE_LIMIT.MAX_MUTATIONS_PER_WINDOW;
    remaining = Math.max(0, DEMO_CONFIG.RATE_LIMIT.MAX_MUTATIONS_PER_WINDOW - record.mutationCount);
  } else if (action === "reset") {
    record.resetCount += 1;
    allowed = record.resetCount <= DEMO_CONFIG.RATE_LIMIT.MAX_RESETS_PER_WINDOW;
    remaining = Math.max(0, DEMO_CONFIG.RATE_LIMIT.MAX_RESETS_PER_WINDOW - record.resetCount);
  }

  return { allowed, remaining, resetSeconds };
}

/**
 * Validate that a requested organisation ID belongs strictly to the demo workspace.
 * Rejects any caller attempt to target customer organisations.
 */
export function assertDemoOrganisation(orgId: string | null | undefined): void {
  if (orgId && orgId !== DEMO_CONFIG.ORGANISATION_ID) {
    throw new Error(
      `CROSS_ORGANISATION_ACCESS_DENIED: Demo workspace operations cannot access organization "${orgId}".`
    );
  }
}
