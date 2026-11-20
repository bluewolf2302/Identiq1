import assert from "node:assert/strict";
import test from "node:test";
import { compareAnalysisRuns, compareReviewFindingPayloads } from "../lib/analysis";
import type { AnalysisResponse, ReviewFinding } from "../lib/contracts";

function finding(id: string, issue: string, status: ReviewFinding["status"] = "UNVERIFIED"): ReviewFinding {
  return {
    findingId: id,
    category: "TONE_AND_TERMINOLOGY",
    severity: "MEDIUM",
    status,
    issue,
    description: "Description",
    explanation: "Explanation",
    evidenceReferences: [],
    analysisProvider: "test",
  };
}

function response(runId: string, findings: ReviewFinding[], status: AnalysisResponse["analysisStatus"]): AnalysisResponse {
  return {
    submissionId: "submission-1",
    analysisRunId: runId,
    analysisStatus: status,
    findings,
    providerUsed: "test",
    fallbackUsed: false,
    analysisTimestamp: "2026-01-02T03:04:05.000Z",
  };
}

test("compares added, removed, changed, and unchanged findings across runs", () => {
  const unchanged = finding("finding-1", "Same issue");
  const changedPrevious = finding("finding-2", "Old issue");
  const changedCurrent = finding("finding-2-new", "Old issue", "CONFLICTING");
  const previous = response("run-old", [unchanged, changedPrevious, finding("removed", "Removed")], "COMPLETED");
  const current = response("run-new", [unchanged, changedCurrent, finding("added", "Added")], "PARTIAL");

  const comparison = compareAnalysisRuns(previous, current);

  assert.equal(comparison.previousRunId, "run-old");
  assert.equal(comparison.currentRunId, "run-new");
  assert.deepEqual(comparison.summary, {
    added: 1,
    removed: 1,
    changed: 1,
    unchanged: 1,
  });
  assert.ok(comparison.findings.some((item) => item.status === "CHANGED"));
  assert.ok(comparison.findings.some((item) => item.status === "ADDED"));
  assert.ok(comparison.findings.some((item) => item.status === "REMOVED"));
});

test("creates frontend-compatible persisted re-analysis comparisons", () => {
  const previous = [{
    id: "f-1",
    category: "Tone & Voice",
    title: "Dismissive phrase",
    description: "Old explanation",
    severity: "medium",
    evidenceStatus: "unverified",
    detectedValue: "Stop",
    expectedValue: "Helpful",
    sourceReference: "Guide v1",
  }];
  const current = [{
    id: "f-2",
    category: "Tone & Voice",
    title: "Dismissive phrase",
    description: "New explanation",
    severity: "high",
    evidenceStatus: "supported",
    detectedValue: "Stop",
    expectedValue: "Helpful",
    sourceReference: "Guide v1",
  }];

  const comparison = compareReviewFindingPayloads(
    "run-old",
    "run-new",
    "COMPLETED",
    "PARTIAL",
    previous,
    current,
  );

  assert.equal(comparison.summary.changed, 1);
  assert.equal(comparison.findings[0]?.status, "CHANGED");
  assert.equal(comparison.previousRunId, "run-old");
  assert.equal(comparison.currentRunId, "run-new");
});
