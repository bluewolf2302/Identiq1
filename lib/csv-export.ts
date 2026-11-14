import { ReviewSubmission } from "./types";
import { ReviewAuditEntry } from "./audit-history";

/**
 * Brand compliance summary row for CSV export
 */
export interface BrandComplianceSummaryRow {
  brand: string;
  totalReviews: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  avgComplianceScore: number;
  totalOpenFindings: number;
  highSeverityCount: number;
  mediumSeverityCount: number;
  lowSeverityCount: number;
}

/**
 * Checks if a string starts with a formula trigger character: =, +, -, @, \t, \r
 * and is NOT a legitimate standalone number.
 */
function isFormulaInjectionRisk(val: string): boolean {
  const trimmed = val.trim();
  if (trimmed.length === 0) return false;

  const firstChar = trimmed[0];
  // Characters that trigger formula execution in Excel/Sheets/Calc
  if (firstChar === "=" || firstChar === "+" || firstChar === "-" || firstChar === "@" || firstChar === "\t" || firstChar === "\r") {
    // If it's a valid numeric value like "-5", "+10", "-3.14", "+0.5", it's safe and legitimate numeric data
    const isStandardNumber = /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed);
    if (isStandardNumber) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Escapes a single cell value according to RFC 4180 with CSV formula injection defense.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "";
    }
    return String(value);
  }

  let str = String(value);

  // Normalize line endings to standard LF
  str = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Prevent Spreadsheet Formula Injection (CSV Injection)
  // If the cell begins with formula characters and is not a number, prepend a single quote (')
  if (isFormulaInjectionRisk(str)) {
    str = "'" + str;
  }

  // RFC 4180: If the string contains comma, quote, or newline, or starts with single quote, enclose in quotes
  const needsQuotes =
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.startsWith("'");

  if (needsQuotes) {
    // Escape all double quotes as double double-quotes ("")
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Builds a CSV row from an array of values
 */
function buildCsvRow(values: unknown[]): string {
  return values.map(escapeCsvField).join(",");
}

/**
 * 1. Reviews Summary CSV
 * Columns: Review ID, Title, Brand, Content Type, Submitter, Submitted At, Status,
 *          Compliance Score, Total Findings, Open Findings, High Severity Findings,
 *          Analysis Run ID, Provider Used
 */
export function generateReviewsSummaryCsv(reviews: ReviewSubmission[]): string {
  const headers = [
    "Review ID",
    "Title",
    "Brand",
    "Content Type",
    "Submitter",
    "Submitted At",
    "Status",
    "Compliance Score",
    "Total Findings",
    "Open Findings",
    "High Severity Findings",
    "Analysis Run ID",
    "Provider Used",
  ];

  const rows = reviews.map((r) => {
    const totalFindings = r.findings?.length || 0;
    const openFindings = r.findings?.filter((f) => !f.resolved).length || 0;
    const highSeverity = r.findings?.filter((f) => !f.resolved && f.severity === "high").length || 0;

    return buildCsvRow([
      r.id,
      r.title,
      r.guidelineCollection,
      r.contentType,
      r.submittedBy,
      r.submittedAt,
      r.status,
      r.complianceScore,
      totalFindings,
      openFindings,
      highSeverity,
      r.analysisRunId || "",
      r.providerUsed || "",
    ]);
  });

  return [buildCsvRow(headers), ...rows].join("\n");
}

/**
 * 2. Detailed Findings CSV
 * Columns: Review ID, Review Title, Brand, Finding ID, Category, Finding Title,
 *          Severity, Evidence Status, Detected Value, Expected Value, Source Reference,
 *          Affected Content, Resolved, Resolved At, Resolved By, Applied Correction
 */
export function generateDetailedFindingsCsv(reviews: ReviewSubmission[]): string {
  const headers = [
    "Review ID",
    "Review Title",
    "Brand",
    "Finding ID",
    "Category",
    "Finding Title",
    "Severity",
    "Evidence Status",
    "Detected Value",
    "Expected Value",
    "Source Reference",
    "Affected Content",
    "Resolved",
    "Resolved At",
    "Resolved By",
    "Applied Correction",
  ];

  const rows: string[] = [];

  for (const review of reviews) {
    if (!review.findings || review.findings.length === 0) {
      continue;
    }
    for (const f of review.findings) {
      rows.push(
        buildCsvRow([
          review.id,
          review.title,
          review.guidelineCollection,
          f.id,
          f.category,
          f.title,
          f.severity,
          f.evidenceStatus,
          f.detectedValue || "",
          f.expectedValue || "",
          f.sourceReference || "",
          f.affectedContent || "",
          f.resolved ? "Resolved" : "Open",
          f.resolvedAt || "",
          f.resolvedBy || "",
          f.editedCorrection || "",
        ])
      );
    }
  }

  return [buildCsvRow(headers), ...rows].join("\n");
}

/**
 * 3. Compliance Summary CSV
 * Columns: Brand, Total Reviews, Approved, Pending, Changes Requested,
 *          Average Score, Total Open Findings, High Severity, Medium Severity, Low Severity
 */
export function generateComplianceSummaryCsv(summaries: BrandComplianceSummaryRow[]): string {
  const headers = [
    "Brand",
    "Total Reviews",
    "Approved",
    "Pending",
    "Changes Requested",
    "Average Score",
    "Total Open Findings",
    "High Severity",
    "Medium Severity",
    "Low Severity",
  ];

  const rows = summaries.map((s) =>
    buildCsvRow([
      s.brand,
      s.totalReviews,
      s.approvedCount,
      s.pendingCount,
      s.rejectedCount,
      s.avgComplianceScore,
      s.totalOpenFindings,
      s.highSeverityCount,
      s.mediumSeverityCount,
      s.lowSeverityCount,
    ])
  );

  return [buildCsvRow(headers), ...rows].join("\n");
}

/**
 * 4. Audit History CSV
 * Columns: Timestamp, Review ID, Review Title, Category, Action, Actor, Actor Role,
 *          Provenance, Status, Finding ID, Finding Title, Severity, Details
 */
export function generateAuditTrailCsv(
  entries: ReviewAuditEntry[],
  reviewTitle?: string
): string {
  const headers = [
    "Timestamp",
    "Review ID",
    "Review Title",
    "Category",
    "Action",
    "Actor",
    "Actor Role",
    "Provenance",
    "Status",
    "Finding ID",
    "Finding Title",
    "Severity",
    "Details",
  ];

  const rows = entries.map((e) => {
    const details = e.details;
    const detailParts: string[] = [];
    if (details?.detectedValue) detailParts.push(`Detected: ${details.detectedValue}`);
    if (details?.expectedValue) detailParts.push(`Expected: ${details.expectedValue}`);
    if (details?.correctionText) detailParts.push(`Correction: ${details.correctionText}`);
    if (details?.commentText) detailParts.push(`Comment: ${details.commentText}`);
    if (details?.reviewerNote) detailParts.push(`Note: ${details.reviewerNote}`);
    if (details?.previousValueNotice) detailParts.push(details.previousValueNotice);

    return buildCsvRow([
      e.timestamp,
      e.reviewId,
      reviewTitle || e.reviewId,
      e.category,
      e.action,
      e.actor,
      e.actorRole || "",
      e.isRecordedEvent ? "Recorded Event" : "Current Snapshot",
      e.statusLabel || "",
      details?.findingId || "",
      details?.findingTitle || "",
      details?.severity || "",
      detailParts.join(" | "),
    ]);
  });

  return [buildCsvRow(headers), ...rows].join("\n");
}

/**
 * Triggers a browser file download with UTF-8 BOM for Microsoft Excel / Sheets compatibility.
 */
export function downloadCsv(filename: string, csvContent: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  // Prepend UTF-8 BOM (\uFEFF)
  const bom = "\uFEFF";
  const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
