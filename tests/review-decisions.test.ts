import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFindingDecisionPatch,
  getFindingDecisionValidationError,
} from "../lib/review-decisions";

test("clears a stale decision reason when a later decision has no reason", () => {
  const existingFinding = {
    reviewDecision: "REJECT",
    reviewDecisionReason: "Previous rejection reason",
  };
  const patch = buildFindingDecisionPatch(
    "APPROVE",
    undefined,
    "Maya Lin",
    "2026-11-14T12:00:00.000Z",
  );
  const updatedFinding = { ...existingFinding, ...patch };

  assert.equal(updatedFinding.reviewDecision, "APPROVE");
  assert.equal(updatedFinding.reviewDecisionReason, undefined);
});

test("requires a non-whitespace reason for rejection", () => {
  assert.equal(
    getFindingDecisionValidationError("REJECT", "   "),
    "A reason is required to reject a finding.",
  );
  assert.equal(getFindingDecisionValidationError("REJECT"), "A reason is required to reject a finding.");
  assert.equal(getFindingDecisionValidationError("APPROVE"), undefined);
  assert.equal(getFindingDecisionValidationError("REQUEST_CHANGES"), undefined);
});

test("marks request-changes decisions for human review", () => {
  const patch = buildFindingDecisionPatch(
    "REQUEST_CHANGES",
    "Please verify the evidence.",
    "Maya Lin",
    "2026-11-14T12:00:00.000Z",
  );

  assert.equal(patch.requiresHumanReview, true);
  assert.equal(patch.reviewDecisionReason, "Please verify the evidence.");
});
