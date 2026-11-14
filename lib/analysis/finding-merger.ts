import type { ReviewFinding } from "../contracts";

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function evidenceSignature(finding: ReviewFinding): string {
  return finding.evidenceReferences
    .map(
      (reference) =>
        `${reference.sourceId}|${reference.versionId ?? ""}|${reference.excerpt ?? ""}`,
    )
    .sort()
    .join(";");
}

function evidenceIdentities(finding: ReviewFinding): Set<string> {
  return new Set(
    finding.evidenceReferences.map(
      (reference) => `${reference.sourceId}|${reference.versionId ?? ""}`,
    ),
  );
}

function hasSameLocation(
  left: ReviewFinding,
  right: ReviewFinding,
): boolean {
  const leftLocation = left.location;
  const rightLocation = right.location;
  if (!leftLocation || !rightLocation) {
    return false;
  }

  return (
    leftLocation.startOffset === rightLocation.startOffset &&
    leftLocation.endOffset === rightLocation.endOffset &&
    leftLocation.field === rightLocation.field &&
    leftLocation.pageNumber === rightLocation.pageNumber
  );
}

export function areDuplicateFindings(
  deterministic: ReviewFinding,
  semantic: ReviewFinding,
): boolean {
  if (deterministic.category !== semantic.category) {
    return false;
  }

  const sameEvidence =
    deterministic.evidenceReferences.length > 0 &&
    semantic.evidenceReferences.length > 0 &&
    evidenceSignature(deterministic) === evidenceSignature(semantic);
  const sharedEvidenceIdentity =
    deterministic.evidenceReferences.length > 0 &&
    semantic.evidenceReferences.length > 0 &&
    [...evidenceIdentities(deterministic)].some((identity) =>
      evidenceIdentities(semantic).has(identity),
    );
  const conflictingEvidenceIdentity =
    deterministic.evidenceReferences.length > 0 &&
    semantic.evidenceReferences.length > 0 &&
    !sharedEvidenceIdentity;
  if (conflictingEvidenceIdentity) {
    return false;
  }
  const sameDetectedText =
    Boolean(deterministic.detectedValue && semantic.detectedValue) &&
    normalize(deterministic.detectedValue ?? "") ===
      normalize(semantic.detectedValue ?? "");
  const issueSimilarity = sharedIssueTokenRatio(
    deterministic.issue,
    semantic.issue,
  );
  const meaningfulIssueMatch = issueSimilarity >= 0.75;
  return (
    meaningfulIssueMatch &&
    (sameEvidence ||
      sameDetectedText ||
      hasSameLocation(deterministic, semantic))
  );
}

export function mergeFindings(
  deterministicFindings: ReviewFinding[],
  semanticFindings: ReviewFinding[],
  visualFindings: ReviewFinding[] = [],
): ReviewFinding[] {
  const merged = [...deterministicFindings];
  for (const semanticFinding of semanticFindings) {
    const duplicateIndex = deterministicFindings.findIndex((deterministicFinding) =>
      areDuplicateFindings(deterministicFinding, semanticFinding),
    );
    if (duplicateIndex === -1) {
      merged.push(semanticFinding);
    } else {
      const existing = merged[duplicateIndex]!;
      merged[duplicateIndex] = {
        ...existing,
        explanation:
          existing.explanation.length >= semanticFinding.explanation.length
            ? existing.explanation
            : semanticFinding.explanation,
        suggestedCorrection:
          existing.suggestedCorrection ?? semanticFinding.suggestedCorrection,
        evidenceReferences: [
          ...existing.evidenceReferences,
          ...semanticFinding.evidenceReferences.filter(
            (reference) =>
              !existing.evidenceReferences.some(
                (current) =>
                  current.sourceId === reference.sourceId &&
                  current.versionId === reference.versionId &&
                  current.excerpt === reference.excerpt,
              ),
          ),
        ],
      };
    }
  }
  for (const visualFinding of visualFindings) {
    if (
      !merged.some((existing) => areDuplicateFindings(existing, visualFinding))
    ) {
      merged.push(visualFinding);
    }
  }
  return merged;
}

function sharedIssueTokenRatio(left: string, right: string): number {
  const leftTokens = new Set(normalize(left).split(/\W+/).filter(Boolean));
  const rightTokens = new Set(normalize(right).split(/\W+/).filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token));
  if (shared.length < 2) return 0;
  return shared.length / Math.min(leftTokens.size, rightTokens.size);
}
