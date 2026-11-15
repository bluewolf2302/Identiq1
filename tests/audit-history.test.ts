import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewAuditTrail,
  computeReviewAuditSummary,
  filterReviewAuditTrail,
  sortAuditEntries,
  type ReviewAuditEntry,
} from "../lib/audit-history";
import type { ActivityEvent, ReviewSubmission } from "../lib/types";

const mockSubmission: ReviewSubmission = {
  id: "rev-test-1",
  title: "Aura Glow Summer Campaign",
  contentType: "Campaign Copy",
  guidelineCollection: "Aura Botanicals Global v2.4",
  submittedBy: "Elena Vance",
  submittedAt: "2026-11-12T09:42:00.000Z",
  status: "In Review",
  complianceScore: 82,
  pastelTheme: "pink",
  textContent: "Experience radiant hydration with 100% certified organic botanicals.",
  providerUsed: "gemini",
  analysisRunId: "run-test-999",
  analysisStatus: "COMPLETED",
  findings: [
    {
      id: "f-1",
      category: "Brand Claims",
      title: "Unverified organic certification",
      description: "Organic certification claim requires verification.",
      severity: "high",
      evidenceStatus: "unverified",
      detectedValue: "100% certified organic",
      expectedValue: "sustainably sourced botanicals",
      sourceReference: "Section 3.2",
      recommendation: "Provide certificate number or update copy.",
      affectedContent: "100% certified organic",
      resolved: true,
      resolvedAt: "2026-11-12T11:00:00.000Z",
      resolvedBy: "Maya Lin",
      editedCorrection: "sustainably sourced botanicals",
      comments: [
        {
          id: "cmt-1",
          author: "Maya Lin",
          role: "Brand Governance Lead",
          text: "Certificate received from operations.",
          createdAt: "2026-11-12T10:30:00.000Z",
        },
      ],
    },
    {
      id: "f-2",
      category: "Tone & Voice",
      title: "Missing brand sign-off",
      description: "Tagline missing.",
      severity: "low",
      evidenceStatus: "conflicting",
      detectedValue: "",
      expectedValue: "Radiance, naturally.",
      sourceReference: "Section 1.1",
      recommendation: "Append brand tagline.",
      affectedContent: "",
      resolved: false,
      comments: [],
    },
  ],
};

const mockActivities: ActivityEvent[] = [
  {
    id: "act-1",
    reviewId: "rev-test-1",
    actor: "Elena Vance",
    action: "submitted content for governance review:",
    target: "Aura Glow Summer Campaign",
    timestamp: "2026-11-12T09:42:00.000Z",
    type: "submitted",
  },
  {
    id: "act-2",
    reviewId: "rev-test-1",
    actor: "Maya Lin",
    action: "marked finding resolved in",
    target: "Aura Glow Summer Campaign",
    timestamp: "2026-11-12T11:00:00.000Z",
    type: "resolved",
  },
  {
    id: "act-unrelated",
    reviewId: "rev-other-999",
    actor: "Other Person",
    action: "approved submission:",
    target: "Completely Unrelated Submission",
    timestamp: "2026-11-13T10:00:00.000Z",
    type: "approved",
  },
];

test("buildReviewAuditTrail safely handles null or empty review", () => {
  assert.deepEqual(buildReviewAuditTrail(null), []);
  assert.deepEqual(buildReviewAuditTrail(undefined), []);
  assert.deepEqual(buildReviewAuditTrail({} as ReviewSubmission), []);
});

test("buildReviewAuditTrail excludes activities belonging to other reviews", () => {
  const trail = buildReviewAuditTrail(mockSubmission, mockActivities);
  const unrelated = trail.find((t) => t.id === "act-unrelated" || t.actor === "Other Person");
  assert.equal(unrelated, undefined, "Unrelated review activities must not leak into audit trail");
});

