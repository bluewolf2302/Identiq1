"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  FileText,
  Printer,
  Download,
  Building2,
  Search,
  ChevronDown,
  History,
  Info,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";
import { ContentType, ReviewStatus } from "@/lib/types";
import {
  DateRangeOption,
  getUniqueBrands,
} from "@/lib/dashboard-metrics";
import {
  ReportingTab,
  ReportingFilters,
  filterReviewsForReporting,
  compileBrandComplianceReport,
  getReviewById,
  formatReportTimestamp,
} from "@/lib/reporting";
import {
  generateReviewsSummaryCsv,
  generateDetailedFindingsCsv,
  generateComplianceSummaryCsv,
  generateAuditTrailCsv,
  downloadCsv,
} from "@/lib/csv-export";
import { buildReviewAuditTrail } from "@/lib/audit-history";
import { BrandComplianceReportView } from "@/components/reports/BrandComplianceReportView";
import { ReviewDossierReportView } from "@/components/reports/ReviewDossierReportView";
import { AuditTraceabilityReportView } from "@/components/reports/AuditTraceabilityReportView";

const ALL_CONTENT_TYPES: ContentType[] = [
  "Campaign Copy",
  "Social Creative",
  "Product Sheet",
  "Press Release",
  "Landing Page",
];

const ALL_STATUSES: ("All" | ReviewStatus)[] = [
  "All",
  "Approved",
  "Pending Approval",
  "In Review",
  "Changes Requested",
];

function ReportsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { reviews, activities } = useIdentiq();

  // Reference now for deterministic hydration
  const [referenceNow, setReferenceNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReferenceNow(new Date());
  }, []);

  // Read params directly from URL
  const tabParam = searchParams.get("tab") as ReportingTab | null;
  const reviewIdParam = searchParams.get("reviewId");

  const activeTab: ReportingTab =
    tabParam === "review" || tabParam === "audit" ? tabParam : "brand";
  const selectedReviewId = reviewIdParam;

  // Filters state
  const [brandFilter, setBrandFilter] = useState<string>("All");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeOption>("all");
  const [statusFilter, setStatusFilter] = useState<"All" | ReviewStatus>("All");
  const [contentTypeFilter, setContentTypeFilter] = useState<"All" | ContentType>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [csvMenuOpen, setCsvMenuOpen] = useState(false);

  // Available brands
  const brands = useMemo(() => getUniqueBrands(reviews), [reviews]);

  // Filtered reviews
  const filters: ReportingFilters = useMemo(
    () => ({
      brand: brandFilter,
      dateRange: dateRangeFilter,
      status: statusFilter,
      contentType: contentTypeFilter,
      searchQuery: searchQuery,
    }),
    [brandFilter, dateRangeFilter, statusFilter, contentTypeFilter, searchQuery]
  );

  const filteredReviews = useMemo(() => {
    return filterReviewsForReporting(reviews, filters, referenceNow);
  }, [reviews, filters, referenceNow]);

  // Active review for Dossier view
  const activeReview = useMemo(() => {
    return getReviewById(reviews, selectedReviewId);
  }, [reviews, selectedReviewId]);

  // Update URL helper
  const handleTabChange = (tab: ReportingTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    if (selectedReviewId && (tab === "review" || tab === "audit")) {
      params.set("reviewId", selectedReviewId);
    } else {
      params.delete("reviewId");
    }
    router.replace(`/reports?${params.toString()}`);
  };

  const handleReviewSelect = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "review");
    params.set("reviewId", id);
    router.replace(`/reports?${params.toString()}`);
  };

  // Compiled Brand Report Data
  const brandReportData = useMemo(() => {
    return compileBrandComplianceReport(filteredReviews);
  }, [filteredReviews]);

  // CSV Export Handlers
  const handleExportReviewsSummary = () => {
    const csv = generateReviewsSummaryCsv(filteredReviews);
    const dateStr = referenceNow ? referenceNow.toISOString().split("T")[0] : "export";
    downloadCsv(`identiq-reviews-summary-${dateStr}.csv`, csv);
    setCsvMenuOpen(false);
  };

  const handleExportDetailedFindings = () => {
    // If on review tab, export this review's findings; otherwise export all filtered reviews
    const targetReviews = activeTab === "review" && activeReview ? [activeReview] : filteredReviews;
    const csv = generateDetailedFindingsCsv(targetReviews);
    const dateStr = referenceNow ? referenceNow.toISOString().split("T")[0] : "export";
    downloadCsv(`identiq-detailed-findings-${dateStr}.csv`, csv);
    setCsvMenuOpen(false);
  };

  const handleExportComplianceSummary = () => {
    const csv = generateComplianceSummaryCsv(brandReportData.brandSummaries);
    const dateStr = referenceNow ? referenceNow.toISOString().split("T")[0] : "export";
    downloadCsv(`identiq-brand-compliance-matrix-${dateStr}.csv`, csv);
    setCsvMenuOpen(false);
  };

  const handleExportAuditTrail = () => {
    if (activeReview) {
      const trail = buildReviewAuditTrail(activeReview, activities, referenceNow);
      const csv = generateAuditTrailCsv(trail, activeReview.title);
      const dateStr = referenceNow ? referenceNow.toISOString().split("T")[0] : "export";
      downloadCsv(`identiq-audit-trail-${activeReview.id}-${dateStr}.csv`, csv);
    }
    setCsvMenuOpen(false);
  };

  // Print handler
  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  const generationTimestamp = referenceNow
    ? formatReportTimestamp(referenceNow)
    : "Live System Timestamp";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Print-only Formal Header */}
      <div className="print-only border-b-2 border-black pb-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-xl tracking-tight text-black font-display">
              Identiq Governance Dossier
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 font-mono text-gray-700">
              OFFICIAL REPORT
            </span>
          </div>
          <div className="text-right text-xs text-gray-600">
            <div>Generated: {generationTimestamp}</div>
            <div>Classification: Internal Brand Governance</div>
          </div>
        </div>
        <div className="mt-3 text-xs text-gray-800">
          <span className="font-semibold">Report Focus:</span>{" "}
          {activeTab === "brand"
            ? `Brand Portfolio Compliance (${brandFilter})`
            : activeTab === "review"
            ? `Creative Dossier: ${activeReview?.title || "Review"} (${activeReview?.id || ""})`
            : `Audit Traceability & Governance Log`}
        </div>
      </div>

      {/* Screen-only Page Title & Top Actions */}
      <div className="no-print flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-[#CDEEE0] text-[#14532D]">
              Reporting & Export Center
            </span>
            <span className="text-xs text-[#8C827A]">• Phase 4 Operational</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#141414] tracking-tight font-display">
            Governance Reports & Export
          </h1>
          <p className="text-sm text-[#5A5550] mt-1">
            Generate formal brand compliance audits, review dossiers, and RFC 4180 CSV exports
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2.5">
          {/* CSV Export Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setCsvMenuOpen(!csvMenuOpen)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E7E1DA] hover:bg-[#FAF8F6] text-xs font-semibold text-[#141414] transition-colors shadow-xs"
            >
              <Download className="w-4 h-4 text-[#736B63]" />
              <span>Export CSV</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#736B63]" />
            </button>

            {csvMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setCsvMenuOpen(false)}
                />
                <div className="absolute right-0 mt-1.5 w-60 rounded-xl bg-white border border-[#E7E1DA] shadow-lg z-50 p-1.5 text-xs">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8C827A]">
                    Available CSV Formats
                  </div>
                  <button
                    type="button"
                    onClick={handleExportReviewsSummary}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#FAF8F6] font-medium text-[#141414] transition-colors"
                  >
                    Reviews Summary ({filteredReviews.length} records)
                  </button>
                  <button
                    type="button"
                    onClick={handleExportDetailedFindings}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#FAF8F6] font-medium text-[#141414] transition-colors"
                  >
                    Detailed Findings CSV
                  </button>
                  <button
                    type="button"
                    onClick={handleExportComplianceSummary}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#FAF8F6] font-medium text-[#141414] transition-colors"
                  >
                    Brand Compliance Matrix
                  </button>
                  <button
                    type="button"
                    onClick={handleExportAuditTrail}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#FAF8F6] font-medium text-[#141414] transition-colors"
                  >
                    Audit Trail CSV ({activeReview?.id || "Selected"})
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Print / Save PDF Button */}
          <button
            type="button"
            onClick={handlePrint}
            title="Opens print dialog. Select 'Save as PDF' to export a vector PDF report."
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#111113] hover:bg-black text-white text-xs font-semibold transition-colors shadow-xs"
          >
            <Printer className="w-4 h-4" />
            <span>Print / Save PDF</span>
          </button>
        </div>
      </div>

      {/* Screen-only Tab Navigation */}
      <div className="no-print flex p-1 rounded-2xl bg-white border border-[#E7E1DA] shadow-xs">
        <button
          type="button"
          onClick={() => handleTabChange("brand")}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
            activeTab === "brand"
              ? "bg-[#FAF8F6] text-[#141414] shadow-xs border border-[#E7E1DA]"
              : "text-[#736B63] hover:text-[#141414]"
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Brand Compliance Report</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("review")}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
            activeTab === "review"
              ? "bg-[#FAF8F6] text-[#141414] shadow-xs border border-[#E7E1DA]"
              : "text-[#736B63] hover:text-[#141414]"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Individual Review Dossier</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("audit")}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
            activeTab === "audit"
              ? "bg-[#FAF8F6] text-[#141414] shadow-xs border border-[#E7E1DA]"
              : "text-[#736B63] hover:text-[#141414]"
          }`}
        >
          <History className="w-4 h-4" />
          <span>Audit Traceability Report</span>
        </button>
      </div>

      {/* Filter Toolbar (Visible when appropriate) */}
      <div className="no-print bg-white border border-[#E7E1DA] rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-3">
        {/* Brand Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[#736B63] font-medium">Brand:</span>
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="text-xs bg-[#FAF8F6] border border-[#E7E1DA] rounded-lg px-2.5 py-1.5 font-medium text-[#141414] focus:outline-hidden"
          >
            <option value="All">All Brands ({brands.length})</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        {/* Date Range Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[#736B63] font-medium">Date:</span>
          <select
            value={dateRangeFilter}
            onChange={(e) => setDateRangeFilter(e.target.value as DateRangeOption)}
            className="text-xs bg-[#FAF8F6] border border-[#E7E1DA] rounded-lg px-2.5 py-1.5 font-medium text-[#141414] focus:outline-hidden"
          >
            <option value="all">All Time</option>
            <option value="30d">Last 30 Days</option>
            <option value="7d">Last 7 Days</option>
          </select>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[#736B63] font-medium">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "All" | ReviewStatus)}
            className="text-xs bg-[#FAF8F6] border border-[#E7E1DA] rounded-lg px-2.5 py-1.5 font-medium text-[#141414] focus:outline-hidden"
          >
            {ALL_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>

        {/* Content Type Filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[#736B63] font-medium">Type:</span>
          <select
            value={contentTypeFilter}
            onChange={(e) => setContentTypeFilter(e.target.value as "All" | ContentType)}
            className="text-xs bg-[#FAF8F6] border border-[#E7E1DA] rounded-lg px-2.5 py-1.5 font-medium text-[#141414] focus:outline-hidden"
          >
            <option value="All">All Types</option>
            {ALL_CONTENT_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {ct}
              </option>
            ))}
          </select>
        </div>

        {/* Creative Picker (Prominent when on Review Dossier tab) */}
        {activeTab === "review" && (
          <div className="flex items-center gap-1.5 pl-2 border-l border-[#E7E1DA]">
            <span className="text-xs text-[#736B63] font-semibold">Active Creative:</span>
            <select
              value={activeReview?.id || ""}
              onChange={(e) => handleReviewSelect(e.target.value)}
              className="text-xs bg-[#FAF8F6] border border-[#E7E1DA] rounded-lg px-2.5 py-1.5 font-bold text-[#141414] focus:outline-hidden max-w-xs truncate"
            >
              {reviews.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} ({r.id})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Search Input */}
        <div className="relative flex-1 min-w-[180px] ml-auto">
          <Search className="w-3.5 h-3.5 text-[#8C827A] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search report..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#FAF8F6] border border-[#E7E1DA] rounded-lg placeholder-[#8C827A] focus:outline-hidden"
          />
        </div>
      </div>

      {/* Screen-only Print Instructions Notice */}
      <div className="no-print bg-[#CDEEE0]/20 border border-[#CDEEE0] rounded-xl px-4 py-2.5 flex items-center justify-between text-xs text-[#14532D]">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0 text-[#14532D]" />
          <span>
            <strong>PDF Generation Tip:</strong> Click <em>Print / Save PDF</em> to open the native browser print engine, then select <strong>Save as PDF</strong> as your destination for high-resolution vector PDF export.
          </span>
        </div>
        <span className="text-[11px] font-mono text-[#14532D]/80">A4 Portrait Optimized</span>
      </div>

      {/* Main Tab Content */}
      <div className="print-full-width">
        {activeTab === "brand" && (
          <BrandComplianceReportView
            data={brandReportData}
            activeBrand={brandFilter}
            onSelectReviewForDossier={(revId) => {
              handleReviewSelect(revId);
            }}
          />
        )}

        {activeTab === "review" && (
          <>
            {activeReview ? (
              <ReviewDossierReportView
                review={activeReview}
                activities={activities}
                referenceNow={referenceNow}
              />
            ) : (
              <div className="bg-white border border-[#E7E1DA] rounded-2xl p-12 text-center text-xs text-[#736B63]">
                No review selected or found matching the criteria.
              </div>
            )}
          </>
        )}

        {activeTab === "audit" && (
          <AuditTraceabilityReportView
            reviews={filteredReviews}
            activities={activities}
            selectedReviewId={selectedReviewId || undefined}
            referenceNow={referenceNow}
            onSelectReview={handleReviewSelect}
          />
        )}
      </div>

      {/* Print-only Footnote */}
      <div className="print-only border-t border-gray-300 pt-4 mt-8 text-[10px] text-gray-500 flex justify-between items-center">
        <span>Confidential & Proprietary — Identiq Brand Governance Platform</span>
        <span>Page 1 of 1</span>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 py-12 text-center text-xs text-[#736B63]">
          Loading Identiq Reporting Center...
        </div>
      }
    >
      <ReportsPageContent />
    </Suspense>
  );
}
