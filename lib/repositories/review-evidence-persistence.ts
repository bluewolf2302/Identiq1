import { z } from "zod";

import { EvidenceReferenceSchema } from "../contracts/findings";
import type { ReviewFinding } from "../types";

const PersistedReviewEvidenceSchema = z
  .object({
    evidence_references: z.array(EvidenceReferenceSchema).nullable().optional(),
    source_version_ids: z.array(z.string().min(1)).nullable().optional(),
  })
  .passthrough();

export function serializeReviewFindingForRpc(
  finding: ReviewFinding,
): ReviewFinding {
  if (finding.evidenceReferences !== undefined) {
    z.array(EvidenceReferenceSchema).parse(finding.evidenceReferences);
  }
  if (finding.sourceVersionIds !== undefined) {
    z.array(z.string().min(1)).parse(finding.sourceVersionIds);
  }
  return finding;
}

export function mapPersistedReviewFindingEvidence(
  row: Record<string, unknown>,
): Pick<ReviewFinding, "evidenceReferences" | "sourceVersionIds"> {
  const parsed = PersistedReviewEvidenceSchema.parse(row);
  return {
    ...(parsed.evidence_references
      ? { evidenceReferences: parsed.evidence_references }
      : {}),
    ...(parsed.source_version_ids
      ? { sourceVersionIds: parsed.source_version_ids }
      : {}),
  };
}