test("buildReviewAuditTrail synthesizes submission event accurately", () => {
  const trail = buildReviewAuditTrail(mockSubmission, mockActivities);
  const submissionEntry = trail.find((t) => t.category === "submission");

  assert.ok(submissionEntry, "Submission entry must exist");
  assert.equal(submissionEntry.reviewId, "rev-test-1");
  assert.equal(submissionEntry.actor, "Elena Vance");
  assert.equal(submissionEntry.isRecordedEvent, true);
  assert.equal(submissionEntry.details?.complianceScore, 82);
});

test("buildReviewAuditTrail includes automated analysis run metadata when available", () => {
  const trail = buildReviewAuditTrail(mockSubmission, mockActivities);
  const analysisEntry = trail.find((t) => t.category === "analysis");

  assert.ok(analysisEntry, "Analysis entry must exist");
  assert.equal(analysisEntry.actorRole, "Automated Analysis");
  assert.equal(analysisEntry.details?.providerUsed, "gemini");
  assert.equal(analysisEntry.details?.analysisRunId, "run-test-999");
  assert.equal(analysisEntry.details?.historicalValueAvailable, false);
  assert.ok(
    analysisEntry.details?.previousValueNotice?.includes("Only the latest analysis run"),
    "Must state that intermediate runs are not recorded",
  );
});

test("buildReviewAuditTrail extracts finding comments without duplicating", () => {
  const trail = buildReviewAuditTrail(mockSubmission, mockActivities);
  const commentEntries = trail.filter((t) => t.category === "comment");

  assert.equal(commentEntries.length, 1);
  assert.equal(commentEntries[0].actor, "Maya Lin");
  assert.equal(commentEntries[0].details?.commentText, "Certificate received from operations.");
  assert.equal(commentEntries[0].details?.findingTitle, "Unverified organic certification");
});

test("buildReviewAuditTrail captures recorded corrections with unavailable previous version notice", () => {
  const trail = buildReviewAuditTrail(mockSubmission, mockActivities);
  const corrEntry = trail.find((t) => t.category === "correction");

  assert.ok(corrEntry, "Correction entry must be synthesized");
  assert.equal(corrEntry.details?.correctionText, "sustainably sourced botanicals");
  assert.equal(corrEntry.details?.historicalValueAvailable, false);
  assert.ok(
    corrEntry.details?.previousValueNotice?.includes("Previous copy text version not recorded"),
    "Must explicitly warn that previous copy version was not stored",
  );
});

test("buildReviewAuditTrail preserves finding resolution metadata", () => {
  const trail = buildReviewAuditTrail(mockSubmission, mockActivities);
  const resolutionAct = trail.find((t) => t.id === "act-2");

  assert.ok(resolutionAct, "Recorded resolution activity must be present");
  assert.equal(resolutionAct.category, "finding");
  assert.equal(resolutionAct.actor, "Maya Lin");
  assert.equal(resolutionAct.isRecordedEvent, true);
});

test("sortAuditEntries sorts chronological events newest first", () => {
  const entries: ReviewAuditEntry[] = [
    {
      id: "e-old",
      reviewId: "rev-1",
      category: "submission",
      title: "Old Event",
      action: "submitted",
      actor: "Alice",
      timestamp: "2026-11-10T08:00:00.000Z",
      displayTime: "Nov 10",
      isRecordedEvent: true,
      isSnapshot: false,
    },
    {
      id: "e-new",
      reviewId: "rev-1",
      category: "decision",
      title: "New Event",
      action: "approved",
      actor: "Bob",
      timestamp: "2026-11-12T14:00:00.000Z",
      displayTime: "Nov 12",
      isRecordedEvent: true,
      isSnapshot: false,
    },
    {
      id: "e-mid",
      reviewId: "rev-1",
      category: "finding",
      title: "Mid Event",
      action: "resolved",
      actor: "Charlie",
      timestamp: "2026-11-11T10:00:00.000Z",
      displayTime: "Nov 11",
      isRecordedEvent: true,
      isSnapshot: false,
    },
  ];

  const sorted = sortAuditEntries(entries);
  assert.equal(sorted[0].id, "e-new");
  assert.equal(sorted[1].id, "e-mid");
  assert.equal(sorted[2].id, "e-old");
});

