import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewFinding } from "../lib/contracts";
import {
  applyFindingReliabilityPolicy,
  LOW_CONFIDENCE_THRESHOLD,
} from "../lib/governance/finding-policy";

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    findingId: "finding-1",
    category: "FACT_VERIFICATION",
    severity: "HIGH",
    status: "UNVERIFIED",
    issue: "Unsupported claim",
    description: "The claim needs verification.",
    explanation: "No approved fact confirms the claim.",
    evidenceReferences: [
      {
        sourceId: "guide-1",
        sourceType: "guideline",
        sourceTitle: "Guide",
        versionId: "v1",
      },
    ],
    analysisProvider: "test",
    ...overrides,
  };
}

test("routes low confidence findings to review without changing evidence", () => {
  const result = applyFindingReliabilityPolicy(
    finding({
      status: "CONFLICTING",
      confidence: LOW_CONFIDENCE_THRESHOLD - 0.01,
    }),
    true,
  );

  assert.equal(result.status, "NEEDS_HUMAN_REVIEW");
  assert.equal(result.evidenceReferences[0]?.sourceId, "guide-1");
  assert.equal(result.confidence, LOW_CONFIDENCE_THRESHOLD - 0.01);
});

test("does not apply the provisional threshold to deterministic confidence 1", () => {
  const result = applyFindingReliabilityPolicy(
    finding({
      status: "CONFLICTING",
      confidence: 1,
      analysisProvider: "deterministic-text-engine",
    }),
    true,
  );

  assert.equal(result.status, "CONFLICTING");
});

test("provides removal or verification guidance without inventing facts", () => {
  const result = applyFindingReliabilityPolicy(finding(), false);

  assert.match(result.suggestedCorrection ?? "", /remove|verify/i);
  assert.doesNotMatch(result.suggestedCorrection ?? "", /approved value is|replace with/i);
  assert.match(result.suggestedCorrection ?? "", /Guide \(version v1\)/);
});

test("preserves an existing correction", () => {
  const result = applyFindingReliabilityPolicy(
    finding({
      status: "CONFLICTING",
      suggestedCorrection: "Use the approved wording from the guide.",
    }),
    true,
  );

  assert.equal(result.suggestedCorrection, "Use the approved wording from the guide.");
});

test("replaces an unsupported replacement that could contradict the guideline", () => {
  const result = applyFindingReliabilityPolicy(
    finding({
      suggestedCorrection: "Replace this with the unapproved replacement claim.",
    }),
    false,
  );

  assert.match(result.suggestedCorrection ?? "", /remove|verify/i);
  assert.doesNotMatch(result.suggestedCorrection ?? "", /unapproved replacement claim/i);
});
