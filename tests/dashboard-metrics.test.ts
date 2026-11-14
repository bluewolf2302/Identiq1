import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCategoryDistribution,
  computeDashboardStats,
  computeReviewTimeline,
  computeSeverityDistribution,
  computeStatusDistribution,
  filterReviews,
  formatReviewDate,
  getUniqueBrands,
  parseReviewDate,
  type DashboardFilters,
} from "../lib/dashboard-metrics";
import { INITIAL_REVIEWS } from "../lib/seed-data";

test("computeDashboardStats accurately calculates all KPI metrics from seed reviews", () => {
  const stats = computeDashboardStats(INITIAL_REVIEWS);

  // 4 total reviews in initial seed
  assert.equal(stats.totalReviews, 4);

  // 1 approved review (rev-103)
  assert.equal(stats.approvedReviews, 1);

  // 2 pending reviews (rev-101 is "Pending Approval", rev-102 is "In Review")
  assert.equal(stats.pendingReviews, 2);

  // 1 rejected review (rev-104 is "Changes Requested")
  assert.equal(stats.rejectedReviews, 1);

  // 3 flagged reviews (rev-101, rev-102, rev-104 have open conflicting/unverified findings)
  assert.equal(stats.flaggedReviews, 3);

  // Open findings: rev-101 (2), rev-102 (3), rev-103 (0), rev-104 (2) => 7
  assert.equal(stats.totalOpenFindings, 7);

  // Open High severity findings: rev-101 (1), rev-102 (1), rev-103 (0), rev-104 (2) => 4
  assert.equal(stats.highSeverityFindings, 4);

  // Average score: (76 + 84 + 96 + 71) / 4 = 327 / 4 = 81.75 => 82
  assert.equal(stats.averageComplianceScore, 82);
});

test("computeDashboardStats returns safe default values on empty reviews array", () => {
  const stats = computeDashboardStats([]);

  assert.equal(stats.totalReviews, 0);
  assert.equal(stats.approvedReviews, 0);
  assert.equal(stats.pendingReviews, 0);
  assert.equal(stats.rejectedReviews, 0);
  assert.equal(stats.flaggedReviews, 0);
  assert.equal(stats.totalOpenFindings, 0);
  assert.equal(stats.highSeverityFindings, 0);
  assert.equal(stats.averageComplianceScore, 100);
});

test("filterReviews filters by content type accurately", () => {
  const filters: DashboardFilters = {
    dateRange: "all",
    brand: "All",
    contentType: "Campaign Copy",
    searchQuery: "",
  };

  const filtered = filterReviews(INITIAL_REVIEWS, filters);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "rev-101");
});

test("filterReviews filters by brand collection accurately", () => {
  const filters: DashboardFilters = {
    dateRange: "all",
    brand: "Northstar Pay Compliance v1.8",
    contentType: "All",
    searchQuery: "",
  };

  const filtered = filterReviews(INITIAL_REVIEWS, filters);
  // rev-102 and rev-104 belong to Northstar Pay Compliance v1.8
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((r) => r.guidelineCollection === "Northstar Pay Compliance v1.8"));
});

test("filterReviews filters by date range correctly against reference time", () => {
  // Reference date: 2026-11-13T00:00:00Z
  const refDate = new Date("2026-11-13T00:00:00Z");

  // Reviews in seed data:
  // rev-101: 2026-11-12 (within 7d of 2026-11-13)
  // rev-102: 2026-11-11 (within 7d of 2026-11-13)
  // rev-103: 2026-11-10 (within 7d of 2026-11-13)
  // rev-104: 2026-11-09 (within 7d of 2026-11-13)
  const filters7d: DashboardFilters = {
    dateRange: "7d",
    brand: "All",
    contentType: "All",
    searchQuery: "",
  };

  const filtered7d = filterReviews(INITIAL_REVIEWS, filters7d, refDate);
  assert.equal(filtered7d.length, 4);

  // When reference date is far in the future (e.g. 2026-11-20), reviews from Nov 9-12 fall outside 7 days:
  const filtersPastCutoff: DashboardFilters = {
    dateRange: "7d",
    brand: "All",
    contentType: "All",
    searchQuery: "",
  };
  const filteredPast = filterReviews(INITIAL_REVIEWS, filtersPastCutoff, new Date("2026-11-20T00:00:00Z"));
  // 7d before Nov 20 is Nov 13. None of Nov 9-12 are after Nov 13!
  assert.equal(filteredPast.length, 0);
});