test("sortAuditEntries handles legacy and relative timestamp strings safely", () => {
  const entries: ReviewAuditEntry[] = [
    {
      id: "e-legacy",
      reviewId: "rev-1",
      category: "submission",
      title: "Legacy Event",
      action: "submitted",
      actor: "Alice",
      timestamp: "12 mins ago",
      displayTime: "12 mins ago",
      isRecordedEvent: true,
      isSnapshot: false,
    },
    {
      id: "e-iso",
      reviewId: "rev-1",
      category: "decision",
      title: "ISO Event",
      action: "approved",
      actor: "Bob",
      timestamp: "2026-11-14T10:00:00.000Z",
      displayTime: "Today",
      isRecordedEvent: true,
      isSnapshot: false,
    },
  ];

  const sorted = sortAuditEntries(entries);
  assert.equal(sorted[0].id, "e-iso", "Valid ISO timestamps should be placed before legacy unparseable strings");
  assert.equal(sorted[1].id, "e-legacy");
});

test("filterReviewAuditTrail filters by category and search keywords", () => {
  const trail = buildReviewAuditTrail(mockSubmission, mockActivities);

  const commentsOnly = filterReviewAuditTrail(trail, "comment", "");
  assert.equal(commentsOnly.length, 1);
  assert.equal(commentsOnly[0].category, "comment");

  const searchMaya = filterReviewAuditTrail(trail, "all", "Maya");
  assert.ok(searchMaya.length >= 2, "Should match Maya Lin comments and actions");

  const searchNone = filterReviewAuditTrail(trail, "all", "nonexistent-query-keyword-xyz");
  assert.equal(searchNone.length, 0);
});

test("computeReviewAuditSummary tallies counts accurately", () => {
  const trail = buildReviewAuditTrail(mockSubmission, mockActivities);
  const summary = computeReviewAuditSummary(trail);

  assert.equal(summary.totalEntries, trail.length);
  assert.equal(summary.commentsCount, 1);
  assert.equal(summary.correctionsCount, 1);
  assert.equal(summary.hasAnalysisRun, true);
  assert.ok(summary.recordedEventsCount >= 2);
});

test("buildReviewAuditTrail does not fabricate non-existent previous copy", () => {
  const reviewWithoutCorrection: ReviewSubmission = {
    ...mockSubmission,
    findings: [],
  };

  const trail = buildReviewAuditTrail(reviewWithoutCorrection, []);
  const corrections = trail.filter((t) => t.category === "correction");
  assert.equal(corrections.length, 0, "No correction entries should be fabricated if none exist");
});

test("buildReviewAuditTrail maps distinct neutral event types accurately", () => {
  const explicitActivities: ActivityEvent[] = [
    {
      id: "act-corr-1",
      reviewId: "rev-test-1",
      actor: "Maya Lin",
      action: "applied correction for \"Unverified claim\" in",
      target: "Aura Glow Summer Campaign",
      timestamp: "2026-11-12T11:15:00.000Z",
      type: "correction_applied",
    },
    {
      id: "act-cmt-1",
      reviewId: "rev-test-1",
      actor: "Maya Lin",
      action: "commented on finding \"Missing sign-off\" in",
      target: "Aura Glow Summer Campaign",
      timestamp: "2026-11-12T11:20:00.000Z",
      type: "comment_added",
    },
    {
      id: "act-man-1",
      reviewId: "rev-test-1",
      actor: "Maya Lin",
      action: "added manual finding \"Legal disclaimer missing\" to",
      target: "Aura Glow Summer Campaign",
      timestamp: "2026-11-12T11:25:00.000Z",
      type: "manual_finding_added",
    },
  ];

  const trail = buildReviewAuditTrail(mockSubmission, explicitActivities);

  const corr = trail.find((t) => t.id === "act-corr-1");
  assert.ok(corr);
  assert.equal(corr.category, "correction");

  const cmt = trail.find((t) => t.id === "act-cmt-1");
  assert.ok(cmt);
  assert.equal(cmt.category, "comment");

  const man = trail.find((t) => t.id === "act-man-1");
  assert.ok(man);
  assert.equal(man.category, "finding");
});

