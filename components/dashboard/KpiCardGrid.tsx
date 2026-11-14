"use client";

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck2,
  Flag,
  Percent,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { DashboardKpiStats } from "@/lib/dashboard-metrics";

interface KpiCardGridProps {
  stats: DashboardKpiStats;
}

export function KpiCardGrid({ stats }: KpiCardGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
      {/* 1. Average Brand Compliance */}
      <div className="bg-white border border-[#E7E1DA] rounded-2xl p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-[#6B6560] mb-1">
            <span className="text-xs font-medium">Compliance Score</span>
            <Percent className="w-3.5 h-3.5 text-[#141414]" />
          </div>
          <p className="text-2xl font-bold text-[#141414] tabular-nums">
            {stats.averageComplianceScore}%
          </p>
        </div>
        <p className="text-[11px] text-[#524E4A] mt-2">
          Across {stats.totalReviews} {stats.totalReviews === 1 ? "review" : "reviews"}
        </p>
      </div>

      {/* 2. Total Reviews */}
      <div className="bg-white border border-[#E7E1DA] rounded-2xl p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-[#6B6560] mb-1">
            <span className="text-xs font-medium">Total Reviews</span>
            <FileCheck2 className="w-3.5 h-3.5 text-[#141414]" />
          </div>
          <p className="text-2xl font-bold text-[#141414] tabular-nums">
            {stats.totalReviews}
          </p>
        </div>
        <p className="text-[11px] text-[#524E4A] mt-2">In current view</p>
      </div>

      {/* 3. Approved Reviews */}
      <div className="bg-[#CDEEE0]/55 border border-[#BAE0D0] rounded-2xl p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-[#3F5E50] mb-1">
            <span className="text-xs font-semibold">Approved</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-[#14532D]" />
          </div>
          <p className="text-2xl font-bold text-[#141414] tabular-nums">
            {stats.approvedReviews}
          </p>
        </div>
        <p className="text-[11px] text-[#3F5E50] mt-2">Approved for release</p>
      </div>

      {/* 4. Pending Reviews */}
      <div className="bg-[#FAF0C8]/65 border border-[#EDE1B4] rounded-2xl p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-[#5E5225] mb-1">
            <span className="text-xs font-semibold">Pending</span>
            <Clock className="w-3.5 h-3.5 text-[#78350F]" />
          </div>
          <p className="text-2xl font-bold text-[#141414] tabular-nums">
            {stats.pendingReviews}
          </p>
        </div>
        <p className="text-[11px] text-[#5E5225] mt-2">Queued in Review Studio</p>
      </div>

      {/* 5. Rejected / Changes Requested */}
      <div className="bg-[#F6D5DA]/60 border border-[#EBC3CA] rounded-2xl p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-[#7F1D1D] mb-1">
            <span className="text-xs font-semibold">Changes Requested</span>
            <XCircle className="w-3.5 h-3.5 text-[#7F1D1D]" />
          </div>
          <p className="text-2xl font-bold text-[#141414] tabular-nums">
            {stats.rejectedReviews}
          </p>
        </div>
        <p className="text-[11px] text-[#7F1D1D] mt-2">Rejected or returned</p>
      </div>

      {/* 6. Flagged Reviews */}
      <div className="bg-[#E2DBFB]/60 border border-[#D3CAEE] rounded-2xl p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-[#4A3E7A] mb-1">
            <span className="text-xs font-semibold">Flagged Reviews</span>
            <Flag className="w-3.5 h-3.5 text-[#4A3E7A]" />
          </div>
          <p className="text-2xl font-bold text-[#141414] tabular-nums">
            {stats.flaggedReviews}
          </p>
        </div>
        <p className="text-[11px] text-[#4A3E7A] mt-2">With conflicting/unverified claims</p>
      </div>

      {/* 7. Total Open Findings */}
      <div className="bg-[#DDF0FA]/70 border border-[#CBE2EF] rounded-2xl p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-[#1E3A8A] mb-1">
            <span className="text-xs font-semibold">Open Findings</span>
            <ShieldAlert className="w-3.5 h-3.5 text-[#1E3A8A]" />
          </div>
          <p className="text-2xl font-bold text-[#141414] tabular-nums">
            {stats.totalOpenFindings}
          </p>
        </div>
        <p className="text-[11px] text-[#1E3A8A] mt-2">Total unresolved issues</p>
      </div>

      {/* 8. High Severity Findings */}
      <div className="bg-[#F6D5DA]/85 border border-[#EBC3CA] rounded-2xl p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-[#7F1D1D] mb-1">
            <span className="text-xs font-semibold">High Severity</span>
            <AlertTriangle className="w-3.5 h-3.5 text-[#7F1D1D]" />
          </div>
          <p className="text-2xl font-bold text-[#7F1D1D] tabular-nums">
            {stats.highSeverityFindings}
          </p>
        </div>
        <p className="text-[11px] text-[#7F1D1D] mt-2">Critical claims to fix</p>
      </div>
    </div>
  );
}
