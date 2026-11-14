import {
  ContentType,
  FindingCategory,
  ReviewSubmission,
} from "./types";

export type DateRangeOption = "all" | "7d" | "30d";

export interface DashboardFilters {
  dateRange: DateRangeOption;
  brand: string; // "All" or a specific guideline collection
  contentType: "All" | ContentType;
  searchQuery: string;
}

export interface DashboardKpiStats {
  totalReviews: number;
  approvedReviews: number;
  pendingReviews: number;
  rejectedReviews: number;
  flaggedReviews: number;
  totalOpenFindings: number;
  highSeverityFindings: number;
  averageComplianceScore: number;
}

export interface TimelineBucket {
  periodKey: string;
  label: string;
  totalReviews: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  avgComplianceScore: number;
  openFindingsCount: number;
  resolvedFindingsCount: number;
  supportedFindingsCount: number;
}

export interface StatusDistribution {
  approved: { count: number; percentage: number };
  pending: { count: number; percentage: number };
  rejected: { count: number; percentage: number };
}

export interface SeverityDistribution {
  high: { count: number; percentage: number };
  medium: { count: number; percentage: number };
  low: { count: number; percentage: number };
  total: number;
}

export interface CategoryDistributionItem {
  category: FindingCategory;
  count: number;
  openCount: number;
  resolvedCount: number;
  percentage: number;
}

export const ALL_FINDING_CATEGORIES: FindingCategory[] = [
  "Brand Claims",
  "Terminology",
  "Tone & Voice",
  "Visual Identity",
  "Legal & Usage",
];

/**
 * Safely parses date strings like "2026-11-12 09:42", "2026-11-12", or ISO-8601 strings.
 */
export function parseReviewDate(dateStr?: string | null): Date | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes(" ") ? trimmed.replace(" ", "T") : trimmed;
  const parsed = new Date(normalized);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Formats a submission date for clear display in review cards.
 */
export function formatReviewDate(dateStr?: string | null): string {
  if (!dateStr) return "Unknown Date";
  const parsed = parseReviewDate(dateStr);
  if (!parsed) return dateStr;

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const m = months[parsed.getMonth()];
  const d = parsed.getDate();
  const y = parsed.getFullYear();
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");

  return `${m} ${d}, ${y} · ${hh}:${mm}`;
}

/**
 * Retrieves the unique brand / guideline collection names present across all reviews.
 */
export function getUniqueBrands(
  reviews: ReviewSubmission[],
  defaultCollections: string[] = [],
): string[] {
  const brandSet = new Set<string>();
  for (const c of defaultCollections) {
    if (c && c.trim()) brandSet.add(c.trim());
  }
  for (const r of reviews) {
    if (r.guidelineCollection && r.guidelineCollection.trim()) {
      brandSet.add(r.guidelineCollection.trim());
    }
  }
  return Array.from(brandSet).sort();
}

/**
 * Filters reviews consistently based on content type, brand, date range, and search query.
 */
