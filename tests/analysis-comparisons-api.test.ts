import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { afterEach } from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/analysis-comparisons/route";
import { SupabaseReviewRepository } from "../lib/repositories/review-repository";
import { clearStoredSession, setStoredSession } from "../lib/supabase/auth";

const organisationId = "11111111-1111-4111-8111-111111111111";
const otherOrganisationId = "22222222-2222-4222-8222-222222222222";
const reviewId = "review-1";
const previousRunId = "run-previous";
const currentRunId = "run-current";

const comparison = {
  previousRunId,
  currentRunId,
  previousStatus: "COMPLETED",
  currentStatus: "PARTIAL",
  findings: [],
  summary: { added: 0, removed: 0, changed: 0, unchanged: 0 },
};

const originalFetch = globalThis.fetch;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSupabaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  }
  if (originalAnonKey === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  }
});

function installFetch(
  postgrest: (url: URL, init: RequestInit) => Response | Promise<Response>,
) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: "user-1", email: "user@example.test" });
    }
    return postgrest(url, init ?? {});
  }) as typeof fetch;
}

function request(
  method: "GET" | "POST",
  options: { authenticated?: boolean; body?: unknown; review?: string } = {},
) {
  const headers = new Headers();
  if (options.authenticated) headers.set("Authorization", "Bearer valid-user-token");
  if (method === "POST") headers.set("Content-Type", "application/json");
  const url = new URL("http://localhost/api/analysis-comparisons");
  if (method === "GET") url.searchParams.set("reviewId", options.review ?? reviewId);
  return new NextRequest(url, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
  });
}

function ok(data: unknown, status = 200) {
  return Response.json(data, { status });
}

test("comparison GET and POST explicitly reject unauthenticated requests", async () => {
  const responseGet = await GET(
    new NextRequest("http://localhost/api/analysis-comparisons"),
  );
  const responsePost = await POST(request("POST", { body: {} }));
  assert.equal(responseGet.status, 401);
  assert.equal(responsePost.status, 401);
});

test("comparison POST rejects incomplete and invalid payloads", async () => {
  installFetch(() => {
    throw new Error("PostgREST must not be called for invalid payloads.");
  });
  const response = await POST(
    request("POST", {
      authenticated: true,
      body: {
        reviewId,
        organisationId,
        comparison: { previousRunId },
      },
    }),
  );
  assert.equal(response.status, 400);
});

test("comparison POST rejects inconsistent finding counts", async () => {
  installFetch(() => {
    throw new Error("PostgREST must not be called for invalid payloads.");
  });
  const response = await POST(
    request("POST", {
      authenticated: true,
      body: {
        reviewId,
        organisationId,
        comparison: {
          ...comparison,
          summary: { added: 1, removed: 0, changed: 0, unchanged: 0 },
        },
      },
    }),
  );
  assert.equal(response.status, 400);
});

test("comparison requests reject an invalid authenticated session", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  globalThis.fetch = (async () =>
    Response.json({ message: "Invalid token" }, { status: 401 })) as typeof fetch;
  const response = await GET(request("GET", { authenticated: true }));
  assert.equal(response.status, 401);
});

