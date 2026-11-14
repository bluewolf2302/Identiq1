import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeCsvField,
  generateReviewsSummaryCsv,
  generateDetailedFindingsCsv,
  generateComplianceSummaryCsv,
  generateAuditTrailCsv,
  downloadCsv,
} from "../lib/csv-export";
import {
  filterReviewsForReporting,
  getCreativesAtRisk,
  computeBrandComplianceSummaries,
  compileBrandComplianceReport,
  getReviewById,
  assessReviewRisk,
  formatReportTimestamp,
  type ReportingFilters,
} from "../lib/reporting";
import { buildReviewAuditTrail } from "../lib/audit-history";
import type { ReviewSubmission, ActivityEvent } from "../lib/types";

const mockReviews: ReviewSubmission[] = [
  {
    id: "rev-101",
    title: "Solstice Radiant Serum Campaign",
    contentType: "Campaign Copy",
    guidelineCollection: "Solstice Botanicals",
    submittedBy: "Elena Vance",
    submittedAt: "2026-11-12T09:42:00.000Z",
    status: "Changes Requested",
    complianceScore: 68,
    pastelTheme: "pink",
    textContent: "The only serum that permanently reverses cellular aging.",
    providerUsed: "Gemini 2.5 Flash",
    analysisRunId: "run-001",
    analysisStatus: "COMPLETED",
    findings: [
      {
        id: "f-101-1",
        category: "Brand Claims",
        title: "Impermissible permanency claim",
        description: "Permanency claims violate consumer protection regulations.",
        severity: "high",
        evidenceStatus: "conflicting",
        detectedValue: "permanently reverses",
        expectedValue: "visibly diminishes appearance of",
        sourceReference: "Section 4.2",
        recommendation: "Update wording to approved structure.",
        affectedContent: "permanently reverses",
        resolved: false,
        comments: [],
      },
      {
        id: "f-101-2",
        category: "Terminology",
        title: "Unapproved cellular descriptor",
        description: "Cellular terminology is restricted to clinical line.",
        severity: "medium",
        evidenceStatus: "conflicting",
        detectedValue: "cellular aging",
        expectedValue: "signs of aging",
        sourceReference: "Section 2.1",
        recommendation: "Replace with signs of aging.",
        affectedContent: "cellular aging",
        resolved: true,
        resolvedAt: "2026-11-12T10:15:00.000Z",
        resolvedBy: "Elena Vance",
        editedCorrection: "signs of aging",
        comments: [],
      },
    ],
  },
  {
    id: "rev-102",
    title: "Solstice Social Teaser Launch",
    contentType: "Social Creative",
    guidelineCollection: "Solstice Botanicals",
    submittedBy: "Marcus Reed",
    submittedAt: "2026-11-10T14:30:00.000Z",
    status: "Approved",
    complianceScore: 94,
    pastelTheme: "mint",
    textContent: "Pure radiance sourced from certified botanical harvests.",
    providerUsed: "Gemini 2.5 Flash",
    analysisRunId: "run-002",
    analysisStatus: "COMPLETED",
    findings: [
      {
        id: "f-102-1",
        category: "Brand Claims",
        title: "Certified harvest claim",
        description: "Harvest certification valid through 2027.",
        severity: "low",
        evidenceStatus: "supported",
        detectedValue: "certified botanical harvests",
        expectedValue: "certified botanical harvests",
        sourceReference: "Cert #9921",
        recommendation: "No action required.",
        affectedContent: "certified botanical harvests",
        resolved: true,
        comments: [],
      },
    ],
  },
  {
    id: "rev-103",
    title: "Teralune Hardware Launch Release",
    contentType: "Press Release",
    guidelineCollection: "Teralune Systems",
    submittedBy: "Kenji Sato",
    submittedAt: "2026-11-11T16:00:00.000Z",
    status: "Pending Approval",
    complianceScore: 78,
    pastelTheme: "peach",
    textContent: "Next generation edge computing with sub-millisecond telemetry.",
    providerUsed: "OpenRouter (Claude 3.5 Sonnet)",
    analysisRunId: "run-003",
    analysisStatus: "COMPLETED",
    findings: [
      {
        id: "f-103-1",
        category: "Legal & Usage",
        title: "Telemetry trademark attribution",
        description: "Missing registered trademark symbol on first mention.",
        severity: "high",
        evidenceStatus: "unverified",
        detectedValue: "sub-millisecond telemetry",
        expectedValue: "Telemetry™",
        sourceReference: "Trademark Policy 1.1",
        recommendation: "Add trademark symbol.",
        affectedContent: "telemetry",
        resolved: false,
        comments: [],
      },
    ],
  },
];

