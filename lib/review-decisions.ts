import type { ReviewDecision } from "./contracts/workflow";
import type { ReviewFinding } from "./types";

export function getFindingDecisionValidationError(
  decision: ReviewDecision,
  reason?: string,
): string | undefined {
  if (decision === "REJECT" && !reason?.trim()) {
    return "A reason is required to reject a finding.";
  }
  return undefined;
}

export function buildFindingDecisionPatch(
  decision: ReviewDecision,
  reason: string | undefined,
  reviewer: string,
  timestamp: string,
): Pick<
  ReviewFinding,
  | "reviewDecision"
  | "reviewDecisionReason"
  | "reviewDecisionAt"
  | "reviewDecisionBy"
  | "requiresHumanReview"
> {
  return {
    reviewDecision: decision,
    reviewDecisionReason: reason?.trim() || undefined,
    reviewDecisionAt: timestamp,
    reviewDecisionBy: reviewer,
    ...(decision === "REQUEST_CHANGES" ? { requiresHumanReview: true } : {}),
  };
}