test("comparison POST rejects an organisation the user does not belong to", async () => {
  const requests: string[] = [];
  installFetch((url) => {
    requests.push(url.pathname);
    if (url.pathname === "/rest/v1/organisation_members") return ok([]);
    throw new Error("Unexpected data access.");
  });
  const response = await POST(
    request("POST", {
      authenticated: true,
      body: { reviewId, organisationId, comparison },
    }),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(requests, ["/rest/v1/organisation_members"]);
});

test("comparison POST rejects a review outside the authorised organisation", async () => {
  const requests: string[] = [];
  installFetch((url) => {
    requests.push(url.pathname);
    if (url.pathname === "/rest/v1/organisation_members") {
      return ok([{ organisation_id: organisationId, user_id: "user-1" }]);
    }
    if (url.pathname === "/rest/v1/reviews") {
      return ok([
        {
          id: reviewId,
          organisation_id: otherOrganisationId,
          analysis_run_id: currentRunId,
        },
      ]);
    }
    throw new Error("Comparison must not be inserted.");
  });
  const response = await POST(
    request("POST", {
      authenticated: true,
      body: { reviewId, organisationId, comparison },
    }),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(requests, [
    "/rest/v1/organisation_members",
    "/rest/v1/reviews",
  ]);
});

test("comparison POST rejects a same-organisation run unrelated to review lineage", async () => {
  const requests: URL[] = [];
  installFetch((url) => {
    requests.push(url);
    if (url.pathname === "/rest/v1/organisation_members") {
      return ok([{ organisation_id: organisationId, user_id: "user-1" }]);
    }
    if (url.pathname === "/rest/v1/reviews" && url.searchParams.has("id")) {
      return ok([
        {
          id: reviewId,
          organisation_id: organisationId,
          analysis_run_id: currentRunId,
          previous_analysis_run_id: "run-linked-to-another-review",
        },
      ]);
    }
    if (url.pathname === "/rest/v1/reviews") {
      return ok([
        {
          id: "another-review-in-same-org",
          organisation_id: organisationId,
        },
      ]);
    }
    throw new Error("Unrelated runs must not be inserted.");
  });
  const response = await POST(
    request("POST", {
      authenticated: true,
      body: { reviewId, organisationId, comparison },
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(requests.map((url) => url.pathname), [
    "/rest/v1/organisation_members",
    "/rest/v1/reviews",
    "/rest/v1/reviews",
  ]);
  assert.equal(
    requests[2]?.searchParams.get("analysis_run_id"),
    `eq.${previousRunId}`,
  );
  assert.equal(
    requests[2]?.searchParams.get("organisation_id"),
    `eq.${organisationId}`,
  );
});

test("comparison POST rejects missing review lineage metadata", async () => {
  installFetch((url) => {
    if (url.pathname === "/rest/v1/organisation_members") {
      return ok([{ organisation_id: organisationId, user_id: "user-1" }]);
    }
    if (url.pathname === "/rest/v1/reviews") {
      return ok([
        {
          id: reviewId,
          organisation_id: organisationId,
          analysis_run_id: currentRunId,
          previous_analysis_run_id: null,
        },
      ]);
    }
    if (url.pathname === "/rest/v1/reviews") {
      return ok([{ id: "previous-review", organisation_id: organisationId }]);
    }
    throw new Error("Missing lineage must not be queried or inserted.");
  });
  const response = await POST(
    request("POST", {
      authenticated: true,
      body: { reviewId, organisationId, comparison },
    }),
  );
  assert.equal(response.status, 400);
});

test("comparison GET rejects a review hidden by row-level access controls", async () => {
  const requests: string[] = [];
  installFetch((url) => {
    requests.push(url.pathname);
    if (url.pathname === "/rest/v1/reviews") return ok([]);
    throw new Error("Comparison must not be read.");
  });
  const response = await GET(request("GET", { authenticated: true }));
  assert.equal(response.status, 403);
  assert.deepEqual(requests, ["/rest/v1/reviews"]);
});

test("comparison GET rejects a visible review when the user is not an organisation member", async () => {
  const requests: string[] = [];
  installFetch((url) => {
    requests.push(url.pathname);
    if (url.pathname === "/rest/v1/reviews") {
      return ok([{ id: reviewId, organisation_id: otherOrganisationId, analysis_run_id: currentRunId }]);
    }
    if (url.pathname === "/rest/v1/organisation_members") return ok([]);
    throw new Error("Comparison must not be read.");
  });
  const response = await GET(request("GET", { authenticated: true }));
  assert.equal(response.status, 403);
  assert.deepEqual(requests, [
    "/rest/v1/reviews",
    "/rest/v1/organisation_members",
  ]);
});

test("authorised comparison GET verifies organisation membership before reading", async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  installFetch((url, init) => {
    requests.push({ url, init });
    if (url.pathname === "/rest/v1/reviews") {
      return ok([{ id: reviewId, organisation_id: organisationId, analysis_run_id: currentRunId }]);
    }
    if (url.pathname === "/rest/v1/organisation_members") {
      return ok([{ organisation_id: organisationId, user_id: "user-1" }]);
    }
    if (url.pathname === "/rest/v1/analysis_comparisons") {
      return ok([{ comparison }]);
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  const response = await GET(request("GET", { authenticated: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { comparison });
  assert.deepEqual(requests.map(({ url }) => url.pathname), [
    "/rest/v1/reviews",
    "/rest/v1/organisation_members",
    "/rest/v1/analysis_comparisons",
  ]);
  const comparisonRequest = requests.find(
    ({ url }) => url.pathname === "/rest/v1/analysis_comparisons",
  );
  assert.ok(comparisonRequest);
  assert.equal(comparisonRequest.url.searchParams.get("review_id"), `eq.${reviewId}`);
  assert.equal(
    comparisonRequest.url.searchParams.get("organisation_id"),
    `eq.${organisationId}`,
  );
  assert.equal(
    new Headers(comparisonRequest.init.headers).get("Authorization"),
    "Bearer valid-user-token",
  );
});

test("authorised comparison POST validates review/run ownership and persists with user credentials", async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  installFetch((url, init) => {
    requests.push({ url, init });
    if (url.pathname === "/rest/v1/organisation_members") {
      return ok([{ organisation_id: organisationId, user_id: "user-1" }]);
    }
    if (url.pathname === "/rest/v1/reviews" && url.searchParams.has("id")) {
      return ok([
        {
          id: reviewId,
          organisation_id: organisationId,
          analysis_run_id: currentRunId,
          previous_analysis_run_id: previousRunId,
        },
      ]);
    }
    if (url.pathname === "/rest/v1/reviews") {
      return ok([{ id: "previous-review", organisation_id: organisationId }]);
    }
    if (url.pathname === "/rest/v1/analysis_comparisons") {
      return ok([{ id: "comparison-id" }], 201);
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  const response = await POST(
    request("POST", {
      authenticated: true,
      body: { reviewId, organisationId, comparison },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { comparison });

  const insert = requests.find(
    ({ url, init }) =>
      url.pathname === "/rest/v1/analysis_comparisons" && init.method === "POST",
  );
  assert.ok(insert);
  assert.equal(
    new Headers(insert.init.headers).get("Authorization"),
    "Bearer valid-user-token",
  );
  assert.equal(new Headers(insert.init.headers).get("apikey"), "test-anon-key");
  assert.deepEqual(JSON.parse(String(insert.init.body)), {
    id: `cmp-${currentRunId}-${previousRunId}`,
    review_id: reviewId,
    organisation_id: organisationId,
    previous_run_id: previousRunId,
    current_run_id: currentRunId,
    comparison,
  });
});

test("comparison POST rejects a current run that does not belong to the target review", async () => {
  installFetch((url) => {
    if (url.pathname === "/rest/v1/organisation_members") {
      return ok([{ organisation_id: organisationId, user_id: "user-1" }]);
    }
    if (url.pathname === "/rest/v1/reviews") {
      return ok([
        {
          id: reviewId,
          organisation_id: organisationId,
          analysis_run_id: "other-run",
          previous_analysis_run_id: previousRunId,
        },
      ]);
    }
    throw new Error("Comparison must not be inserted.");
  });
  const response = await POST(
    request("POST", {
      authenticated: true,
      body: { reviewId, organisationId, comparison },
    }),
  );
  assert.equal(response.status, 400);
});

test("analysis comparison migration grants only authenticated SELECT and INSERT access", () => {
  const migration = readFileSync(
    path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20261121000000_analysis_coverage_and_comparison_persistence.sql",
    ),
    "utf8",
  );
  assert.match(
    migration,
    /GRANT SELECT, INSERT ON TABLE public\.analysis_comparisons TO authenticated;/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.analysis_comparisons FROM PUBLIC, anon;/,
  );
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /r\.analysis_run_id = analysis_comparisons\.current_run_id[\s\S]*r\.previous_analysis_run_id = analysis_comparisons\.previous_run_id/,
  );
  assert.match(
    migration,
    /comparison->>'currentRunId' = analysis_comparisons\.current_run_id[\s\S]*comparison->>'previousRunId' = analysis_comparisons\.previous_run_id/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.submit_review_with_lineage_atomic/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.submit_review_with_lineage_atomic\([\s\S]*?\) TO authenticated;/,
  );
  assert.match(
    migration,
    /previous_review\.organisation_id = p_organisation_id[\s\S]*?previous_review\.analysis_run_id = p_previous_analysis_run_id/,
  );
});

test("review submission persists lineage through the secured RPC", async () => {
  const originalStorage = globalThis.localStorage;
  const storageValues = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => storageValues.set(key, value),
    removeItem: (key: string) => storageValues.delete(key),
    clear: () => storageValues.clear(),
    key: (index: number) => Array.from(storageValues.keys())[index] ?? null,
    get length() {
      return storageValues.size;
    },
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  setStoredSession({
    accessToken: "user-access-token",
    refreshToken: "user-refresh-token",
    expiresIn: 3600,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    tokenType: "bearer",
    user: { id: "user-1", email: "user@example.test" },
  });

  const requests: Array<{ url: URL; init: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, init: init ?? {} });
    if (url.pathname === "/rest/v1/rpc/submit_review_with_lineage_atomic") {
      return ok({ review_id: reviewId, compliance_score: 80 });
    }
    return ok([]);
  }) as typeof fetch;

  try {
    const repository = new SupabaseReviewRepository();
    await repository.submitReview({
      organisationId,
      brandId: "33333333-3333-4333-8333-333333333333",
      review: {
        id: reviewId,
        title: "Re-analysis",
        contentType: "Campaign Copy",
        guidelineCollection: "Brand Guidelines",
        submittedBy: "Reviewer",
        submittedAt: "2026-11-21T00:00:00.000Z",
        status: "In Review",
        complianceScore: 80,
        textContent: "Example copy",
        findings: [],
        pastelTheme: "blue",
        analysisRunId: currentRunId,
        previousAnalysisRunId: previousRunId,
      },
    });

    const lineageRpc = requests.find(
      ({ url }) => url.pathname === "/rest/v1/rpc/submit_review_with_lineage_atomic",
    );
    assert.ok(lineageRpc);
    assert.equal(
      JSON.parse(String(lineageRpc.init.body)).p_previous_analysis_run_id,
      previousRunId,
    );
    const reviewPatch = requests.find(
      ({ url, init }) =>
        url.pathname === "/rest/v1/reviews" && init.method === "PATCH",
    );
    assert.ok(reviewPatch);
    assert.equal(
      Object.hasOwn(JSON.parse(String(reviewPatch.init.body)), "previous_analysis_run_id"),
      false,
    );
  } finally {
    clearStoredSession();
    if (originalStorage === undefined) {
      Reflect.deleteProperty(globalThis, "localStorage");
    } else {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  }
});
