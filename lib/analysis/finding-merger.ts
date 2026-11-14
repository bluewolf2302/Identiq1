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

function isDuplicate(
  deterministic: ReviewFinding,
  semantic: ReviewFinding,
): boolean {
  if (
    deterministic.category !== semantic.category ||
    normalize(deterministic.issue) !== normalize(semantic.issue)
  ) {
    return false;
  }

  return (
    hasSameLocation(deterministic, semantic) ||
    evidenceSignature(deterministic) === evidenceSignature(semantic)
  );
}

export function mergeFindings(
  deterministicFindings: ReviewFinding[],
  semanticFindings: ReviewFinding[],
  visualFindings: ReviewFinding[] = [],
): ReviewFinding[] {
  const merged = [...deterministicFindings];
  for (const semanticFinding of semanticFindings) {
    if (
      !deterministicFindings.some((deterministicFinding) =>
        isDuplicate(deterministicFinding, semanticFinding),
      )
    ) {
      merged.push(semanticFinding);
    }
  }
  for (const visualFinding of visualFindings) {
    if (
      !merged.some((existing) => isDuplicate(existing, visualFinding))
    ) {
      merged.push(visualFinding);
    }
  }
  return merged;
}
