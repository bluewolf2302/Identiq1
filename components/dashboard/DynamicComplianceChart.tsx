"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  FilterX,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  computeCategoryDistribution,
  computeReviewTimeline,
  computeSeverityDistribution,
  computeStatusDistribution,
  TimelineBucket,
} from "@/lib/dashboard-metrics";
import { ReviewSubmission } from "@/lib/types";

interface DynamicComplianceChartProps {
  reviews: ReviewSubmission[];
  allReviewsCount: number;
  onResetFilters?: () => void;
}

type ChartViewMode = "timeline" | "status" | "severity" | "category";

export function DynamicComplianceChart({
  reviews,
  allReviewsCount,
  onResetFilters,
}: DynamicComplianceChartProps) {
  const [viewMode, setChartViewMode] = useState<ChartViewMode>("timeline");
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);

  const timeline = computeReviewTimeline(reviews);
  const statusDist = computeStatusDistribution(reviews);
  const severityDist = computeSeverityDistribution(reviews);
  const categoryDist = computeCategoryDistribution(reviews);

  // Default selected bucket to the latest bucket if available
  const activeBucket: TimelineBucket | null =
    (selectedBucketKey
      ? timeline.find((b) => b.periodKey === selectedBucketKey)
      : null) ||
    timeline[timeline.length - 1] ||
    null;

  const maxTimelineReviews = Math.max(1, ...timeline.map((b) => b.totalReviews));

  return (
    <div className="bg-white border border-[#E7E1DA] rounded-2xl p-4 sm:p-5 space-y-4">
      {/* Header & View Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-[#EFECE7]">
        <div>
          <p className="text-xs font-bold text-[#141414] flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5 text-[#141414]" />
            Brand Governance Analytics
          </p>
          <p className="text-[11px] text-[#6B6560] mt-0.5">
            {reviews.length} {reviews.length === 1 ? "review" : "reviews"} analyzed
          </p>
        </div>

        {/* View Mode Pills */}
        <div className="flex items-center gap-1 bg-[#FAF8F6] p-1 rounded-full border border-[#E7E1DA] overflow-x-auto">
          <button
            type="button"
            onClick={() => setChartViewMode("timeline")}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap ${
              viewMode === "timeline"
                ? "bg-[#141414] text-white shadow-xs"
                : "text-[#524E4A] hover:text-[#141414]"
            }`}
          >
            Activity
          </button>
          <button
            type="button"
            onClick={() => setChartViewMode("status")}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap ${
              viewMode === "status"
                ? "bg-[#141414] text-white shadow-xs"
                : "text-[#524E4A] hover:text-[#141414]"
            }`}
          >
            Status
          </button>
          <button
            type="button"
            onClick={() => setChartViewMode("severity")}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap ${
              viewMode === "severity"
                ? "bg-[#141414] text-white shadow-xs"
                : "text-[#524E4A] hover:text-[#141414]"
            }`}
          >
            Severity
          </button>
          <button
            type="button"
            onClick={() => setChartViewMode("category")}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap ${
              viewMode === "category"
                ? "bg-[#141414] text-white shadow-xs"
                : "text-[#524E4A] hover:text-[#141414]"
            }`}
          >
            Categories
          </button>
        </div>
      </div>

      {/* Content depending on view mode */}
      {reviews.length === 0 ? (
        <div className="py-8 px-4 text-center space-y-2.5">
          <FilterX className="w-6 h-6 text-[#8E8780] mx-auto" />
          <p className="text-xs font-semibold text-[#141414]">No review data in this view</p>
          <p className="text-[11px] text-[#6B6560] max-w-xs mx-auto">
            {allReviewsCount > 0
              ? "No reviews match the current filter selection. Reset filters to view overall brand analytics."
              : "No reviews have been submitted yet. Submit a new draft to begin governance tracking."}
          </p>
          {onResetFilters && allReviewsCount > 0 && (
            <button
              type="button"
              onClick={onResetFilters}
              className="mt-1 px-3 py-1.5 rounded-full bg-[#141414] text-white text-[11px] font-semibold hover:bg-[#2B2B2B]"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : viewMode === "timeline" ? (
        <div className="space-y-3">
          {/* Active Month Detail Badge */}
          {activeBucket && (
            <div className="flex items-center justify-between text-[11px] bg-[#FAF8F6] border border-[#E7E1DA] rounded-xl px-3 py-2">
              <span className="font-semibold text-[#141414]">
                Period: {activeBucket.label}
              </span>
              <span className="tabular-nums font-medium text-[#524E4A]">
                {activeBucket.totalReviews} reviews · {activeBucket.avgComplianceScore}% avg score
              </span>
            </div>
          )}

          {/* Dynamic Timeline Bars */}
          <div className="grid grid-flow-col auto-cols-fr gap-2 items-end h-32 pt-2 border-b border-[#EFECE7] pb-2">
            {timeline.map((bucket) => {
              const isSelected = activeBucket?.periodKey === bucket.periodKey;
              // Normalize height relative to maximum
              const heightPercent = Math.max(
                20,
                Math.round((bucket.totalReviews / maxTimelineReviews) * 100),
              );

              const totalFindingsInBucket =
                bucket.openFindingsCount + bucket.resolvedFindingsCount;
              const openPct =
                totalFindingsInBucket > 0
                  ? Math.round((bucket.openFindingsCount / totalFindingsInBucket) * 100)
                  : 0;
              const resolvedPct =
                totalFindingsInBucket > 0
                  ? 100 - openPct
                  : 100;

              return (
                <button
                  key={bucket.periodKey}
                  type="button"
                  onClick={() => setSelectedBucketKey(bucket.periodKey)}
                  className={`flex flex-col items-center justify-end h-full rounded-xl p-1 transition-all ${
                    isSelected
                      ? "border-2 border-[#141414] bg-[#FAF8F6]"
                      : "border border-transparent hover:bg-[#FAF8F6]/70"
                  }`}
                  title={`${bucket.label}: ${bucket.totalReviews} reviews, ${bucket.openFindingsCount} open findings`}
                >
                  <div
                    className="w-full flex flex-col gap-0.5 items-stretch justify-end"
                    style={{ height: `${heightPercent}%` }}
                  >
                    {/* Pink for open findings / changes */}
                    {bucket.openFindingsCount > 0 && (
                      <div
                        className="w-full rounded-t-md bg-[#F6D5DA]"
                        style={{ height: `${Math.max(15, openPct)}%` }}
                      />
                    )}
                    {/* Mint for resolved or supported */}
                    <div
                      className={`w-full ${
                        bucket.openFindingsCount > 0 ? "rounded-b-md" : "rounded-md"
                      } bg-[#CDEEE0]`}
                      style={{ height: `${Math.max(20, resolvedPct)}%` }}
                    />
                  </div>
                  <span
                    className={`text-[10px] mt-1.5 tabular-nums ${
                      isSelected
                        ? "bg-[#141414] text-white px-1.5 py-0.5 rounded-md font-semibold"
                        : "text-[#6B6560]"
                    }`}
                  >
                    {bucket.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Timeline Legend */}
          <div className="flex flex-wrap items-center justify-between text-[11px] text-[#6B6560] pt-1 px-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#CDEEE0] border border-[#BAE0D0]" />
              Resolved / Clean ({activeBucket?.resolvedFindingsCount ?? 0})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F6D5DA] border border-[#EBC3CA]" />
              Open Issues ({activeBucket?.openFindingsCount ?? 0})
            </span>
          </div>
        </div>
      ) : viewMode === "status" ? (
        <div className="space-y-3">
          {/* Stacked Proportional Bar */}
          <div className="w-full h-3 rounded-full overflow-hidden flex bg-[#FAF8F6] border border-[#E7E1DA]">
            {statusDist.approved.count > 0 && (
              <div
                className="bg-[#CDEEE0] transition-all"
                style={{ width: `${statusDist.approved.percentage}%` }}
                title={`Approved: ${statusDist.approved.count} (${statusDist.approved.percentage}%)`}
              />
            )}
            {statusDist.pending.count > 0 && (
              <div
                className="bg-[#FAF0C8] transition-all"
                style={{ width: `${statusDist.pending.percentage}%` }}
                title={`Pending: ${statusDist.pending.count} (${statusDist.pending.percentage}%)`}
              />
            )}
            {statusDist.rejected.count > 0 && (
              <div
                className="bg-[#F6D5DA] transition-all"
                style={{ width: `${statusDist.rejected.percentage}%` }}
                title={`Changes Requested: ${statusDist.rejected.count} (${statusDist.rejected.percentage}%)`}
              />
            )}
          </div>

          {/* Status Breakdown Cards */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#CDEEE0]/50 border border-[#BAE0D0] rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-[#3F5E50] font-semibold flex items-center justify-center gap-1 mb-0.5">
                <CheckCircle2 className="w-3 h-3 text-[#14532D]" /> Approved
              </p>
              <p className="text-base font-bold text-[#141414] tabular-nums">
                {statusDist.approved.count}
              </p>
              <p className="text-[10px] text-[#3F5E50] tabular-nums mt-0.5">
                {statusDist.approved.percentage}%
              </p>
            </div>

            <div className="bg-[#FAF0C8]/60 border border-[#EDE1B4] rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-[#5E5225] font-semibold flex items-center justify-center gap-1 mb-0.5">
                <Clock className="w-3 h-3 text-[#78350F]" /> Pending
              </p>
              <p className="text-base font-bold text-[#141414] tabular-nums">
                {statusDist.pending.count}
              </p>
              <p className="text-[10px] text-[#5E5225] tabular-nums mt-0.5">
                {statusDist.pending.percentage}%
              </p>
            </div>

            <div className="bg-[#F6D5DA]/60 border border-[#EBC3CA] rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-[#7F1D1D] font-semibold flex items-center justify-center gap-1 mb-0.5">
                <XCircle className="w-3 h-3 text-[#7F1D1D]" /> Requested
              </p>
              <p className="text-base font-bold text-[#141414] tabular-nums">
                {statusDist.rejected.count}
              </p>
              <p className="text-[10px] text-[#7F1D1D] tabular-nums mt-0.5">
                {statusDist.rejected.percentage}%
              </p>
            </div>
          </div>
        </div>
      ) : viewMode === "severity" ? (
        <div className="space-y-3">
          {/* Stacked Proportional Severity Bar */}
          <div className="w-full h-3 rounded-full overflow-hidden flex bg-[#FAF8F6] border border-[#E7E1DA]">
            {severityDist.high.count > 0 && (
              <div
                className="bg-[#F6D5DA] transition-all"
                style={{ width: `${severityDist.high.percentage}%` }}
                title={`High: ${severityDist.high.count}`}
              />
            )}
            {severityDist.medium.count > 0 && (
              <div
                className="bg-[#FAF0C8] transition-all"
                style={{ width: `${severityDist.medium.percentage}%` }}
                title={`Medium: ${severityDist.medium.count}`}
              />
            )}
            {severityDist.low.count > 0 && (
              <div
                className="bg-[#CDEEE0] transition-all"
                style={{ width: `${severityDist.low.percentage}%` }}
                title={`Low: ${severityDist.low.count}`}
              />
            )}
          </div>

          {/* Severity Detail Rows */}
          <div className="space-y-2">
            <div className="flex items-center justify-between p-2 rounded-xl bg-[#F6D5DA]/45 border border-[#EBC3CA] text-xs">
              <span className="font-semibold text-[#7F1D1D] flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" /> High Severity
              </span>
              <span className="tabular-nums font-bold text-[#141414]">
                {severityDist.high.count} issues ({severityDist.high.percentage}%)
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-xl bg-[#FAF0C8]/50 border border-[#EDE1B4] text-xs">
              <span className="font-semibold text-[#78350F] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Medium Severity
              </span>
              <span className="tabular-nums font-bold text-[#141414]">
                {severityDist.medium.count} issues ({severityDist.medium.percentage}%)
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-xl bg-[#CDEEE0]/45 border border-[#BAE0D0] text-xs">
              <span className="font-semibold text-[#14532D] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Low Severity
              </span>
              <span className="tabular-nums font-bold text-[#141414]">
                {severityDist.low.count} issues ({severityDist.low.percentage}%)
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* Category View */
        <div className="space-y-2">
          {categoryDist.map((item) => (
            <div
              key={item.category}
              className="p-2 rounded-xl bg-[#FAF8F6] border border-[#E7E1DA] space-y-1.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#141414]">{item.category}</span>
                <span className="text-[11px] tabular-nums text-[#6B6560]">
                  {item.count} total ({item.openCount} open)
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[#E7E1DA] overflow-hidden flex">
                <div
                  className="bg-[#141414] rounded-full transition-all"
                  style={{ width: `${item.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
