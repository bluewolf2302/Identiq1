import type { ReviewFinding } from "../contracts";

/**
 * 0.65 is the existing visual OCR ambiguity baseline. It is not statistically
 * calibrated across OCR, visual, deterministic, and semantic model scores, so
 * it is used provisionally for review routing only.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.65;

export function applyFindingReliabilityPolicy(
  finding: ReviewFinding,
  evidenceSufficient: boolean,
): ReviewFinding {
  const requiresReview =
    !evidenceSufficient ||
    (finding.confidence !== undefined &&
      finding.confidence < LOW_CONFIDENCE_THRESHOLD &&
      (finding.status === "SUPPORTED" || finding.status === "CONFLICTING"));

  const reviewed = requiresReview
    ? {
        ...finding,
        status: "NEEDS_HUMAN_REVIEW" as const,
      }
    : finding;

  return {
    ...reviewed,
    suggestedCorrection: ensureActionableCorrection(reviewed),
  };
}

function ensureActionableCorrection(finding: ReviewFinding): string {
  if (
    finding.suggestedCorrection?.trim() &&
    !(
      (finding.status === "UNVERIFIED" ||
        finding.status === "NEEDS_HUMAN_REVIEW") &&
      !/\b(remove|verify)\b/i.test(finding.suggestedCorrection)
    )
  ) {
    return finding.suggestedCorrection;
  }

  const evidence = finding.evidenceReferences[0];
  const guideline = evidence
    ? `${evidence.sourceTitle}${evidence.versionId ? ` (version ${evidence.versionId})` : ""}`
    : "the approved brand guidelines";

  if (
    finding.status === "UNVERIFIED" ||
    finding.status === "NEEDS_HUMAN_REVIEW"
  ) {
    return `Verify this claim against ${guideline} before publication; remove it if verification is unavailable.`;
  }

  if (
    finding.category === "FACT_VERIFICATION" ||
    finding.category === "PROMOTIONAL_CLAIM"
  ) {
    return `Remove the unsupported claim or verify it against ${guideline}; do not replace it with an unapproved fact.`;
  }

  return `Revise the content to comply with the cited guidance in ${guideline}.`;
}