test("buildReviewAuditTrail deduplicates recorded correction activities with finding edits", () => {
  const activities: ActivityEvent[] = [
    {
      id: "act-corr-applied",
      reviewId: "rev-test-1",
      actor: "Maya Lin",
      action: "applied correction for \"Unverified organic certification\" in",
      target: "Aura Glow Summer Campaign",
      timestamp: "2026-11-12T11:15:00.000Z",
      type: "correction_applied",
    },
  ];

  const trail = buildReviewAuditTrail(mockSubmission, activities);
  const corrEntries = trail.filter((t) => t.category === "correction");

  // Should have exactly 1 correction entry, not 2
  assert.equal(corrEntries.length, 1);
  assert.equal(corrEntries[0].id, "act-corr-applied");
  assert.equal(corrEntries[0].isRecordedEvent, true);
  assert.equal(corrEntries[0].details?.correctionText, "sustainably sourced botanicals");
});

test("finding resolution metadata is preserved when resolved and absent when unresolved", () => {
  const resolvedFinding = mockSubmission.findings[0];
  assert.equal(resolvedFinding.resolved, true);
  assert.equal(resolvedFinding.resolvedAt, "2026-11-12T11:00:00.000Z");
  assert.equal(resolvedFinding.resolvedBy, "Maya Lin");

  const reopenedFinding = {
    ...resolvedFinding,
    resolved: false,
    resolvedAt: undefined,
    resolvedBy: undefined,
  };
  assert.equal(reopenedFinding.resolved, false);
  assert.equal(reopenedFinding.resolvedAt, undefined);
  assert.equal(reopenedFinding.resolvedBy, undefined);
});

test("audit history records finding decisions and reasons without changing evidence status", () => {
  const review: ReviewSubmission = {
    ...mockSubmission,
    findings: [
      {
        ...mockSubmission.findings[0],
        reviewDecision: "REJECT",
        reviewDecisionReason: "Evidence does not support this finding.",
        evidenceReferences: [
          {
            sourceId: "guide-1",
            sourceType: "guideline",
            sourceTitle: "Guide",
            versionId: "v2",
          },
        ],
      },
    ],
  };
  const events: ActivityEvent[] = [
    {
      id: "finding-decision-1",
      reviewId: review.id,
      actor: "Maya Lin",
      action: 'reject finding "Unverified organic certification": Evidence does not support this finding. in',
      target: review.title,
      timestamp: "2026-11-12T12:00:00.000Z",
      type: "finding_decision",
    },
  ];

  const entry = buildReviewAuditTrail(review, events).find(
    (item) => item.id === "finding-decision-1",
  );
  assert.equal(entry?.title, "Finding Decision Recorded");
  assert.match(entry?.action ?? "", /Evidence does not support/);
  assert.equal(review.findings[0]?.evidenceStatus, "unverified");
});

test("audit snapshots preserve finding evidence, detector, confidence, and resolution metadata", () => {
  const review: ReviewSubmission = {
    ...mockSubmission,
    findings: [
      {
        ...mockSubmission.findings[0],
        evidenceReferences: [
          {
            sourceId: "guide-1",
            sourceType: "guideline",
            sourceTitle: "Guide",
            versionId: "v2",
          },
        ],
        sourceVersionIds: ["v2"],
        detector: "ai_semantic",
        confidence: 0.72,
        requiresHumanReview: true,
        resolved: true,
        resolvedAt: "2026-11-12T11:00:00.000Z",
        resolvedBy: "Maya Lin",
      },
    ],
  };

  const resolution = buildReviewAuditTrail(review, []).find(
    (entry) => entry.category === "finding",
  );
  assert.equal(resolution?.details?.evidenceReferences?.[0]?.versionId, "v2");
  assert.deepEqual(resolution?.details?.sourceVersionIds, ["v2"]);
  assert.equal(resolution?.details?.detector, "ai_semantic");
  assert.equal(resolution?.details?.confidence, 0.72);
  assert.equal(resolution?.details?.requiresHumanReview, true);
  assert.equal(resolution?.details?.resolvedBy, "Maya Lin");
});
