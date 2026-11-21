
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { authenticateOrganisationRequest } from "../lib/supabase/server-auth";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
});

test("rejects requests without a Bearer token", async () => {
    const request = new Request("http://localhost/api/brands");

    const result = await authenticateOrganisationRequest(request);

    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.error.status, 401);
        assert.equal(result.error.code, "AUTHENTICATION_REQUIRED");
    }
});

test("rejects invalid user sessions", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL =
        "https://mock-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";

    globalThis.fetch = (async () =>
        Response.json(
            { message: "Invalid token" },
            { status: 401 },
        )) as typeof fetch;

    const request = new Request("http://localhost/api/brands", {
        headers: { Authorization: "Bearer invalid-token" },
    });

    const result = await authenticateOrganisationRequest(request);

    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.error.status, 401);
        assert.equal(result.error.code, "INVALID_SESSION");
    }
});

test("returns an authenticated user with an empty membership list", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL =
        "https://mock-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";

    const authorizationHeaders: string[] = [];

    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = String(url);
        const headers = new Headers(init?.headers);
        authorizationHeaders.push(headers.get("authorization") ?? "");

        if (requestUrl.endsWith("/auth/v1/user")) {
            return Response.json({
                id: "user-123",
                email: "reviewer@example.com",
            });
        }

        if (requestUrl.includes("/rest/v1/organisation_members")) {
            return Response.json([]);
        }

        return Response.json({ message: "Unexpected request" }, { status: 404 });
    }) as typeof fetch;

    const request = new Request("http://localhost/api/brands", {
        headers: { Authorization: "Bearer valid-user-jwt" },
    });

    const result = await authenticateOrganisationRequest(request);

    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.context.user.id, "user-123");
        assert.equal(result.context.accessToken, "valid-user-jwt");
        assert.deepEqual(result.context.memberships, []);
    }

    assert.deepEqual(authorizationHeaders, [
        "Bearer valid-user-jwt",
        "Bearer valid-user-jwt",
    ]);
});
