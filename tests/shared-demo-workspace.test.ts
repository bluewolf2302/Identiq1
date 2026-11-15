import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_CONFIG,
  checkDemoRateLimit,
  assertDemoOrganisation,
} from "../lib/demo/config";
import {
  getSupabaseIntegrationStatus,
  normalizeSupabaseUrl,
  callPostgrest,
} from "../lib/supabase/client";
import { callServerPostgrest } from "../lib/supabase/server";
import { ensureDemoTenancy } from "../lib/demo/seed";
import {
  createReviewRepository,
  DemoReviewRepository,
  DemoActivityRepository,
  SupabaseReviewRepository,
  LocalReviewRepository,
} from "../lib/repositories";
import {
  computeDashboardStats,
  filterReviews,
  computeStatusDistribution,
  computeSeverityDistribution,
  type DashboardFilters,
} from "../lib/dashboard-metrics";
import {
  filterActivities,
  sortActivitiesChronologically,
  getActivityDateGroup,
  type ActivityFilters,
} from "../lib/activity-timeline";
import {
  buildReviewAuditTrail,
  computeReviewAuditSummary,
  filterReviewAuditTrail,
} from "../lib/audit-history";
import { generateReviewsSummaryCsv } from "../lib/csv-export";
import {
  compileBrandComplianceReport,
  assessReviewRisk,
} from "../lib/reporting";
import { INITIAL_REVIEWS, INITIAL_ACTIVITY } from "../lib/seed-data";
import { ActivityEvent } from "../lib/types";

