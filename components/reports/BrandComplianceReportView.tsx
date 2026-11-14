"use client";

import React from "react";
import Link from "next/link";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  FileCheck2,
  Building2,
  ExternalLink,
} from "lucide-react";
import {
  BrandComplianceReportData,
} from "@/lib/reporting";
import {
  REVIEW_STATUS_META,
} from "@/components/ThemeTokens";

interface BrandComplianceReportViewProps {
  data: BrandComplianceReportData;
  activeBrand: string;
  onSelectReviewForDossier?: (reviewId: string) => void;
}

function getStatusBadgeStyle(status: string): string {
  if (status === "Approved") return "bg-[#CDEEE0] text-[#14532D]";
  if (status === "Changes Requested") return "bg-[#F6D5DA] text-[#7F1D1D]";
  return "bg-[#F9DEC0] text-[#78350F]";
}

export function BrandComplianceReportView({
  data,
  activeBrand,
  onSelectReviewForDossier,
}: BrandComplianceReportViewProps) {
  const { stats, statusDist, severityDist, categoryDist, brandSummaries, creativesAtRisk } = data;

  return (
    <div className="space-y-8">
      {/* Scope banner */}
      <div className="bg-white border border-[#E7E1DA] rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#F6D5DA]/40 text-[#9C2740] flex items-center justify-center font-bold">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#141414] font-display">
              Scope: {activeBrand === "All" ? "All Brand Portfolios" : `${activeBrand} Brand Portfolio`}
            </h2>
            <p className="text-xs text-[#5A5550]">
              Aggregated governance telemetry and compliance risk distribution across {stats.totalReviews} creative submissions
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-3 py-1.5 rounded-lg bg-[#FAF8F6] border border-[#E7E1DA] font-medium text-[#141414]">
            {brandSummaries.length} Brand Collections
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-[#CDEEE0] text-[#14532D] font-semibold">
            {stats.averageComplianceScore}% Portfolio Avg
          </span>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E7E1DA] rounded-2xl p-4 shadow-sm break-inside-avoid">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#736B63] mb-1 flex items-center justify-between">
            <span>Total Reviews</span>
            <FileCheck2 className="w-4 h-4 text-[#8C827A]" />
          </div>
          <div className="text-2xl font-extrabold text-[#141414] font-display tabular-nums">
            {stats.totalReviews}
          </div>
          <div className="text-xs text-[#736B63] mt-1">Evaluated creatives</div>
        </div>

        <div className="bg-white border border-[#E7E1DA] rounded-2xl p-4 shadow-sm break-inside-avoid">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#736B63] mb-1 flex items-center justify-between">
            <span>Avg Compliance</span>
            <TrendingUp className="w-4 h-4 text-[#14532D]" />
          </div>
          <div className="text-2xl font-extrabold text-[#14532D] font-display tabular-nums">
            {stats.averageComplianceScore}%
          </div>
          <div className="text-xs text-[#736B63] mt-1">Across all guidelines</div>
        </div>

        <div className="bg-white border border-[#E7E1DA] rounded-2xl p-4 shadow-sm break-inside-avoid">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#736B63] mb-1 flex items-center justify-between">
            <span>Open Findings</span>
            <AlertTriangle className="w-4 h-4 text-[#B45309]" />
          </div>
          <div className="text-2xl font-extrabold text-[#B45309] font-display tabular-nums">
            {stats.totalOpenFindings}
          </div>
          <div className="text-xs text-[#736B63] mt-1">
            {stats.highSeverityFindings} high severity
          </div>
        </div>

        <div className="bg-white border border-[#E7E1DA] rounded-2xl p-4 shadow-sm break-inside-avoid">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#736B63] mb-1 flex items-center justify-between">
            <span>Approval Rate</span>
            <CheckCircle2 className="w-4 h-4 text-[#15803D]" />
          </div>
          <div className="text-2xl font-extrabold text-[#15803D] font-display tabular-nums">
            {statusDist.approved.percentage}%
          </div>
          <div className="text-xs text-[#736B63] mt-1">
            {stats.approvedReviews} of {stats.totalReviews} approved
          </div>
        </div>
      </div>

      {/* Two Column Distributions: Review Status & Finding Severity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Status Breakdown */}
        <div className="bg-white border border-[#E7E1DA] rounded-2xl p-5 shadow-sm break-inside-avoid">
          <h3 className="text-sm font-bold text-[#141414] font-display mb-4">
            Submission Status Distribution
          </h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-[#141414] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#15803D]" /> Approved
                </span>
                <span className="tabular-nums font-semibold text-[#141414]">
                  {statusDist.approved.count} ({statusDist.approved.percentage}%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#FAF8F6] overflow-hidden border border-[#E7E1DA]">
                <div
                  className="h-full bg-[#CDEEE0]"
                  style={{ width: `${statusDist.approved.percentage}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-[#141414] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#B45309]" /> Pending / In Review
                </span>
                <span className="tabular-nums font-semibold text-[#141414]">
                  {statusDist.pending.count} ({statusDist.pending.percentage}%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#FAF8F6] overflow-hidden border border-[#E7E1DA]">
                <div
                  className="h-full bg-[#F9DEC0]"
                  style={{ width: `${statusDist.pending.percentage}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-[#141414] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#9C2740]" /> Changes Requested
                </span>
                <span className="tabular-nums font-semibold text-[#141414]">
                  {statusDist.rejected.count} ({statusDist.rejected.percentage}%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#FAF8F6] overflow-hidden border border-[#E7E1DA]">
                <div
                  className="h-full bg-[#F6D5DA]"
                  style={{ width: `${statusDist.rejected.percentage}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Severity Breakdown */}
        <div className="bg-white border border-[#E7E1DA] rounded-2xl p-5 shadow-sm break-inside-avoid">
          <h3 className="text-sm font-bold text-[#141414] font-display mb-4">
            Open Findings Severity Breakdown
          </h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-[#9C2740] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#9C2740]" /> High Severity
                </span>
                <span className="tabular-nums font-semibold text-[#141414]">
                  {severityDist.high.count} ({severityDist.high.percentage}%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#FAF8F6] overflow-hidden border border-[#E7E1DA]">
                <div
                  className="h-full bg-[#F6D5DA]"
                  style={{ width: `${severityDist.high.percentage}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-[#B45309] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#B45309]" /> Medium Severity
                </span>
                <span className="tabular-nums font-semibold text-[#141414]">
                  {severityDist.medium.count} ({severityDist.medium.percentage}%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#FAF8F6] overflow-hidden border border-[#E7E1DA]">
                <div
                  className="h-full bg-[#F9DEC0]"
                  style={{ width: `${severityDist.medium.percentage}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-[#2563EB] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#2563EB]" /> Low Severity
                </span>
                <span className="tabular-nums font-semibold text-[#141414]">
                  {severityDist.low.count} ({severityDist.low.percentage}%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#FAF8F6] overflow-hidden border border-[#E7E1DA]">
                <div
                  className="h-full bg-[#DDF0FA]"
                  style={{ width: `${severityDist.low.percentage}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Compliance Category Distribution */}
      <div className="bg-white border border-[#E7E1DA] rounded-2xl p-5 shadow-sm break-inside-avoid">
        <h3 className="text-sm font-bold text-[#141414] font-display mb-4">
          Findings by Compliance Governance Category
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {categoryDist.map((item) => (
            <div
              key={item.category}
              className="p-3.5 rounded-xl bg-[#FAF8F6] border border-[#E7E1DA]/80 flex flex-col justify-between"
            >
              <div className="text-xs font-semibold text-[#141414] line-clamp-1">
                {item.category}
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-xl font-bold font-display text-[#141414] tabular-nums">
                  {item.count}
                </span>
                <span className="text-[11px] font-medium text-[#736B63]">
                  {item.openCount} open
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Creatives at Risk Table */}
      <div className="bg-white border border-[#E7E1DA] rounded-2xl p-5 shadow-sm break-inside-avoid">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-[#141414] font-display flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[#9C2740]" />
              Creatives at Risk (Priority Attention)
            </h3>
            <p className="text-xs text-[#5A5550]">
              Ranked by open high-severity findings and lowest compliance scores
            </p>
          </div>
        </div>

        {creativesAtRisk.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#736B63] bg-[#FAF8F6] rounded-xl border border-dashed border-[#E7E1DA]">
            No high-risk creatives found in this dataset. All reviews meet acceptable governance thresholds.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E7E1DA] text-[#736B63] font-semibold">
                  <th className="py-2.5 px-3">Creative</th>
                  <th className="py-2.5 px-3">Brand</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Score</th>
                  <th className="py-2.5 px-3">Open Violations</th>
                  <th className="py-2.5 px-3">Primary Risk</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E1DA]/60">
                {creativesAtRisk.map((item) => {
                  const statusMeta = REVIEW_STATUS_META[item.review.status] || {
                    badgeClass: "bg-gray-100 text-gray-800",
                    label: item.review.status,
                  };
                  return (
                    <tr key={item.review.id} className="hover:bg-[#FAF8F6]/60 transition-colors">
                      <td className="py-3 px-3 font-semibold text-[#141414]">
                        <div>{item.review.title}</div>
                        <div className="text-[11px] font-mono text-[#8C827A]">{item.review.id}</div>
                      </td>
                      <td className="py-3 px-3 text-[#5A5550]">{item.review.guidelineCollection}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${getStatusBadgeStyle(
                            item.review.status
                          )}`}
                        >
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-bold tabular-nums">
                        <span
                          className={
                            item.complianceScore < 70
                              ? "text-[#9C2740]"
                              : item.complianceScore < 85
                              ? "text-[#B45309]"
                              : "text-[#15803D]"
                          }
                        >
                          {item.complianceScore}%
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-semibold text-[#9C2740] tabular-nums">
                          {item.highSeverityCount} High
                        </span>
                        <span className="text-[#8C827A] ml-1">/ {item.openFindingsCount} total</span>
                      </td>
                      <td className="py-3 px-3 text-[#5A5550] max-w-xs truncate">
                        {item.primaryIssue || "Low score threshold"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {onSelectReviewForDossier ? (
                          <button
                            type="button"
                            onClick={() => onSelectReviewForDossier(item.review.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FAF8F6] border border-[#E7E1DA] hover:bg-[#E7E1DA] text-[#141414] font-medium transition-colors"
                          >
                            <span>Dossier</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        ) : (
                          <Link
                            href={`/reports?tab=review&reviewId=${item.review.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FAF8F6] border border-[#E7E1DA] hover:bg-[#E7E1DA] text-[#141414] font-medium transition-colors"
                          >
                            <span>Dossier</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Portfolio Brand Table */}
      <div className="bg-white border border-[#E7E1DA] rounded-2xl p-5 shadow-sm break-inside-avoid">
        <h3 className="text-sm font-bold text-[#141414] font-display mb-4">
          Brand Portfolio Compliance Matrix
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#E7E1DA] text-[#736B63] font-semibold">
                <th className="py-2.5 px-3">Brand Collection</th>
                <th className="py-2.5 px-3">Total Reviews</th>
                <th className="py-2.5 px-3">Approved</th>
                <th className="py-2.5 px-3">Pending</th>
                <th className="py-2.5 px-3">Changes Req.</th>
                <th className="py-2.5 px-3">Avg Score</th>
                <th className="py-2.5 px-3">Open Violations</th>
                <th className="py-2.5 px-3">High Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E7E1DA]/60">
              {brandSummaries.map((b) => (
                <tr key={b.brand} className="hover:bg-[#FAF8F6]/60 transition-colors">
                  <td className="py-3 px-3 font-semibold text-[#141414]">{b.brand}</td>
                  <td className="py-3 px-3 tabular-nums">{b.totalReviews}</td>
                  <td className="py-3 px-3 text-[#15803D] font-medium tabular-nums">{b.approvedCount}</td>
                  <td className="py-3 px-3 text-[#B45309] font-medium tabular-nums">{b.pendingCount}</td>
                  <td className="py-3 px-3 text-[#9C2740] font-medium tabular-nums">{b.rejectedCount}</td>
                  <td className="py-3 px-3 font-bold tabular-nums">
                    <span
                      className={
                        b.avgComplianceScore < 70
                          ? "text-[#9C2740]"
                          : b.avgComplianceScore < 85
                          ? "text-[#B45309]"
                          : "text-[#15803D]"
                      }
                    >
                      {b.avgComplianceScore}%
                    </span>
                  </td>
                  <td className="py-3 px-3 tabular-nums">{b.totalOpenFindings}</td>
                  <td className="py-3 px-3 font-bold text-[#9C2740] tabular-nums">{b.highSeverityCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
