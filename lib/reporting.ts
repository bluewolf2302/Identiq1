import {
  ReviewStatus,
  ReviewSubmission,
} from "./types";
import {
  computeDashboardStats,
  computeSeverityDistribution,
  computeCategoryDistribution,
  computeStatusDistribution,
  computeReviewTimeline,
  filterReviews,
  getUniqueBrands,
  DashboardFilters,
  DashboardKpiStats,
  SeverityDistribution,
  CategoryDistributionItem,
  StatusDistribution,
  TimelineBucket,
} from "./dashboard-metrics";
import { BrandComplianceSummaryRow } from "./csv-export";

export type ReportingTab = "brand" | "review" | "audit";

export interface ReportingFilters extends DashboardFilters {
  status: "All" | ReviewStatus;
}

export interface CreativeRiskItem {
  review: ReviewSubmission;
  complianceScore: number;
  openFindingsCount: number;
  highSeverityCount: number;
  riskLevel: "critical" | "warning" | "moderate" | "low";
  primaryIssue?: string;
}

export interface BrandComplianceReportData {
  stats: DashboardKpiStats;
  statusDist: StatusDistribution;
  severityDist: SeverityDistribution;
  categoryDist: CategoryDistributionItem[];
  timeline: TimelineBucket[];
  brandSummaries: BrandComplianceSummaryRow[];
  creativesAtRisk: CreativeRiskItem[];
}

/**
 * Filters reviews for reporting, applying brand, dateRange, contentType, search,
 * and review status. Reuses existing filterReviews from dashboard-metrics.
 */
export function filterReviewsForReporting(
  reviews: ReviewSubmission[],
  filters: ReportingFilters,
  referenceNow?: Date | null
): ReviewSubmission[] {
  // Step 1: Base filtering using dashboard-metrics (brand, date, contentType, search)
  const baseFiltered = filterReviews(reviews, filters, referenceNow);

  // Step 2: Apply status filter if not "All"
  if (filters.status && filters.status !== "All") {
    return baseFiltered.filter((r) => r.status === filters.status);
  }

  return baseFiltered;
}

/**
 * Computes risk level for a single review.
 * Risk is determined by high-severity open violations and compliance score.
 */
export function assessReviewRisk(review: ReviewSubmission): {
  openFindingsCount: number;
  highSeverityCount: number;
  riskLevel: "critical" | "warning" | "moderate" | "low";
  primaryIssue?: string;
} {
  const openFindings = review.findings?.filter((f) => !f.resolved) || [];
  const highSev = openFindings.filter((f) => f.severity === "high");
  const openFindingsCount = openFindings.length;
  const highSeverityCount = highSev.length;

  let riskLevel: "critical" | "warning" | "moderate" | "low" = "low";
  if (highSeverityCount >= 2 || review.complianceScore < 70) {
    riskLevel = "critical";
  } else if (highSeverityCount === 1 || review.complianceScore < 80) {
    riskLevel = "warning";
  } else if (openFindingsCount > 0 || review.complianceScore < 90) {
    riskLevel = "moderate";
  }

  // Find the most critical issue title if any
  const primaryIssue =
    highSev[0]?.title ||
    openFindings.find((f) => f.severity === "medium")?.title ||
    openFindings[0]?.title ||
    undefined;

  return {
    openFindingsCount,
    highSeverityCount,
    riskLevel,
    primaryIssue,
  };
}

/**
 * Returns creatives sorted by risk:
 * 1. High severity open findings (descending)
 * 2. Compliance score (ascending)
 * 3. Total open findings (descending)
 */
export function getCreativesAtRisk(
  reviews: ReviewSubmission[],
  limit = 5
): CreativeRiskItem[] {
  if (!reviews || reviews.length === 0) return [];

  const items: CreativeRiskItem[] = reviews.map((r) => {
    const assessment = assessReviewRisk(r);
    return {
      review: r,
      complianceScore: r.complianceScore,
      openFindingsCount: assessment.openFindingsCount,
      highSeverityCount: assessment.highSeverityCount,
      riskLevel: assessment.riskLevel,
      primaryIssue: assessment.primaryIssue,
    };
  });

  // Sort: higher risk first
  items.sort((a, b) => {
    if (b.highSeverityCount !== a.highSeverityCount) {
      return b.highSeverityCount - a.highSeverityCount;
    }
    if (a.complianceScore !== b.complianceScore) {
      return a.complianceScore - b.complianceScore; // lower score first
    }
    return b.openFindingsCount - a.openFindingsCount;
  });

  return items.slice(0, limit);
}

/**
 * Computes compliance summary rows grouped by brand (guidelineCollection).
 */
export function computeBrandComplianceSummaries(
  reviews: ReviewSubmission[]
): BrandComplianceSummaryRow[] {
  if (!reviews || reviews.length === 0) return [];

  const brands = getUniqueBrands(reviews);
  const rows: BrandComplianceSummaryRow[] = [];

  for (const brand of brands) {
    const brandReviews = reviews.filter((r) => r.guidelineCollection === brand);
    if (brandReviews.length === 0) continue;

    const totalReviews = brandReviews.length;
    const approvedCount = brandReviews.filter((r) => r.status === "Approved").length;
    const pendingCount = brandReviews.filter(
      (r) => r.status === "Pending Approval" || r.status === "In Review"
    ).length;
    const rejectedCount = brandReviews.filter(
      (r) => r.status === "Changes Requested"
    ).length;

    const totalScore = brandReviews.reduce((sum, r) => sum + r.complianceScore, 0);
    const avgComplianceScore = Math.round(totalScore / totalReviews);

    let totalOpenFindings = 0;
    let highSeverityCount = 0;
    let mediumSeverityCount = 0;
    let lowSeverityCount = 0;

    for (const r of brandReviews) {
      for (const f of r.findings || []) {
        if (!f.resolved) {
          totalOpenFindings++;
          if (f.severity === "high") highSeverityCount++;
          if (f.severity === "medium") mediumSeverityCount++;
          if (f.severity === "low") lowSeverityCount++;
        }
      }
    }

    rows.push({
      brand,
      totalReviews,
      approvedCount,
      pendingCount,
      rejectedCount,
      avgComplianceScore,
      totalOpenFindings,
      highSeverityCount,
      mediumSeverityCount,
      lowSeverityCount,
    });
  }

  // Sort alphabetically by brand
  rows.sort((a, b) => a.brand.localeCompare(b.brand));
  return rows;
}

/**
 * Assembles full dataset for the Brand Compliance Report view.
 */
export function compileBrandComplianceReport(
  filteredReviews: ReviewSubmission[]
): BrandComplianceReportData {
  return {
    stats: computeDashboardStats(filteredReviews),
    statusDist: computeStatusDistribution(filteredReviews),
    severityDist: computeSeverityDistribution(filteredReviews),
    categoryDist: computeCategoryDistribution(filteredReviews),
    timeline: computeReviewTimeline(filteredReviews),
    brandSummaries: computeBrandComplianceSummaries(filteredReviews),
    creativesAtRisk: getCreativesAtRisk(filteredReviews, 5),
  };
}

/**
 * Finds a review by ID, or falls back to the first available review.
 */
export function getReviewById(
  reviews: ReviewSubmission[],
  reviewId?: string | null
): ReviewSubmission | undefined {
  if (!reviews || reviews.length === 0) return undefined;
  if (!reviewId) return reviews[0];

  const found = reviews.find((r) => r.id === reviewId);
  return found || reviews[0];
}

/**
 * Formats a report generation date string safely and deterministically.
 */
export function formatReportTimestamp(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
}
