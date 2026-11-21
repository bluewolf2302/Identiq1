import assert from "node:assert/strict";
import test from "node:test";

import type { EvidenceReference } from "../lib/contracts/findings";
import type { ReviewSubmission } from "../lib/types";
import {
  findReviewEvidenceForSource,
  getVersionedEvidenceSources,
} from "../lib/recall/review-evidence";

function createReview(
  id: string,
  evidenceReferences: EvidenceReference[]
): ReviewSubmission {
  return {
    id,
    title: `Review ${id}`,
    contentType: "Campaign Copy",
    guidelineCollection: "Brand Guidelines",
    submittedBy: "Reviewer",
    submittedAt: "2026-01-01",
    status: "Approved",
    complianceScore: 100,
    textContent: "Example copy",
    findings: evidenceReferences.length
      ? [
          {
            id: `finding-${id}`,
            category: "Brand Claims",
            title: "Evidence-backed finding",
            description: "Test finding",
            severity: "low",
            evidenceStatus: "supported",
            detectedValue: "",
            expectedValue: "",
            sourceReference: "",
            recommendation: "",
            affectedContent: "",
            resolved: false,
            comments: [],
            evidenceReferences,
          },
        ]
      : [],
    pastelTheme: "blue",
  };
}

test("lists unique sources only when their evidence is versioned", () => {
  const reviews = [
    createReview("review-1", [
      {
        sourceId: "guide-1",
        sourceType: "guideline",
        sourceTitle: "Brand Guide",
        versionId: "v1",
      },
      {
        sourceId: "unversioned",
        sourceType: "guideline",
        sourceTitle: "Unversioned Guide",
      },
    ]),
    createReview("review-2", [
      {
        sourceId: "guide-1",
        sourceType: "guideline",
        sourceTitle: "Brand Guide",
        versionId: "v2",
      },
      {
        sourceId: "facts-1",
        sourceType: "product-fact",
        sourceTitle: "Product Facts",
        versionId: "v1",
      },
    ]),
  ];

  assert.deepEqual(
    getVersionedEvidenceSources(reviews).map((source) => source.sourceId),
    ["guide-1", "facts-1"]
  );
});

test("matches selected sources to loaded reviews and versions only", () => {
  const reviews = [
    createReview("review-1", [
      {
        sourceId: "guide-1",
        sourceType: "guideline",
        sourceTitle: "Brand Guide",
        versionId: "v1",
      },
      {
        sourceId: "guide-1",
        sourceType: "guideline",
        sourceTitle: "Brand Guide",
      },
    ]),
    createReview("review-2", [
      {
        sourceId: "guide-1",
        sourceType: "guideline",
        sourceTitle: "Brand Guide",
        versionId: "v2",
      },
      {
        sourceId: "guide-1",
        sourceType: "product-fact",
        sourceTitle: "Product Facts",
        versionId: "v3",
      },
    ]),
  ];

  assert.deepEqual(
    findReviewEvidenceForSource(reviews, "guide-1", "guideline").map(
      ({ reviewId, versionId }) => [reviewId, versionId]
    ),
    [
      ["review-1", "v1"],
      ["review-2", "v2"],
    ]
  );
  assert.deepEqual(findReviewEvidenceForSource(reviews, "", "guideline"), []);
});
