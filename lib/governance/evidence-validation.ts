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
    const openIndex = label.lastIndexOf("(");
    const closeIndex = label.lastIndexOf(")");
    if (openIndex >= 0 && closeIndex === label.length - 1) {
      const title = label.slice(0, openIndex).trim();
      const parts = label.slice(openIndex + 1, closeIndex).split(";");
      if (title && parts.length >= 2) {
        records.set(parts[0].trim(), {
          sourceId: parts[0].trim(),
          versionId: parts[1].trim(),
          sourceTitle: title,
          excerpts: [],
        });
      }
    } else {
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
  }

  function parseSourceLabel(value: string):
    | { sourceTitle: string; sourceId: string; versionId: string }
    | undefined {
      const sourceIndex = value.indexOf("[Source:");
      if (sourceIndex < 0) return undefined;
      const content = value.slice(sourceIndex + 8).trim();
      const closeIndex = content.lastIndexOf(")");
      const openIndex = content.lastIndexOf("(", closeIndex);
      if (openIndex < 0 || closeIndex < openIndex) return undefined;
      const title = content.slice(0, openIndex).trim();
      const parts = content.slice(openIndex + 1, closeIndex).split(";");
      if (!title || parts.length < 2) return undefined;
      return {
        sourceTitle: title,
        sourceId: parts[0].trim(),
        versionId: parts[1].trim(),
      };
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
    const parsed = parseSourceLabel(value);
    if (!parsed) {
      const match = value.match(sourceLabelPattern);
      if (!match) continue;
      const sourceId = match[2].trim();
      const record = records.get(sourceId);
      if (record) record.excerpts.push(value);
      continue;
    }
    const record = records.get(parsed.sourceId);
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
