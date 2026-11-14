import {
  ReviewFindingSchema,
  type EvidenceReference,
  type ReviewFinding as CanonicalReviewFinding,
} from "../../contracts";
import type { VisualFinding } from "../types";

function mapVisualStatusToCanonical(
  status: VisualFinding["reviewStatus"],
): CanonicalReviewFinding["status"] {
  switch (status) {
    case "candidate":
      return "CONFLICTING";
    case "uncertain":
      return "UNVERIFIED";
    case "needs_human_review":
      return "NEEDS_HUMAN_REVIEW";
  }
}

function mapVisualCategoryToCanonical(
  category: VisualFinding["category"],
): CanonicalReviewFinding["category"] {
  if (category === "typography" || category === "layout") {
    return "VISUAL_COMPLIANCE";
  }
  return "VISUAL_COMPLIANCE";
}

function boxesOverlapSignificantly(
  a: { x: number; y: number; width: number; height: number } | null,
  b: { x: number; y: number; width: number; height: number } | null,
): boolean {
  if (!a || !b) return false;
  const xA = Math.max(a.x, b.x);
  const yA = Math.max(a.y, b.y);
  const xB = Math.min(a.x + a.width, b.x + b.width);
  const yB = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  if (inter <= 0) return false;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 && inter / union > 0.4;
}

/**
 * Deduplicates overlapping visual findings across deterministic, image-matching, and Gemini Vision detectors.
 * Deterministic / image-matching findings take priority over AI vision duplicates.
 */
export function deduplicateVisualFindings(
  findings: VisualFinding[],
): VisualFinding[] {
  const priorityOrder: Record<VisualFinding["detector"], number> = {
    deterministic: 0,
    image_matching: 1,
    ocr: 2,
    gemini_vision: 3,
    openrouter_vision: 3,
  };

  const sorted = [...findings].sort(
    (a, b) => priorityOrder[a.detector] - priorityOrder[b.detector],
  );

  const kept: VisualFinding[] = [];
  for (const candidate of sorted) {
    const duplicate = kept.some((existing) => {
      if (existing.creativeEvidence.pageNumber !== candidate.creativeEvidence.pageNumber) {
        return false;
      }
      if (existing.category !== candidate.category) {
        return false;
      }
      const sameRule =
        existing.ruleId &&
        candidate.ruleId &&
        existing.ruleId.toUpperCase() === candidate.ruleId.toUpperCase();
      const similarTitle =
        existing.title.toLowerCase().trim() === candidate.title.toLowerCase().trim();
      const sameBox = boxesOverlapSignificantly(
        existing.creativeEvidence.boundingBox,
        candidate.creativeEvidence.boundingBox,
      );
      const bothFullPage =
        existing.creativeEvidence.boundingBox === null &&
        candidate.creativeEvidence.boundingBox === null;
      return Boolean(sameRule && (sameBox || bothFullPage)) || similarTitle;
    });

    if (!duplicate) {
      kept.push(candidate);
    }
  }

  return kept;
}

/**
 * Maps internal VisualFinding items into Shruti's canonical ReviewFinding contract,
 * preserving real source provenance, page numbers, and normalized bounding boxes.
 */
export function mapVisualFindingsToCanonical(
  visualFindings: VisualFinding[],
): CanonicalReviewFinding[] {
  return visualFindings.map((vf) => {
    const evidenceReferences: EvidenceReference[] = [];
    if (vf.sourceReference.sourceId) {
      evidenceReferences.push({
        sourceId: vf.sourceReference.sourceId,
        sourceType: "approved_brand_knowledge",
        sourceTitle:
          vf.sourceReference.sourceTitle || "Approved Brand Visual Guidelines",
        ...(vf.sourceReference.excerpt
          ? { excerpt: vf.sourceReference.excerpt }
          : {}),
        ...(vf.sourceReference.pageNumber
          ? { pageNumber: vf.sourceReference.pageNumber }
          : {}),
        ...(vf.sourceReference.sourceVersion
          ? { versionId: vf.sourceReference.sourceVersion }
          : {}),
      });
    }

    const candidate: CanonicalReviewFinding = {
      findingId: vf.id,
      ...(vf.ruleId ? { ruleId: vf.ruleId } : {}),
      category: mapVisualCategoryToCanonical(vf.category),
      severity: vf.severity,
      status: mapVisualStatusToCanonical(vf.reviewStatus),
      issue: vf.title,
      description: vf.explanation,
      detectedValue: vf.observedValue,
      expectedValue: vf.expectedValue,
      explanation: vf.explanation,
      evidenceReferences,
      ...(vf.suggestedCorrection
        ? { suggestedCorrection: vf.suggestedCorrection }
        : {}),
      location: {
        field: `visual:${vf.category}`,
        pageNumber: vf.creativeEvidence.pageNumber,
        assetReference: vf.creativeEvidence.assetId,
        ...(vf.creativeEvidence.boundingBox
          ? { boundingBox: vf.creativeEvidence.boundingBox }
          : {}),
      },
      analysisProvider: `visual-${vf.detector}`,
      detector: vf.detector,
      confidence: vf.confidence,
    };

    return ReviewFindingSchema.parse(candidate);
  });
}