const mockActivities: ActivityEvent[] = [
  {
    id: "act-1",
    timestamp: "2026-11-12T09:42:00.000Z",
    actor: "Elena Vance",
    action: "submitted creative",
    target: "Solstice Radiant Serum Campaign",
    reviewId: "rev-101",
    type: "submitted",
  },
  {
    id: "act-2",
    timestamp: "2026-11-12T10:15:00.000Z",
    actor: "Elena Vance",
    action: "applied copy correction",
    target: "Unapproved cellular descriptor",
    reviewId: "rev-101",
    type: "correction_applied",
  },
];

const fixedReferenceNow = new Date("2026-11-14T18:00:00.000Z");

// ============================================================================
// 1. CSV EXPORT UTILITIES & RFC 4180 COMPLIANCE TESTS
// ============================================================================

test("escapeCsvField handles primitives correctly", () => {
  assert.equal(escapeCsvField(null), "");
  assert.equal(escapeCsvField(undefined), "");
  assert.equal(escapeCsvField(true), "true");
  assert.equal(escapeCsvField(false), "false");
  assert.equal(escapeCsvField(42), "42");
  assert.equal(escapeCsvField(0), "0");
  assert.equal(escapeCsvField(NaN), "");
  assert.equal(escapeCsvField(Infinity), "");
  assert.equal(escapeCsvField("Simple string"), "Simple string");
});

test("escapeCsvField escapes commas, double quotes, and newlines per RFC 4180", () => {
  // Comma requires quotes
  assert.equal(escapeCsvField("Hello, World"), '"Hello, World"');

  // Double quotes inside are escaped as double double-quotes
  assert.equal(escapeCsvField('Said "Hello"'), '"Said ""Hello"""');

  // Newlines require quotes
  assert.equal(escapeCsvField("Line 1\nLine 2"), '"Line 1\nLine 2"');
  assert.equal(escapeCsvField("Line 1\r\nLine 2"), '"Line 1\nLine 2"');

  // Combined commas, quotes, and newlines
  assert.equal(
    escapeCsvField('Complex "phrase",\nwith multiple lines'),
    '"Complex ""phrase"",\nwith multiple lines"'
  );
});

test("escapeCsvField protects against Spreadsheet Formula Injection (CSV Injection)", () => {
  // Formula injection attempts starting with =, +, -, @, \t, \r
  const equalsFormula = "=SUM(A1:A10)";
  assert.equal(escapeCsvField(equalsFormula), '"\'=SUM(A1:A10)"');

  const plusFormula = "+cmd|' /C calc'!A0";
  assert.equal(escapeCsvField(plusFormula), '"\'+cmd|\' /C calc\'!A0"');

  const quotesInFormula = '+cmd|"calc"!A0';
  assert.equal(escapeCsvField(quotesInFormula), '"\'+cmd|""calc""!A0"');

  const minusFormula = "-2+3*[something]";
  assert.equal(escapeCsvField(minusFormula), '"\'-2+3*[something]"');

  const atFormula = "@SUM(B1:B5)";
  assert.equal(escapeCsvField(atFormula), '"\'@SUM(B1:B5)"');

  // Legitimate standalone numbers must NOT be treated as formula injection
  assert.equal(escapeCsvField("-5"), "-5");
  assert.equal(escapeCsvField("+10"), "+10");
  assert.equal(escapeCsvField("-3.14"), "-3.14");
  assert.equal(escapeCsvField(-5), "-5");
  assert.equal(escapeCsvField(100), "100");
});

