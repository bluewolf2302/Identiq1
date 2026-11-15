import type { BrandContext, EvidenceReference } from "../contracts";

export interface ApprovedSourceRecord {
  sourceId: string;
  versionId: string;
  sourceTitle: string;
  excerpts: string[];
}

const sourceLabelPattern =
  /\[Source:\s*(.+?)\s+\(([^;()[\]]+);\s*([^;()[\]]+)/i;

export function collectApprovedSourceRecords(
  context: BrandContext,
): Map<string, ApprovedSourceRecord> {
  const records = new Map<string, ApprovedSourceRecord>();
  for (const label of context.sourceVersionInformation.split(/\s+\|\s+/)) {
    const match = label.match(/^(.+?)\s+\(([^;]+);\s*([^;)]+)/);
    if (match) {
      records.set(match[2].trim(), {
        sourceId: match[2].trim(),
        versionId: match[3].trim(),
        sourceTitle: match[1].trim(),
        excerpts: [],
      });
    }
  }

  const values = [
    ...context.approvedGuidelines,
    ...context.approvedProductFacts,
    ...context.approvedPromotionalClaims,
    ...context.preferredTerminology,
    ...context.prohibitedTerminology,
    ...context.approvedColours,
    ...context.approvedVisualAssetReferences,
  ];
  for (const value of values) {
    const match = value.match(sourceLabelPattern);
    if (!match) continue;
    const sourceId = match[2].trim();
    const record = records.get(sourceId);
    if (record) {
      record.excerpts.push(value);
    }
  }
  return records;
}

export function isApprovedEvidenceReference(
  reference: EvidenceReference,
  records: Map<string, ApprovedSourceRecord>,
): boolean {
  const record = records.get(reference.sourceId);
  if (!record || record.versionId !== reference.versionId) return false;
  if (record.sourceTitle !== reference.sourceTitle) return false;
  if (!reference.excerpt) return true;
  const excerpt = normalizeEvidenceText(reference.excerpt);
  return record.excerpts.some((value) =>
    normalizeEvidenceText(value).includes(excerpt),
  );
}

function normalizeEvidenceText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}
