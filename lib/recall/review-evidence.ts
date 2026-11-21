
import type { ReviewSubmission } from "@/lib/types";

export type MatchingReviewEvidence = {
  reviewId: string;
  reviewTitle: string;
  analysisRunId?: string;
  sourceId: string;
  sourceType: string;
  versionId: string;
};

export function findReviewEvidenceForSource(
  reviews: ReviewSubmission[],
  sourceId: string,
  sourceType: string
): MatchingReviewEvidence[] {
  if (!sourceId.trim() || !sourceType.trim()) {
    return [];
  }

  const matches = new Map<string, MatchingReviewEvidence>();

  for (const review of reviews) {
    for (const finding of review.findings) {
      for (const reference of finding.evidenceReferences ?? []) {
        if (
          reference.sourceId !== sourceId ||
          reference.sourceType !== sourceType ||
          !reference.versionId
        ) {
          continue;
        }

        const match: MatchingReviewEvidence = {
          reviewId: review.id,
          reviewTitle: review.title,
          analysisRunId: review.analysisRunId,
          sourceId: reference.sourceId,
          sourceType: reference.sourceType,
          versionId: reference.versionId,
        };

        const key = JSON.stringify([
          match.reviewId,
          match.analysisRunId,
          match.sourceId,
          match.sourceType,
          match.versionId,
        ]);

        matches.set(key, match);
      }
    }
  }

  return [...matches.values()];
}
