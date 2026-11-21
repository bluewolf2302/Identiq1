import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewFinding } from "../lib/types";
import {
  mapPersistedReviewFindingEvidence,
  serializeReviewFindingForRpc,
} from "../lib/repositories/review-evidence-persistence";

const finding: ReviewFinding = {
  id: "finding-1",
  category: "Brand Claims",
  title: "Price claim",
  description: "The claim needs its source.",
  severity: "medium",
  evidenceStatus: "supported",
  detectedValue: "₹499",
  expectedValue: "₹499",
  sourceReference: "Approved product record",
  recommendation: "",
  affectedContent: "₹499",
  resolved: false,
  comments: [],
  evidenceReferences: [
    {
      sourceId: "product-record-1",
      sourceType: "product-fact",
      sourceTitle: "Approved product facts",
      versionId: "source-version-7",
    },
  ],
  sourceVersionIds: ["source-version-7"],
};

test("preserves structured evidence through RPC serialization and database mapping", () => {
  const rpcFinding = serializeReviewFindingForRpc(finding);
  const loadedEvidence = mapPersistedReviewFindingEvidence({
    evidence_references: rpcFinding.evidenceReferences,
    source_version_ids: rpcFinding.sourceVersionIds,
  });

  assert.deepEqual(loadedEvidence, {
    evidenceReferences: finding.evidenceReferences,
    sourceVersionIds: finding.sourceVersionIds,
  });
});

test("rejects malformed persisted evidence instead of silently dropping it", () => {
  assert.throws(
    () =>
      mapPersistedReviewFindingEvidence({
        evidence_references: [{ sourceId: "missing-required-fields" }],
        source_version_ids: ["source-version-7"],
      }),
  );
});
