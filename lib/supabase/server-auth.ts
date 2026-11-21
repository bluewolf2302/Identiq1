
import { getUser, type SupabaseUser } from "./auth";
import { callServerPostgrest } from "./server";

export type OrganisationMembership = {
    organisation_id: string;
    role: "owner" | "admin" | "reviewer" | "contributor";
};

export type AuthenticatedOrganisationContext = {
    user: SupabaseUser;
    accessToken: string;
    memberships: OrganisationMembership[];
};

export type ServerAuthError = {
    status: number;
    code: string;
    message: string;
};

export type ServerAuthResult =
    | {
        ok: true;
        context: AuthenticatedOrganisationContext;
    }
    | {
        ok: false;
        error: ServerAuthError;
    };

export async function authenticateOrganisationRequest(
    request: Request,
): Promise<ServerAuthResult> {
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);
    const accessToken = match?.[1];

    if (!accessToken) {
        return {
            ok: false,
            error: {
                status: 401,
                code: "AUTHENTICATION_REQUIRED",
                message: "A valid Bearer access token is required.",
            },
        };
    }

    const userResult = await getUser(accessToken);

    if (userResult.error || !userResult.data) {
        const status = userResult.error?.status === 0 ? 503 : 401;

        return {
            ok: false,
            error: {
                status,
                code: status === 503 ? "AUTH_SERVICE_UNAVAILABLE" : "INVALID_SESSION",
                message:
                    status === 503
                        ? "Authentication service is unavailable."
                        : "The user session is invalid or expired.",
            },
        };
    }

    const membershipResult = await callServerPostgrest<
        OrganisationMembership[]
    >(
        "/rest/v1/organisation_members?select=organisation_id,role&order=created_at.asc",
        { userToken: accessToken },
    );

    if (membershipResult.error) {
        return {
            ok: false,
            error: {
                status: membershipResult.status || 503,
                code: membershipResult.error.code || "MEMBERSHIP_LOOKUP_FAILED",
                message: "Could not verify organisation membership.",
            },
        };
    }

    return {
        ok: true,
        context: {
            user: userResult.data,
            accessToken,
            memberships: membershipResult.data ?? [],
        },
    };
}