test("generateReviewsSummaryCsv produces correct headers and rows", () => {
  const csv = generateReviewsSummaryCsv(mockReviews);
  const lines = csv.split("\n");

  assert.equal(
    lines[0],
    "Review ID,Title,Brand,Content Type,Submitter,Submitted At,Status,Compliance Score,Total Findings,Open Findings,High Severity Findings,Analysis Run ID,Provider Used"
  );
  assert.equal(lines.length, 4); // Header + 3 reviews

  // Check row for rev-101
  assert.match(lines[1], /^rev-101,/);
  assert.ok(lines[1].includes("Solstice Radiant Serum Campaign"));
  assert.ok(lines[1].includes("Solstice Botanicals"));
  assert.ok(lines[1].includes("68"));
  assert.ok(lines[1].includes("Gemini 2.5 Flash"));
});

test("generateDetailedFindingsCsv flattens all findings and preserves resolution metadata", () => {
  const csv = generateDetailedFindingsCsv(mockReviews);
  const lines = csv.split("\n");

  assert.equal(
    lines[0],
    "Review ID,Review Title,Brand,Finding ID,Category,Finding Title,Severity,Evidence Status,Detected Value,Expected Value,Source Reference,Affected Content,Resolved,Resolved At,Resolved By,Applied Correction"
  );

  // mockReviews has 2 findings in rev-101, 1 in rev-102, 1 in rev-103 = 4 findings total
  assert.equal(lines.length, 5); // Header + 4 findings

  // Check that the resolved finding includes resolution actor and applied correction
  const resolvedLine = lines.find((l) => l.includes("f-101-2"));
  assert.ok(resolvedLine);
  assert.ok(resolvedLine.includes("Resolved"));
  assert.ok(resolvedLine.includes("Elena Vance"));
  assert.ok(resolvedLine.includes("signs of aging"));
});

test("generateComplianceSummaryCsv aggregates brand compliance matrix", () => {
  const brandSummaries = computeBrandComplianceSummaries(mockReviews);
  const csv = generateComplianceSummaryCsv(brandSummaries);
  const lines = csv.split("\n");

  assert.equal(
    lines[0],
    "Brand,Total Reviews,Approved,Pending,Changes Requested,Average Score,Total Open Findings,High Severity,Medium Severity,Low Severity"
  );
  assert.equal(lines.length, 3); // Header + 2 brands (Solstice, Teralune)
});

test("generateAuditTrailCsv generates lifecycle traceability records with provenance", () => {
  const trail = buildReviewAuditTrail(mockReviews[0], mockActivities, fixedReferenceNow);
  const csv = generateAuditTrailCsv(trail, mockReviews[0].title);
  const lines = csv.split("\n");

  assert.equal(
    lines[0],
    "Timestamp,Review ID,Review Title,Category,Action,Actor,Actor Role,Provenance,Status,Finding ID,Finding Title,Severity,Details"
  );

  // Provenance must clearly distinguish recorded vs snapshot
  assert.ok(csv.includes("Recorded Event"));
  assert.ok(csv.includes("Current Snapshot"));
});

test("downloadCsv executes safely in Node.js without crashing", () => {
  // In Node.js, window and document are undefined. downloadCsv must return cleanly.
  assert.doesNotThrow(() => {
    downloadCsv("test.csv", "a,b,c\n1,2,3");
  });
});

// ============================================================================
// 2. REPORTING LOGIC & FILTERING TESTS
// ============================================================================

test("filterReviewsForReporting filters by brand, status, content type, date, and search", () => {
  const baseFilters: ReportingFilters = {
    brand: "All",
    dateRange: "all",
    status: "All",
    contentType: "All",
    searchQuery: "",
  };

  // 1. All reviews
  const all = filterReviewsForReporting(mockReviews, baseFilters, fixedReferenceNow);
  assert.equal(all.length, 3);

  // 2. Brand filter
  const solsticeOnly = filterReviewsForReporting(
    mockReviews,
    { ...baseFilters, brand: "Solstice Botanicals" },
    fixedReferenceNow
  );
  assert.equal(solsticeOnly.length, 2);

  // 3. Status filter
  const approvedOnly = filterReviewsForReporting(
    mockReviews,
    { ...baseFilters, status: "Approved" },
    fixedReferenceNow
  );
  assert.equal(approvedOnly.length, 1);
  assert.equal(approvedOnly[0].id, "rev-102");

  // 4. Content Type filter
  const pressReleaseOnly = filterReviewsForReporting(
    mockReviews,
    { ...baseFilters, contentType: "Press Release" },
    fixedReferenceNow
  );
  assert.equal(pressReleaseOnly.length, 1);
  assert.equal(pressReleaseOnly[0].id, "rev-103");

  // 5. Search query filter
  const searchResult = filterReviewsForReporting(
    mockReviews,
    { ...baseFilters, searchQuery: "telemetry" },
    fixedReferenceNow
  );
  assert.equal(searchResult.length, 1);
  assert.equal(searchResult[0].id, "rev-103");
});