test("filterReviews searches title, submitter, and copy", () => {
  const filterTitle: DashboardFilters = {
    dateRange: "all",
    brand: "All",
    contentType: "All",
    searchQuery: "Autumn Serum",
  };
  assert.equal(filterReviews(INITIAL_REVIEWS, filterTitle).length, 1);
  assert.equal(filterReviews(INITIAL_REVIEWS, filterTitle)[0].id, "rev-101");

  const filterSolstice: DashboardFilters = {
    dateRange: "all",
    brand: "All",
    contentType: "All",
    searchQuery: "Solstice",
  };
  // Matches rev-101 (title) and rev-103 (collection)
  assert.equal(filterReviews(INITIAL_REVIEWS, filterSolstice).length, 2);

  const filterSubmitter: DashboardFilters = {
    dateRange: "all",
    brand: "All",
    contentType: "All",
    searchQuery: "Priya Nair",
  };
  assert.equal(filterReviews(INITIAL_REVIEWS, filterSubmitter).length, 1);

  const filterCopy: DashboardFilters = {
    dateRange: "all",
    brand: "All",
    contentType: "All",
    searchQuery: "kraft board",
  };
  assert.equal(filterReviews(INITIAL_REVIEWS, filterCopy).length, 1);
});

test("getUniqueBrands returns distinct collections sorted alphabetically", () => {
  const brands = getUniqueBrands(INITIAL_REVIEWS, ["Teralune Brand Identity & AI Guidelines v1.0"]);
  assert.ok(brands.includes("Aura Botanicals Global v2.4"));
  assert.ok(brands.includes("Northstar Pay Compliance v1.8"));
  assert.ok(brands.includes("Solstice Packaging Standards v3.0"));
  assert.ok(brands.includes("Teralune Brand Identity & AI Guidelines v1.0"));
  // Sorted order check
  const sortedCopy = [...brands].sort();
  assert.deepEqual(brands, sortedCopy);
});

test("computeReviewTimeline creates chronological monthly periods", () => {
  const timeline = computeReviewTimeline(INITIAL_REVIEWS);
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].periodKey, "2026-11");
  assert.equal(timeline[0].totalReviews, 4);
  assert.equal(timeline[0].approvedCount, 1);
  assert.equal(timeline[0].rejectedCount, 1);
  assert.equal(timeline[0].pendingCount, 2);
  assert.equal(timeline[0].avgComplianceScore, 82);
});

test("computeStatusDistribution returns exact percentage breakdown", () => {
  const dist = computeStatusDistribution(INITIAL_REVIEWS);
  assert.equal(dist.approved.count, 1);
  assert.equal(dist.approved.percentage, 25);
  assert.equal(dist.pending.count, 2);
  assert.equal(dist.pending.percentage, 50);
  assert.equal(dist.rejected.count, 1);
  assert.equal(dist.rejected.percentage, 25);
});

test("computeSeverityDistribution accurately counts findings across severities", () => {
  const dist = computeSeverityDistribution(INITIAL_REVIEWS);
  assert.equal(dist.high.count, 4);
  assert.equal(dist.medium.count, 3);
  assert.equal(dist.low.count, 2);
  assert.equal(dist.total, 9);
});

test("computeCategoryDistribution accounts for all 5 governance categories", () => {
  const cats = computeCategoryDistribution(INITIAL_REVIEWS);
  assert.equal(cats.length, 5);

  const claims = cats.find((c) => c.category === "Brand Claims")!;
  assert.equal(claims.count, 3);
  assert.equal(claims.openCount, 3);

  const visual = cats.find((c) => c.category === "Visual Identity")!;
  assert.equal(visual.count, 1);
  assert.equal(visual.resolvedCount, 1);
  assert.equal(visual.openCount, 0);
});

test("parseReviewDate and formatReviewDate handle variations gracefully", () => {
  assert.equal(parseReviewDate(""), null);
  assert.equal(parseReviewDate(undefined), null);
  assert.equal(parseReviewDate("invalid-date-string"), null);

  const parsed = parseReviewDate("2026-11-12 09:42");
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 10); // 0-indexed November
  assert.equal(parsed.getDate(), 12);

  const formatted = formatReviewDate("2026-11-12 09:42");
  assert.ok(formatted.includes("Nov 12, 2026"));
  assert.ok(formatted.includes("09:42"));
});