export function filterReviews(
  reviews: ReviewSubmission[],
  filters: DashboardFilters,
  referenceNow: Date = new Date(),
): ReviewSubmission[] {
  const query = filters.searchQuery.trim().toLowerCase();
  let cutoffTime: number | null = null;

  if (filters.dateRange === "7d") {
    cutoffTime = referenceNow.getTime() - 7 * 24 * 60 * 60 * 1000;
  } else if (filters.dateRange === "30d") {
    cutoffTime = referenceNow.getTime() - 30 * 24 * 60 * 60 * 1000;
  }

  return reviews.filter((r) => {
    // Content Type filter
    if (filters.contentType !== "All" && r.contentType !== filters.contentType) {
      return false;
    }

    // Brand filter
    if (filters.brand !== "All" && r.guidelineCollection !== filters.brand) {
      return false;
    }

    // Date range filter
    if (cutoffTime !== null) {
      const d = parseReviewDate(r.submittedAt);
      if (!d || d.getTime() < cutoffTime) {
        return false;
      }
    }

    // Search query filter
    if (query) {
      const matchesTitle = r.title.toLowerCase().includes(query);
      const matchesBrand = r.guidelineCollection.toLowerCase().includes(query);
      const matchesSubmitter = r.submittedBy.toLowerCase().includes(query);
      const matchesCopy = r.textContent?.toLowerCase().includes(query) ?? false;
      if (!matchesTitle && !matchesBrand && !matchesSubmitter && !matchesCopy) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Computes all KPI statistics dynamically from the filtered reviews array.
 */
export function computeDashboardStats(reviews: ReviewSubmission[]): DashboardKpiStats {
  const totalReviews = reviews.length;
  if (totalReviews === 0) {
    return {
      totalReviews: 0,
      approvedReviews: 0,
      pendingReviews: 0,
      rejectedReviews: 0,
      flaggedReviews: 0,
      totalOpenFindings: 0,
      highSeverityFindings: 0,
      averageComplianceScore: 100,
    };
  }

  let approvedReviews = 0;
  let pendingReviews = 0;
  let rejectedReviews = 0;
  let flaggedReviews = 0;
  let totalScoreSum = 0;
  let totalOpenFindings = 0;
  let highSeverityFindings = 0;

  for (const r of reviews) {
    totalScoreSum += r.complianceScore ?? 0;

    if (r.status === "Approved") {
      approvedReviews++;
    } else if (r.status === "Pending Approval" || r.status === "In Review") {
      pendingReviews++;
    } else if (r.status === "Changes Requested") {
      rejectedReviews++;
    }

    let isFlagged = false;
    const findings = r.findings || [];
    for (const f of findings) {
      if (!f.resolved) {
        totalOpenFindings++;
        if (f.severity === "high") {
          highSeverityFindings++;
        }
        if (f.evidenceStatus === "conflicting" || f.evidenceStatus === "unverified") {
          isFlagged = true;
        }
      }
    }

    if (isFlagged) {
      flaggedReviews++;
    }
  }

  const averageComplianceScore = Math.round(totalScoreSum / totalReviews);

  return {
    totalReviews,
    approvedReviews,
    pendingReviews,
    rejectedReviews,
    flaggedReviews,
    totalOpenFindings,
    highSeverityFindings,
    averageComplianceScore,
  };
}

/**
 * Groups reviews chronologically by monthly period buckets for the timeline chart.
 */
export function computeReviewTimeline(reviews: ReviewSubmission[]): TimelineBucket[] {
  if (reviews.length === 0) return [];

  const buckets = new Map<
    string,
    {
      reviews: ReviewSubmission[];
      latestDate: Date;
    }
  >();

  for (const r of reviews) {
    const d = parseReviewDate(r.submittedAt) || new Date(0);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const key = `${year}-${month}`;

    const existing = buckets.get(key);
    if (existing) {
      existing.reviews.push(r);
      if (d > existing.latestDate) existing.latestDate = d;
    } else {
      buckets.set(key, { reviews: [r], latestDate: d });
    }
  }

  const sortedKeys = Array.from(buckets.keys()).sort();
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  return sortedKeys.map((key) => {
    const item = buckets.get(key)!;
    const revs = item.reviews;
    const [yearStr, monthStr] = key.split("-");
    const monthIdx = parseInt(monthStr, 10) - 1;
    const monthLabel = monthNames[monthIdx] || monthStr;
    const label = `${monthLabel} '${yearStr.slice(2)}`;

    let approvedCount = 0;
    let pendingCount = 0;
    let rejectedCount = 0;
    let scoreSum = 0;
    let openFindingsCount = 0;
    let resolvedFindingsCount = 0;
    let supportedFindingsCount = 0;

    for (const r of revs) {
      scoreSum += r.complianceScore ?? 0;
      if (r.status === "Approved") approvedCount++;
      else if (r.status === "Changes Requested") rejectedCount++;
      else pendingCount++;

      for (const f of r.findings || []) {
        if (f.resolved) {
          resolvedFindingsCount++;
        } else {
          openFindingsCount++;
        }
        if (f.evidenceStatus === "supported") {
          supportedFindingsCount++;
        }
      }
    }

    return {
      periodKey: key,
      label,
      totalReviews: revs.length,
      approvedCount,
      pendingCount,
      rejectedCount,
      avgComplianceScore: revs.length > 0 ? Math.round(scoreSum / revs.length) : 100,
      openFindingsCount,
      resolvedFindingsCount,
      supportedFindingsCount,
    };
  });
}

/**
 * Computes status distribution (Approved vs Pending vs Changes Requested).
 */
export function computeStatusDistribution(reviews: ReviewSubmission[]): StatusDistribution {
  const total = reviews.length;
  if (total === 0) {
    return {
      approved: { count: 0, percentage: 0 },
      pending: { count: 0, percentage: 0 },
      rejected: { count: 0, percentage: 0 },
    };
  }

  let approved = 0;
  let pending = 0;
  let rejected = 0;

  for (const r of reviews) {
    if (r.status === "Approved") approved++;
    else if (r.status === "Changes Requested") rejected++;
    else pending++;
  }

  return {
    approved: { count: approved, percentage: Math.round((approved / total) * 100) },
    pending: { count: pending, percentage: Math.round((pending / total) * 100) },
    rejected: { count: rejected, percentage: Math.round((rejected / total) * 100) },
  };
}

/**
 * Computes severity distribution across all findings in filtered reviews.
 */
export function computeSeverityDistribution(reviews: ReviewSubmission[]): SeverityDistribution {
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const r of reviews) {
    for (const f of r.findings || []) {
      if (f.severity === "high") high++;
      else if (f.severity === "medium") medium++;
      else if (f.severity === "low") low++;
    }
  }

  const total = high + medium + low;
  if (total === 0) {
    return {
      high: { count: 0, percentage: 0 },
      medium: { count: 0, percentage: 0 },
      low: { count: 0, percentage: 0 },
      total: 0,
    };
  }

  return {
    high: { count: high, percentage: Math.round((high / total) * 100) },
    medium: { count: medium, percentage: Math.round((medium / total) * 100) },
    low: { count: low, percentage: Math.round((low / total) * 100) },
    total,
  };
}

/**
 * Computes finding counts per governance compliance category.
 */
export function computeCategoryDistribution(
  reviews: ReviewSubmission[],
): CategoryDistributionItem[] {
  const map = new Map<
    FindingCategory,
    { count: number; openCount: number; resolvedCount: number }
  >();

  for (const cat of ALL_FINDING_CATEGORIES) {
    map.set(cat, { count: 0, openCount: 0, resolvedCount: 0 });
  }

  let totalFindings = 0;

  for (const r of reviews) {
    for (const f of r.findings || []) {
      totalFindings++;
      const current = map.get(f.category);
      if (current) {
        current.count++;
        if (f.resolved) {
          current.resolvedCount++;
        } else {
          current.openCount++;
        }
      }
    }
  }

  return ALL_FINDING_CATEGORIES.map((category) => {
    const data = map.get(category)!;
    const percentage = totalFindings > 0 ? Math.round((data.count / totalFindings) * 100) : 0;
    return {
      category,
      count: data.count,
      openCount: data.openCount,
      resolvedCount: data.resolvedCount,
      percentage,
    };
  });
}