test("assessReviewRisk accurately classifies risk levels", () => {
  // rev-101 has 1 open high-severity finding and compliance score 68 (< 70) -> critical
  const risk101 = assessReviewRisk(mockReviews[0]);
  assert.equal(risk101.riskLevel, "critical");
  assert.equal(risk101.highSeverityCount, 1);
  assert.equal(risk101.openFindingsCount, 1);

  // rev-102 has 0 open findings and 94 score -> low
  const risk102 = assessReviewRisk(mockReviews[1]);
  assert.equal(risk102.riskLevel, "low");
  assert.equal(risk102.highSeverityCount, 0);
  assert.equal(risk102.openFindingsCount, 0);

  // rev-103 has 1 high-severity finding and 78 score -> warning
  const risk103 = assessReviewRisk(mockReviews[2]);
  assert.equal(risk103.riskLevel, "warning");
  assert.equal(risk103.highSeverityCount, 1);
});

test("getCreativesAtRisk sorts reviews by highest risk first", () => {
  const atRisk = getCreativesAtRisk(mockReviews);
  assert.equal(atRisk.length, 3);
  // Highest risk should be rev-101 (score 68, critical), followed by rev-103 (warning), then rev-102 (low)
  assert.equal(atRisk[0].review.id, "rev-101");
  assert.equal(atRisk[1].review.id, "rev-103");
  assert.equal(atRisk[2].review.id, "rev-102");
});

test("computeBrandComplianceSummaries aggregates metrics by brand collection", () => {
  const summaries = computeBrandComplianceSummaries(mockReviews);
  assert.equal(summaries.length, 2);

  const solstice = summaries.find((s) => s.brand === "Solstice Botanicals");
  assert.ok(solstice);
  assert.equal(solstice.totalReviews, 2);
  assert.equal(solstice.approvedCount, 1);
  assert.equal(solstice.rejectedCount, 1);
  assert.equal(solstice.avgComplianceScore, 81); // (68 + 94) / 2 = 81
  assert.equal(solstice.totalOpenFindings, 1);
  assert.equal(solstice.highSeverityCount, 1);

  const teralune = summaries.find((s) => s.brand === "Teralune Systems");
  assert.ok(teralune);
  assert.equal(teralune.totalReviews, 1);
  assert.equal(teralune.pendingCount, 1);
  assert.equal(teralune.avgComplianceScore, 78);
});

test("getReviewById safely retrieves review and handles invalid IDs gracefully", () => {
  // Valid ID
  const found = getReviewById(mockReviews, "rev-102");
  assert.ok(found);
  assert.equal(found.id, "rev-102");

  // Invalid ID falls back to first review
  const fallback = getReviewById(mockReviews, "non-existent-id");
  assert.ok(fallback);
  assert.equal(fallback.id, "rev-101");

  // Undefined ID falls back to first review
  const defaultFallback = getReviewById(mockReviews, undefined);
  assert.ok(defaultFallback);
  assert.equal(defaultFallback.id, "rev-101");

  // Empty reviews array returns undefined safely
  assert.equal(getReviewById([], "rev-101"), undefined);
});

test("compileBrandComplianceReport handles empty reviews array gracefully", () => {
  const emptyReport = compileBrandComplianceReport([]);
  assert.equal(emptyReport.stats.totalReviews, 0);
  assert.equal(emptyReport.stats.averageComplianceScore, 100);
  assert.equal(emptyReport.brandSummaries.length, 0);
  assert.equal(emptyReport.creativesAtRisk.length, 0);
});

test("formatReportTimestamp outputs clean deterministic UTC string", () => {
  const dt = new Date("2026-11-14T18:30:00.000Z");
  const formatted = formatReportTimestamp(dt);
  assert.equal(formatted, "2026-11-14 18:30 UTC");
});
