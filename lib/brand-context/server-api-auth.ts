import type { NextRequest } from "next/server";
import { DEMO_CONFIG, checkDemoRateLimit } from "@/lib/demo/config";
import { callServerPostgrest, getSupabaseServerConfig } from "@/lib/supabase/server";

export type ServerTenantAuthResult =
  | {
      ok: true;
      mode: "DEMO_LOCAL" | "SHARED_DEMO" | "AUTHENTICATED_SUPABASE";
      organisationId: string;
      userId: string | null;
      actorName: string;
      role: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

function extractBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || null;
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "demo-client";
  }
  return req.headers.get("x-real-ip") || "demo-client";
}

export function canMutateBrandKnowledge(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return (
    normalized === "owner" ||
    normalized === "admin" ||
    normalized === "reviewer" ||
    normalized === "demo_reviewer"
  );
}

/**
 * Resolves the authoritative organisation tenant and actor role on the server.
 * Never trusts client-supplied organisation IDs when Supabase auth is configured.
 */
export async function resolveServerApiTenantContext(
  req: NextRequest,
  options: {
    requestedOrganisationId?: string | null;
    isMutation?: boolean;
  } = {},
): Promise<ServerTenantAuthResult> {
  const requestedOrgId = options.requestedOrganisationId?.trim() || null;
  const config = getSupabaseServerConfig();

  if (!config.configured || !config.supabaseUrl) {
    return {
      ok: true,
      mode: "DEMO_LOCAL",
      organisationId: requestedOrgId || "local-org",
      userId: null,
      actorName: DEMO_CONFIG.DEFAULT_ACTOR,
      role: "owner",
    };
  }

  const token = extractBearerToken(req);
  if (!token) {
    if (requestedOrgId && requestedOrgId !== DEMO_CONFIG.ORGANISATION_ID) {
      return {
        ok: false,
        status: 401,
        error: "Authentication is required to access customer organisation knowledge.",
      };
    }

    if (options.isMutation) {
      const rate = checkDemoRateLimit(getClientIp(req), "mutation");
      if (!rate.allowed) {
        return {
          ok: false,
          status: 429,
          error: `Demo rate limit exceeded. Try again in ${rate.resetSeconds}s.`,
        };
      }
    }

    return {
      ok: true,
      mode: "SHARED_DEMO",
      organisationId: DEMO_CONFIG.ORGANISATION_ID,
      userId: null,
      actorName: DEMO_CONFIG.DEFAULT_ACTOR,
      role: "demo_reviewer",
    };
  }

  if (!config.anonKey) {
    return {
      ok: false,
      status: 500,
      error: "Supabase public key is missing on the server for token verification.",
    };
  }

  try {
    const userRes = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!userRes.ok) {
      return {
        ok: false,
        status: 401,
        error: "Your authentication session is invalid or expired.",
      };
    }

    const userBody = (await userRes.json()) as {
      id?: string;
      email?: string;
      user_metadata?: { full_name?: string };
    };

    if (!userBody.id) {
      return {
        ok: false,
        status: 401,
        error: "Authenticated user identity could not be verified.",
      };
    }

    const membershipRes = await callServerPostgrest<
      Array<{ organisation_id: string; role: string }>
    >(
      `/rest/v1/organisation_members?user_id=eq.${encodeURIComponent(userBody.id)}&select=organisation_id,role`,
      { useServiceRole: true },
    );

    if (membershipRes.error) {
      return {
        ok: false,
        status: 502,
        error: "Unable to verify organisation membership.",
      };
    }

    const memberships = Array.isArray(membershipRes.data) ? membershipRes.data : [];
    if (memberships.length === 0) {
      return {
        ok: false,
        status: 403,
        error: "Account does not belong to an organisation.",
      };
    }

    let selectedMembership = memberships[0]!;
    if (requestedOrgId) {
      const matched = memberships.find(
        (m) => m.organisation_id === requestedOrgId,
      );
      if (!matched) {
        return {
          ok: false,
          status: 403,
          error: "You do not have access to the requested organisation.",
        };
      }
      selectedMembership = matched;
    }

    if (options.isMutation && !canMutateBrandKnowledge(selectedMembership.role)) {
      return {
        ok: false,
        status: 403,
        error: `Role "${selectedMembership.role}" cannot modify or publish brand knowledge.`,
      };
    }

    return {
      ok: true,
      mode: "AUTHENTICATED_SUPABASE",
      organisationId: selectedMembership.organisation_id,
      userId: userBody.id,
      actorName:
        userBody.user_metadata?.full_name ||
        userBody.email ||
        "Authenticated Reviewer",
      role: selectedMembership.role,
    };
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Authentication verification service is temporarily unavailable.",
    };
  }
}
