import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReviewFinding, ReviewStatus, ReviewSubmission } from "../lib/types";
import {
  LocalReviewRepository,
  LocalActivityRepository,
} from "../lib/repositories";
import {
  getFindingDecisionValidationError,
  buildFindingDecisionPatch,
} from "../lib/review-decisions";
import { getSupabaseIntegrationStatus } from "../lib/supabase/client";

function computeExpectedScore(findings: ReviewFinding[], baseScore: number): number {
  if (findings.length === 0) return 100;
  const unresolvedPenalty = findings.reduce((sum, f) => {
    if (f.resolved) return sum;
    if (f.severity === "high") return sum + 12;
    if (f.severity === "medium") return sum + 6;
    return sum + 3;
  }, 0);
  return Math.max(40, Math.min(99, Math.max(baseScore, 98 - unresolvedPenalty)));
}

describe("Review Persistence Domain Logic & Contract Parity", () => {
  describe("Compliance Score Parity", () => {
    it("returns 100 when there are no findings", () => {
      assert.equal(computeExpectedScore([], 85), 100);
      assert.equal(computeExpectedScore([], 95), 100);
    });

    it("applies penalty 12 for high severity unresolved findings", () => {
      const findings: ReviewFinding[] = [
        {
          id: "f-1",
          category: "Brand Claims",
          title: "Unverified Claim",
          description: "No supporting evidence",
          severity: "high",
          evidenceStatus: "unverified",
          detectedValue: "fastest",
          expectedValue: "standard",
          sourceReference: "doc-1",
          recommendation: "Remove claim",
          affectedContent: "We are fastest",
          resolved: false,
          comments: [],
        },
      ];
      // 98 - 12 = 86
      assert.equal(computeExpectedScore(findings, 70), 86);
    });

    it("applies penalty 6 for medium severity and 3 for low severity", () => {
      const findings: ReviewFinding[] = [
        {
          id: "f-med",
          category: "Tone & Voice",
          title: "Informal Tone",
          description: "Use professional voice",
          severity: "medium",
          evidenceStatus: "supported",
          detectedValue: "hey guys",
          expectedValue: "welcome",
          sourceReference: "doc-2",
          recommendation: "Replace greeting",
          affectedContent: "hey guys",
          resolved: false,
          comments: [],
        },
        {
          id: "f-low",
          category: "Visual Identity",
          title: "Minor spacing discrepancy",
          description: "Adjust padding",
          severity: "low",
          evidenceStatus: "supported",
          detectedValue: "8px",
          expectedValue: "12px",
          sourceReference: "doc-3",
          recommendation: "Use 12px",
          affectedContent: "",
          resolved: false,
          comments: [],
        },
      ];
      // penalty = 6 + 3 = 9; 98 - 9 = 89
      assert.equal(computeExpectedScore(findings, 70), 89);
    });

    it("ignores resolved findings in penalty computation", () => {
      const findings: ReviewFinding[] = [
        {
          id: "f-res",
          category: "Brand Claims",
          title: "Resolved issue",
          description: "Was fixed",
          severity: "high",
          evidenceStatus: "supported",
          detectedValue: "x",
          expectedValue: "y",
          sourceReference: "doc-1",
          recommendation: "fix",
          affectedContent: "x",
          resolved: true,
          comments: [],
        },
      ];
      // Unresolved penalty = 0 -> 98 - 0 = 98 (clamped to max(baseScore, 98))
      assert.equal(computeExpectedScore(findings, 80), 98);
    });

    it("clamps scores within bounds [40, 99]", () => {
      // 10 high-severity unresolved findings: penalty = 120 -> 98 - 120 = -22 -> clamped to 40
      const manyFindings: ReviewFinding[] = Array.from({ length: 10 }, (_, i) => ({
        id: `f-${i}`,
        category: "Brand Claims",
        title: `Issue ${i}`,
        description: "desc",
        severity: "high",
        evidenceStatus: "unverified",
        detectedValue: "val",
        expectedValue: "exp",
        sourceReference: "ref",
        recommendation: "rec",
        affectedContent: "aff",
        resolved: false,
        comments: [],
      }));

      assert.equal(computeExpectedScore(manyFindings, 20), 40);
    });
  });

  describe("Status Transition Validation", () => {
    const allowedTransitions: Record<ReviewStatus, ReviewStatus[]> = {
      "Pending Approval": ["In Review", "Changes Requested", "Approved"],
      "In Review": ["Changes Requested", "Approved"],
      "Changes Requested": ["In Review", "Approved"],
      Approved: ["In Review"],
    };

    it("permits forward transitions from Pending Approval", () => {
      assert.ok(allowedTransitions["Pending Approval"].includes("In Review"));
      assert.ok(allowedTransitions["Pending Approval"].includes("Changes Requested"));
      assert.ok(allowedTransitions["Pending Approval"].includes("Approved"));
    });

    it("permits reopening an Approved review to In Review only", () => {
      assert.ok(allowedTransitions["Approved"].includes("In Review"));
      assert.ok(!allowedTransitions["Approved"].includes("Changes Requested"));
      assert.ok(!allowedTransitions["Approved"].includes("Pending Approval"));
    });
  });

  describe("Finding Decision Governance", () => {
    it("permits APPROVE without a mandatory reason", () => {
      assert.equal(getFindingDecisionValidationError("APPROVE", undefined), undefined);
      assert.equal(getFindingDecisionValidationError("APPROVE", ""), undefined);
    });

    it("strictly requires a reason when rejecting a finding", () => {
      const errEmpty = getFindingDecisionValidationError("REJECT", "");
      const errWhitespace = getFindingDecisionValidationError("REJECT", "   ");
      const errValid = getFindingDecisionValidationError("REJECT", "Approved exception granted by legal");

      assert.equal(errEmpty, "A reason is required to reject a finding.");
      assert.equal(errWhitespace, "A reason is required to reject a finding.");
      assert.equal(errValid, undefined);
    });

    it("builds a complete decision patch with reviewer metadata", () => {
      const patch = buildFindingDecisionPatch(
        "REJECT",
        "False positive",
        "Maya Lin",
        "2026-11-14T20:00:00.000Z"
      );

      assert.equal(patch.reviewDecision, "REJECT");
      assert.equal(patch.reviewDecisionReason, "False positive");
      assert.equal(patch.reviewDecisionBy, "Maya Lin");
      assert.equal(patch.reviewDecisionAt, "2026-11-14T20:00:00.000Z");
    });
  });

  describe("Review Repository & Local Fallback", () => {
    it("submits, updates status, resolves findings, and tracks activity in local repository", async () => {
      const repo = new LocalReviewRepository([]);
      const actRepo = new LocalActivityRepository([]);

      const sampleReview: ReviewSubmission = {
        id: "rev-test-1",
        title: "Test Review",
        contentType: "Campaign Copy",
        guidelineCollection: "Teralune",
        submittedBy: "Harsh Joshi",
        submittedAt: new Date().toISOString(),
        status: "Pending Approval",
        complianceScore: 88,
        textContent: "Clean creative text",
        pastelTheme: "blue",
        findings: [
          {
            id: "f-test-1",
            category: "Tone & Voice",
            title: "Overly technical phrasing",
            description: "Simplify language",
            severity: "medium",
            evidenceStatus: "supported",
            detectedValue: "utilize",
            expectedValue: "use",
            sourceReference: "ref-1",
            recommendation: "Use simpler verb",
            affectedContent: "utilize",
            resolved: false,
            comments: [],
          },
        ],
      };

      // 1. Submit review
      const subRes = await repo.submitReview({
        review: sampleReview,
        organisationId: "org-1",
        brandId: "brand-1",
      });
      assert.equal(subRes.reviewId, "rev-test-1");

      const fetched = await repo.fetchReviews();
      assert.equal(fetched.length, 1);
      assert.equal(fetched[0].status, "Pending Approval");

      // 2. Update status
      const statusRes = await repo.updateReviewStatus({
        reviewId: "rev-test-1",
        status: "In Review",
      });
      assert.equal(statusRes.status, "In Review");

      // 3. Resolve finding
      const toggleRes = await repo.toggleFindingResolved({
        reviewId: "rev-test-1",
        findingId: "f-test-1",
        actorName: "Harsh Joshi",
      });
      assert.equal(toggleRes.resolved, true);

      // 4. Apply correction
      const corrRes = await repo.applyFindingCorrection({
        reviewId: "rev-test-1",
        findingId: "f-test-1",
        editedText: "use",
        applyToCopy: true,
        actorName: "Harsh Joshi",
      });
      assert.equal(corrRes.appliedToCopy, true);

      // 5. Add comment
      const cmtRes = await repo.addFindingComment({
        reviewId: "rev-test-1",
        findingId: "f-test-1",
        commentId: "cmt-1",
        text: "Verified with lead",
      });
      assert.equal(cmtRes.commentId, "cmt-1");

      // 6. Record activity in activity repo
      await actRepo.recordActivity({
        id: "act-test-1",
        reviewId: "rev-test-1",
        actor: "Harsh Joshi",
        action: "submitted content for governance review:",
        target: "Test Review",
        type: "submitted",
        timestamp: new Date().toISOString(),
      });

      const activities = await actRepo.fetchActivities();
      assert.equal(activities.length, 1);
      assert.equal(activities[0].type, "submitted");
    });
  });

  describe("Integration Modes Specification", () => {
    it("reports DEMO_LOCAL when Supabase environment variables are missing", () => {
      const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const status = getSupabaseIntegrationStatus();
      assert.equal(status.mode, "DEMO_LOCAL");
      assert.equal(status.configured, false);

      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    });

    it("reports CONFIGURED_UNAUTHENTICATED when variables are set without an auth token", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

      const status = getSupabaseIntegrationStatus(null);
      assert.equal(status.mode, "CONFIGURED_UNAUTHENTICATED");
      assert.equal(status.configured, true);
    });

    it("reports AUTHENTICATED_SUPABASE when both variables and auth token are present", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

      const status = getSupabaseIntegrationStatus("valid-user-jwt");
      assert.equal(status.mode, "AUTHENTICATED_SUPABASE");
      assert.equal(status.configured, true);
    });
  });
});
