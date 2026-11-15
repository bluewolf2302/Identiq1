import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  signInWithPassword,
  signUp,
  signOut,
  getUser,
  refreshSession,
  restoreSession,
  setStoredSession,
  getStoredSession,
  clearStoredSession,
} from "../lib/supabase/auth";
import { getSupabaseIntegrationStatus, callPostgrest } from "../lib/supabase/client";
import { SupabaseReviewRepository } from "../lib/repositories/review-repository";
import { ReviewSubmission } from "../lib/types";

// Setup mock localStorage in Node.js environment if window is undefined
const mockStorage = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => mockStorage.get(key) || null,
    setItem: (key: string, val: string) => {
      mockStorage.set(key, val);
    },
    removeItem: (key: string) => {
      mockStorage.delete(key);
    },
    clear: () => {
      mockStorage.clear();
    },
    key: (i: number) => Array.from(mockStorage.keys())[i] || null,
    length: 0,
  };
}

describe("Supabase Authentication & Multi-Tenancy Integration", () => {
  const timestamp = Date.now();
  const testEmailA = `test_reviewer_${timestamp}_a@identiq.internal`;
  const testEmailB = `test_reviewer_${timestamp}_b@identiq.internal`;
  const testPassword = "SecurePassword123!";

  let userASession: { accessToken: string; refreshToken: string; user: { id: string; email: string } };
  let userBSession: { accessToken: string; refreshToken: string; user: { id: string; email: string } };
  let orgAId: string;
  let brandAId: string;
  let orgBId: string;

  before(() => {
    // Ensure environment points to local Supabase
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
  });

  after(async () => {
    clearStoredSession();
  });

  it("1. registers a new user with email and password", async () => {
    const res = await signUp({
      email: testEmailA,
      password: testPassword,
      metadata: { full_name: "Test Reviewer A", role: "Brand Lead" },
    });

    assert.equal(res.error, null);
    assert.ok(res.data);
    assert.ok(res.data.user);
    assert.equal(res.data.user.email, testEmailA);
    assert.ok(res.data.session);
    assert.ok(res.data.session.accessToken);

    userASession = res.data.session;
  });

  it("2. fails authentication when provided invalid credentials", async () => {
    const res = await signInWithPassword({
      email: testEmailA,
      password: "WrongPassword_999!",
    });

    assert.ok(res.error);
    assert.equal(res.data, null);
    assert.equal(res.error.status, 400);
  });

  it("3. signs in successfully with valid credentials and caches session", async () => {
    const res = await signInWithPassword({
      email: testEmailA,
      password: testPassword,
    });

    assert.equal(res.error, null);
    assert.ok(res.data);
    assert.equal(res.data.user.email, testEmailA);

    const stored = getStoredSession();
    assert.ok(stored);
    assert.equal(stored.user.email, testEmailA);
    assert.equal(stored.accessToken, res.data.session.accessToken);
  });

  it("4. validates session against GoTrue /auth/v1/user endpoint", async () => {
    const userRes = await getUser(userASession.accessToken);
    assert.equal(userRes.error, null);
    assert.ok(userRes.data);
    assert.equal(userRes.data.id, userASession.user.id);
    assert.equal(userRes.data.email, testEmailA);
  });

  it("5. rejects fabricated or forged tokens without trusting localStorage blindly", async () => {
    // Inject fabricated malicious token
    (globalThis.localStorage as Storage).setItem(
      "identiq_auth_session",
      JSON.stringify({
        accessToken: "forged.fake.token",
        refreshToken: "forged_refresh",
        expiresIn: 3600,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        tokenType: "bearer",
        user: { id: "fake-uuid", email: "hacker@evil.com" },
      })
    );

    const restoreRes = await restoreSession();
    assert.equal(restoreRes.session, null);
    assert.ok(restoreRes.error);
    // Verifies fabricated token was purged
    assert.equal(getStoredSession(), null);
  });

  it("6. correctly handles user without organisation membership", async () => {
    // Restore User A valid session
    setStoredSession({
      accessToken: userASession.accessToken,
      refreshToken: userASession.refreshToken,
      expiresIn: 3600,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      tokenType: "bearer",
      user: userASession.user,
    });

    // User A currently has 0 organisations
    const memRes = await callPostgrest<{ organisation_id: string; role: string }[]>(
      "/rest/v1/organisation_members?select=organisation_id,role",
      { authToken: userASession.accessToken }
    );

    assert.equal(memRes.error, null);
    assert.deepEqual(memRes.data, []);

    // Status mode must be AUTHENTICATED_NO_ORGANISATION, never claiming AUTHENTICATED_SUPABASE
    const status = getSupabaseIntegrationStatus(true, false);
    assert.equal(status.mode, "AUTHENTICATED_NO_ORGANISATION");
  });

  it("7. provisions organisation ownership via create_organisation_and_owner RPC", async () => {
    const orgRes = await callPostgrest<{ organisation_id: string; brand_id: string; name: string; role: string }>(
      "/rest/v1/rpc/create_organisation_and_owner",
      {
        method: "POST",
        body: { p_name: `Org A Global ${timestamp}` },
        authToken: userASession.accessToken,
      }
    );

    assert.equal(orgRes.error, null);
    assert.ok(orgRes.data);
    assert.equal(orgRes.data.role, "owner");
    assert.ok(orgRes.data.organisation_id);
    assert.ok(orgRes.data.brand_id);

    orgAId = orgRes.data.organisation_id;
    brandAId = orgRes.data.brand_id;

    // Membership query now returns User A's organisation
    const memRes = await callPostgrest<{ organisation_id: string; role: string }[]>(
      "/rest/v1/organisation_members?select=organisation_id,role",
      { authToken: userASession.accessToken }
    );

    assert.equal(memRes.error, null);
    assert.ok(memRes.data && memRes.data.length > 0);
    assert.equal(memRes.data[0].organisation_id, orgAId);
    assert.equal(memRes.data[0].role, "owner");

    // With organisation established, status becomes AUTHENTICATED_SUPABASE
    const status = getSupabaseIntegrationStatus(true, true);
    assert.equal(status.mode, "AUTHENTICATED_SUPABASE");
  });

  it("8. refreshes token via GoTrue /auth/v1/token?grant_type=refresh_token", async () => {
    const refreshRes = await refreshSession(userASession.refreshToken);
    assert.equal(refreshRes.error, null);
    assert.ok(refreshRes.data);
    assert.ok(refreshRes.data.accessToken);
    assert.notEqual(refreshRes.data.accessToken, userASession.accessToken);

    // Update session
    userASession = refreshRes.data;
  });

  it("9. enforces strict cross-organisation tenant isolation via RLS", async () => {
    // Create User B and Org B
    const signupB = await signUp({
      email: testEmailB,
      password: testPassword,
      metadata: { full_name: "Test Reviewer B", role: "Auditor" },
    });
    assert.ok(signupB.data?.session);
    userBSession = signupB.data.session;

    const orgBRes = await callPostgrest<{ organisation_id: string; name: string; role: string }>(
      "/rest/v1/rpc/create_organisation_and_owner",
      {
        method: "POST",
        body: { p_name: `Org B Private ${timestamp}` },
        authToken: userBSession.accessToken,
      }
    );
    assert.ok(orgBRes.data?.organisation_id);
    orgBId = orgBRes.data.organisation_id;

    // User A cannot read Org B's memberships
    const userASeesOrgB = await callPostgrest<{ organisation_id: string }[]>(
      `/rest/v1/organisation_members?organisation_id=eq.${orgBId}&select=organisation_id`,
      { authToken: userASession.accessToken }
    );
    assert.equal(userASeesOrgB.error, null);
    assert.deepEqual(userASeesOrgB.data, []); // Isolated by RLS!

    // User B cannot read Org A's memberships
    const userBSeesOrgA = await callPostgrest<{ organisation_id: string }[]>(
      `/rest/v1/organisation_members?organisation_id=eq.${orgAId}&select=organisation_id`,
      { authToken: userBSession.accessToken }
    );
    assert.equal(userBSeesOrgA.error, null);
    assert.deepEqual(userBSeesOrgA.data, []); // Isolated by RLS!
  });

  it("10. persists reviews under authenticated session and retrieves them", async () => {
    // Setup stored session as User A
    setStoredSession({
      accessToken: userASession.accessToken,
      refreshToken: userASession.refreshToken,
      expiresIn: 3600,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      tokenType: "bearer",
      user: userASession.user,
    });

    const repo = new SupabaseReviewRepository();
    const reviewId = `rev-auth-${timestamp}`;

    const testReview: ReviewSubmission = {
      id: reviewId,
      title: "Authenticated Campaign Launch Q1",
      submittedBy: "Test Reviewer A",
      submittedAt: new Date().toISOString(),
      status: "In Review",
      contentType: "Campaign Copy",
      guidelineCollection: "Brand Guidelines",
      pastelTheme: "blue",
      textContent: "Our certified organic formula delivers exceptional skin rejuvenation.",
      complianceScore: 92,
      findings: [
        {
          id: `fnd-auth-${timestamp}`,
          title: "Verify Organic Certification Claim",
          severity: "medium",
          category: "Brand Claims",
          evidenceStatus: "unverified",
          affectedContent: "certified organic",
          detectedValue: "certified organic",
          expectedValue: "USDA certified organic reference",
          sourceReference: "Section 3.2 Claims Policy",
          recommendation: "Provide certificate number or remove certified claim",
          description: "Organic claim requires valid third-party cert reference.",
          resolved: false,
          comments: [],
        },
      ],
    };

    // Submit review under Org A
    await repo.submitReview({
      review: testReview,
      organisationId: orgAId,
      brandId: brandAId,
    });

    // Fetch reviews for Org A
    const remoteReviews = await repo.fetchReviews(orgAId);
    assert.ok(remoteReviews.length > 0);
    const found = remoteReviews.find((r) => r.id === reviewId);
    assert.ok(found);
    assert.equal(found.title, "Authenticated Campaign Launch Q1");
    assert.equal(found.findings.length, 1);
    assert.equal(found.findings[0].title, "Verify Organic Certification Claim");

    // Verify User B cannot see User A's review under RLS
    const userBReviews = await callPostgrest<{ id: string }[]>(
      `/rest/v1/reviews?id=eq.${reviewId}&select=id`,
      { authToken: userBSession.accessToken }
    );
    assert.deepEqual(userBReviews.data, []); // RLS blocks User B!
  });

  it("11. persists review state across session restoration / simulated refresh", async () => {
    // Simulate refresh by calling restoreSession()
    const { session: restored } = await restoreSession();
    assert.ok(restored);
    assert.equal(restored.user.email, testEmailA);

    // Re-instantiate repository and verify reviews are retained
    const repo = new SupabaseReviewRepository();
    const fetched = await repo.fetchReviews(orgAId);
    assert.ok(fetched.some((r) => r.title === "Authenticated Campaign Launch Q1"));
  });

  it("12. signs out and invalidates session", async () => {
    const signoutRes = await signOut();
    assert.equal(signoutRes.error, null);
    assert.equal(getStoredSession(), null);

    // Verify user token is rejected by GoTrue after logout
    const postLogoutUser = await getUser(userASession.accessToken);
    assert.ok(postLogoutUser.error);
    assert.equal(postLogoutUser.data, null);
  });
});