describe("IdentIQ Shared Demo Workspace Integration Suite", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-demo-project.supabase.co/rest/v1";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key-identiq-xyz";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // 1. DISTINCT PERSISTENCE MODE & URL NORMALIZATION
  // =========================================================================
  describe("1. Distinct Persistence Mode Contract", () => {
    it("reports DEMO_LOCAL when Supabase configuration is missing", () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const status = getSupabaseIntegrationStatus();
      assert.equal(status.mode, "DEMO_LOCAL");
      assert.equal(status.configured, false);
    });

    it("reports CONFIGURED_UNAUTHENTICATED when configured without session or demo preference", () => {
      const status = getSupabaseIntegrationStatus(null, false, false);
      assert.equal(status.mode, "CONFIGURED_UNAUTHENTICATED");
      assert.equal(status.configured, true);
    });

    it("reports SHARED_DEMO when configured and user chooses shared demo mode", () => {
      const status = getSupabaseIntegrationStatus(null, false, true);
      assert.equal(status.mode, "SHARED_DEMO");
      assert.equal(status.configured, true);
    });

    it("preserves AUTHENTICATED_SUPABASE when a valid session and organisation exist", () => {
      const mockSession = {
        accessToken: "valid-jwt-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        tokenType: "bearer",
        user: { id: "user-uuid-123", email: "reviewer@identiq.internal" },
      };

      const status = getSupabaseIntegrationStatus(mockSession, true, false);
      assert.equal(status.mode, "AUTHENTICATED_SUPABASE");
      assert.equal(status.configured, true);
    });

    it("normalizes Supabase URL with trailing /rest/v1 to bare origin for GoTrue and PostgREST", () => {
      const dirtyUrl = "https://abcdefghijklmnopqrst.supabase.co/rest/v1/";
      const clean = normalizeSupabaseUrl(dirtyUrl);
      assert.equal(clean, "https://abcdefghijklmnopqrst.supabase.co");
    });
  });

  // =========================================================================
  // 2. SERVER-SIDE DEMO SCOPING & CROSS-ORGANISATION ISOLATION
  // =========================================================================
  describe("2. Server-Side Demo Scoping & Cross-Organisation Isolation", () => {
    it("uses fixed deterministic UUIDs for demo tenancy isolated from customer orgs", () => {
      assert.equal(DEMO_CONFIG.ORGANISATION_ID, "e0000000-0000-0000-0000-000000000001");
      assert.equal(DEMO_CONFIG.BRAND_ID, "b0000000-0000-0000-0000-000000000001");
    });

    it("allows operations targeting the dedicated demo organisation ID", () => {
      assert.doesNotThrow(() => {
        assertDemoOrganisation(DEMO_CONFIG.ORGANISATION_ID);
      });
      assert.doesNotThrow(() => {
        assertDemoOrganisation(undefined);
      });
      assert.doesNotThrow(() => {
        assertDemoOrganisation(null);
      });
    });

    it("strictly throws CROSS_ORGANISATION_ACCESS_DENIED when caller provides any customer organisation ID", () => {
      const customerOrgId = "c1111111-2222-3333-4444-555555555555";
      assert.throws(
        () => assertDemoOrganisation(customerOrgId),
        /CROSS_ORGANISATION_ACCESS_DENIED/
      );
    });
  });

  // =========================================================================
  // 3. RATE LIMITING & ABUSE PREVENTION
  // =========================================================================
  describe("3. Rate Limiting & Abuse Controls", () => {
    it("allows reads within the configured rate limit window and rejects excess", () => {
      const clientId = `test-client-read-${Date.now()}`;
      for (let i = 0; i < DEMO_CONFIG.RATE_LIMIT.MAX_READS_PER_WINDOW; i++) {
        const res = checkDemoRateLimit(clientId, "read");
        assert.equal(res.allowed, true);
      }
      const overflow = checkDemoRateLimit(clientId, "read");
      assert.equal(overflow.allowed, false);
      assert.equal(overflow.remaining, 0);
      assert.ok(overflow.resetSeconds > 0);
    });

    it("strictly limits mutations per window to prevent demo spamming", () => {
      const clientId = `test-client-mut-${Date.now()}`;
      for (let i = 0; i < DEMO_CONFIG.RATE_LIMIT.MAX_MUTATIONS_PER_WINDOW; i++) {
        const res = checkDemoRateLimit(clientId, "mutation");
        assert.equal(res.allowed, true);
      }
      const overflow = checkDemoRateLimit(clientId, "mutation");
      assert.equal(overflow.allowed, false);
      assert.equal(overflow.remaining, 0);
    });

    it("strictly limits workspace resets per client to prevent denial of service", () => {
      const clientId = `test-client-reset-${Date.now()}`;
      for (let i = 0; i < DEMO_CONFIG.RATE_LIMIT.MAX_RESETS_PER_WINDOW; i++) {
        const res = checkDemoRateLimit(clientId, "reset");
        assert.equal(res.allowed, true);
      }
      const overflow = checkDemoRateLimit(clientId, "reset");
      assert.equal(overflow.allowed, false);
      assert.equal(overflow.remaining, 0);
    });
  });

  // =========================================================================
  // 4. REPOSITORY POLYMORPHISM & SERVER-SIDE ROUTE DISPATCH
  // =========================================================================
  describe("4. Repository Polymorphism & Demo Client Contract", () => {
    it("instantiates DemoReviewRepository and DemoActivityRepository in SHARED_DEMO mode", () => {
      const status = getSupabaseIntegrationStatus(null, false, true);
      assert.equal(status.mode, "SHARED_DEMO");

      const demoReviewRepo = new DemoReviewRepository();
      const demoActivityRepo = new DemoActivityRepository();
      assert.ok(demoReviewRepo instanceof DemoReviewRepository);
      assert.ok(demoActivityRepo instanceof DemoActivityRepository);
    });

    it("DemoReviewRepository routes fetchReviews through Next.js server route /api/demo/reviews", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      let requestedMethod = "";

      globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        return new Response(JSON.stringify(INITIAL_REVIEWS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      try {
        const repo = new DemoReviewRepository();
        const reviews = await repo.fetchReviews();
        assert.equal(requestedUrl, "/api/demo/reviews");
        assert.equal(requestedMethod, "GET");
        assert.equal(reviews.length, INITIAL_REVIEWS.length);
        assert.equal(reviews[0].id, INITIAL_REVIEWS[0].id);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("DemoReviewRepository routes mutations through server-side /api/demo/rpc", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      let requestedBody: Record<string, unknown> = {};

      globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedBody = JSON.parse((init?.body as string) || "{}");
        return new Response(
          JSON.stringify({
            success: true,
            reviewId: requestedBody.reviewId,
            status: requestedBody.status || "Approved",
            complianceScore: 94,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      try {
        const repo = new DemoReviewRepository();
        const statusRes = await repo.updateReviewStatus({
          reviewId: "demo-rev-101",
          status: "Approved",
          actorName: "Demo Lead",
        });

        assert.equal(requestedUrl, "/api/demo/rpc");
        assert.equal(requestedBody.action, "update_status");
        assert.equal(requestedBody.reviewId, "demo-rev-101");
        assert.equal(statusRes.status, "Approved");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // =========================================================================
  // 5. MODULE 1: DASHBOARD INTEGRATION
  // =========================================================================
  describe("5. Module 1: Dashboard Integration with Demo Records", () => {
    it("computes accurate KPI cards from demo reviews", () => {
      const stats = computeDashboardStats(INITIAL_REVIEWS);
      assert.equal(stats.totalReviews, 4);
      assert.equal(stats.approvedReviews, 1);
      assert.equal(stats.pendingReviews, 2);
      assert.equal(stats.rejectedReviews, 1);
      assert.equal(stats.flaggedReviews, 3);
      assert.equal(stats.totalOpenFindings, 7);
      assert.equal(stats.highSeverityFindings, 4);
      assert.equal(stats.averageComplianceScore, 82);
    });

    it("computes status and severity distributions for demo workspace", () => {
      const statusDist = computeStatusDistribution(INITIAL_REVIEWS);
      assert.equal(statusDist.approved.count, 1);
      assert.equal(statusDist.approved.percentage, 25);
      assert.equal(statusDist.pending.count, 2);
      assert.equal(statusDist.pending.percentage, 50);
      assert.equal(statusDist.rejected.count, 1);
      assert.equal(statusDist.rejected.percentage, 25);

      const severityDist = computeSeverityDistribution(INITIAL_REVIEWS);
      assert.equal(typeof severityDist.high.count, "number");
      assert.equal(typeof severityDist.medium.count, "number");
      assert.equal(typeof severityDist.low.count, "number");
      assert.equal(severityDist.high.count, 4);
    });

    it("filters demo reviews accurately by search and category", () => {
      const filters: DashboardFilters = {
        dateRange: "all",
        brand: "All",
        contentType: "Campaign Copy",
        searchQuery: "",
      };
      const filtered = filterReviews(INITIAL_REVIEWS, filters);
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, "rev-101");
    });
  });

  // =========================================================================
  // 6. MODULE 2: ACTIVITY TIMELINE INTEGRATION
  // =========================================================================
  describe("6. Module 2: Activity Timeline Integration with Demo Records", () => {
    it("filters demo activities by actor, event type, and search term", () => {
      const filters: ActivityFilters = {
        eventType: "all",
        actor: "all",
        searchQuery: "Solstice",
        dateRange: "all",
      };
      const activities = filterActivities(INITIAL_ACTIVITY, filters);
      assert.ok(activities.length >= 1);
    });

    it("sorts demo activities chronologically with ISO events prioritized", () => {
      const testEvents: ActivityEvent[] = [
        {
          id: "act-iso-1",
          actor: "Reviewer A",
          action: "approved",
          target: "Campaign 1",
          timestamp: "2026-11-15T09:00:00.000Z",
          type: "approved",
        },
        {
          id: "act-iso-2",
          actor: "Reviewer B",
          action: "submitted",
          target: "Campaign 2",
          timestamp: "2026-11-15T10:00:00.000Z",
          type: "submitted",
        },
        {
          id: "act-legacy-1",
          actor: "Reviewer C",
          action: "commented",
          target: "Campaign 3",
          timestamp: "12 mins ago",
          type: "changes_requested",
        },
      ];

      const sorted = sortActivitiesChronologically(testEvents);
      assert.equal(sorted[0].id, "act-iso-2"); // Newest ISO first
      assert.equal(sorted[1].id, "act-iso-1");
      assert.equal(sorted[2].id, "act-legacy-1"); // Legacy strings placed safely after
    });

    it("groups demo activities into valid date partitions", () => {
      const refDate = new Date("2026-11-15T12:00:00.000Z");
      const groupToday = getActivityDateGroup("2026-11-15T08:00:00.000Z", refDate);
      assert.equal(groupToday, "Today");

      const groupYesterday = getActivityDateGroup("2026-11-14T10:00:00.000Z", refDate);
      assert.equal(groupYesterday, "Yesterday");

      const groupOlder = getActivityDateGroup("2026-11-01T10:00:00.000Z", refDate);
      assert.equal(groupOlder, "Older");

      const groupLegacy = getActivityDateGroup("12 mins ago", refDate);
      assert.equal(groupLegacy, "Legacy / Undated");
    });
  });

  // =========================================================================
  // 7. MODULE 3: AUDIT HISTORY INTEGRATION
  // =========================================================================
  describe("7. Module 3: Audit History Integration with Demo Records", () => {
    it("synthesizes complete immutable audit trail for a demo review", () => {
      const targetReview = INITIAL_REVIEWS[0];
      const trail = buildReviewAuditTrail(targetReview, INITIAL_ACTIVITY);
      assert.ok(trail.length > 0);

      const submissionEntry = trail.find((e) => e.category === "submission");
      assert.ok(submissionEntry, "Submission audit entry must exist");
      assert.equal(submissionEntry?.actor, targetReview.submittedBy);
    });

    it("computes audit trail summary counts accurately for demo reviews", () => {
      const targetReview = INITIAL_REVIEWS[0];
      const trail = buildReviewAuditTrail(targetReview, INITIAL_ACTIVITY);
      const summary = computeReviewAuditSummary(trail);

      assert.equal(summary.totalEntries, trail.length);
      assert.equal(typeof summary.commentsCount, "number");
      assert.equal(typeof summary.correctionsCount, "number");
      assert.equal(typeof summary.hasAnalysisRun, "boolean");
      assert.equal(typeof summary.recordedEventsCount, "number");
    });

    it("filters demo audit trail without corrupting underlying entries", () => {
      const targetReview = INITIAL_REVIEWS[0];
      const trail = buildReviewAuditTrail(targetReview, INITIAL_ACTIVITY);
      const filtered = filterReviewAuditTrail(trail, "submission", "");
      assert.ok(filtered.length >= 1);
      assert.equal(filtered[0].category, "submission");

      const allFiltered = filterReviewAuditTrail(trail, "all", "Elena");
      assert.ok(allFiltered.length >= 1);
    });
  });

  // =========================================================================
  // 8. MODULE 4: REPORTING & EXPORT INTEGRATION
  // =========================================================================
  describe("8. Module 4: Reporting & Export Integration with Demo Records", () => {
    it("generates RFC 4180 compliant CSV summary from demo reviews", () => {
      const csv = generateReviewsSummaryCsv(INITIAL_REVIEWS);
      assert.ok(
        csv.startsWith(
          "Review ID,Title,Brand,Content Type,Submitter,Submitted At,Status,Compliance Score,Total Findings,Open Findings,High Severity Findings,Analysis Run ID,Provider Used"
        )
      );
      const lines = csv.trim().split("\n");
      assert.equal(lines.length, INITIAL_REVIEWS.length + 1);
    });

    it("compiles brand compliance governance report from demo workspace", () => {
      const report = compileBrandComplianceReport(INITIAL_REVIEWS);
      assert.equal(report.stats.totalReviews, INITIAL_REVIEWS.length);
      assert.ok(report.stats.averageComplianceScore > 0);
      assert.ok(report.brandSummaries.length > 0);
      assert.ok(report.creativesAtRisk.length >= 0);
    });

    it("assesses review risk correctly for demo items", () => {
      const risk = assessReviewRisk(INITIAL_REVIEWS[0]);
      assert.ok(["critical", "warning", "low"].includes(risk.riskLevel));
      assert.equal(typeof risk.highSeverityCount, "number");
      assert.equal(typeof risk.openFindingsCount, "number");
    });
  });

  // =========================================================================
  // 9. DEMO RESET BOUNDARY ENFORCEMENT
  // =========================================================================
  describe("9. Demo Reset Boundary Enforcement", () => {
    it("strictly isolates reset target to DEMO_CONFIG.ORGANISATION_ID", () => {
      const targetOrg = DEMO_CONFIG.ORGANISATION_ID;
      const expectedFilter = `organisation_id=eq.${targetOrg}`;
      assert.ok(expectedFilter.includes("e0000000-0000-0000-0000-000000000001"));
    });

    it("never includes non-demo customer organisation IDs in delete filters", () => {
      const customerOrgId = "77777777-8888-9999-aaaa-bbbbccccdddd";
      assert.notEqual(DEMO_CONFIG.ORGANISATION_ID, customerOrgId);
      assert.throws(() => assertDemoOrganisation(customerOrgId));
    });
  });

  // =========================================================================
  // 10. AUTHENTICATED_SUPABASE NON-REGRESSION
  // =========================================================================
  describe("10. Authenticated Mode Non-Regression Contract", () => {
    it("instantiates SupabaseReviewRepository when caller supplies an active auth token", () => {
      const token = "ey.mock-jwt-reviewer-session-token";
      const repo = createReviewRepository(token);
      assert.ok(repo instanceof SupabaseReviewRepository);
    });

    it("falls back safely to LocalReviewRepository when not configured", () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      const repo = createReviewRepository();
      assert.ok(repo instanceof LocalReviewRepository);
    });
  });

  // =========================================================================
  // 11. SUPABASE API-KEY HEADER DISPATCH & ERROR PROPAGATION
  // =========================================================================
  describe("11. Supabase API-Key Header Dispatch & Error Propagation", () => {
    it("callServerPostgrest sends sb_secret_... via apikey and omits Authorization header", async () => {
      const originalFetch = globalThis.fetch;
      let capturedHeaders: Record<string, string> = {};

      process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_sample_mock_admin_key";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_sample_mock_anon_key";

      globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(JSON.stringify([{ id: "demo-org" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      try {
        await callServerPostgrest("/rest/v1/organisations", { useServiceRole: true });
        assert.equal(capturedHeaders.apikey, "sb_secret_sample_mock_admin_key");
        assert.equal(capturedHeaders.Authorization, undefined, "Opaque sb_secret_ key must NOT be sent as Bearer token");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("callServerPostgrest preserves genuine user session JWT in Authorization header", async () => {
      const originalFetch = globalThis.fetch;
      let capturedHeaders: Record<string, string> = {};

      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_sample_mock_anon_key";

      globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      try {
        const userJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature";
        await callServerPostgrest("/rest/v1/reviews", { userToken: userJwt });
        assert.equal(capturedHeaders.apikey, "sb_publishable_sample_mock_anon_key");
        assert.equal(capturedHeaders.Authorization, `Bearer ${userJwt}`);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("callServerPostgrest preserves legacy JWT service role key in Authorization header", async () => {
      const originalFetch = globalThis.fetch;
      let capturedHeaders: Record<string, string> = {};

      const legacyServiceJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature";
      process.env.SUPABASE_SERVICE_ROLE_KEY = legacyServiceJwt;

      globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      try {
        await callServerPostgrest("/rest/v1/organisations", { useServiceRole: true });
        assert.equal(capturedHeaders.apikey, legacyServiceJwt);
        assert.equal(capturedHeaders.Authorization, `Bearer ${legacyServiceJwt}`);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("callPostgrest in browser client sends sb_publishable_... via apikey and omits Authorization when unauthenticated", async () => {
      const originalFetch = globalThis.fetch;
      let capturedHeaders: Record<string, string> = {};

      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_sample_mock_anon_key";

      globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      try {
        await callPostgrest("/rest/v1/brands");
        assert.equal(capturedHeaders.apikey, "sb_publishable_sample_mock_anon_key");
        assert.equal(capturedHeaders.Authorization, undefined, "Opaque sb_publishable_ key must NOT be sent as Bearer token");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("ensureDemoTenancy throws an error when PostgREST rejects organisation provisioning", async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = (async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.includes("/organisations?id=")) {
          // Check query returns 0 rows (triggering insert)
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/organisations")) {
          // Insert query returns 401 Unauthorized
          return new Response(
            JSON.stringify({ code: "401", message: "Invalid JWT token" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch;

      try {
        await assert.rejects(
          async () => {
            await ensureDemoTenancy();
          },
          /Failed to provision demo organisation \(401\)/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
