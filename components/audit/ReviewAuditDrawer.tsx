"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";
import { REVIEW_STATUS_META } from "@/components/ThemeTokens";
import { ReviewSubmission } from "@/lib/types";
import {
  buildReviewAuditTrail,
  computeReviewAuditSummary,
  filterReviewAuditTrail,
  ReviewAuditCategory,
} from "@/lib/audit-history";
import { ReviewAuditTimeline } from "./ReviewAuditTimeline";

interface ReviewAuditDrawerProps {
  review?: ReviewSubmission | null;
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_TABS: Array<{ label: string; value: ReviewAuditCategory }> = [
  { label: "All Events", value: "all" },
  { label: "Decisions", value: "decision" },
  { label: "Findings", value: "finding" },
  { label: "Corrections", value: "correction" },
  { label: "Comments", value: "comment" },
  { label: "Analysis Runs", value: "analysis" },
];

export function ReviewAuditDrawer({ review, isOpen, onClose }: ReviewAuditDrawerProps) {
  const { activities } = useIdentiq();
  const [selectedCategory, setSelectedCategory] = useState<ReviewAuditCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [mountedNow, setMountedNow] = useState<Date | null>(null);

  useEffect(() => {
    // Hydration-safe client reference timestamp initialization
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMountedNow(new Date());
  }, []);

  // Handle escape key to close drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Build complete review audit trail
  const allEntries = useMemo(() => {
    if (!review) return [];
    return buildReviewAuditTrail(review, activities, mountedNow);
  }, [review, activities, mountedNow]);

  // Compute summary statistics
  const summary = useMemo(() => computeReviewAuditSummary(allEntries), [allEntries]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return filterReviewAuditTrail(allEntries, selectedCategory, searchQuery);
  }, [allEntries, selectedCategory, searchQuery]);

  if (!isOpen || !review) {
    return null;
  }

  const statusMeta = REVIEW_STATUS_META[review.status];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] transition-opacity"
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        {/* Drawer Panel */}
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-drawer-title"
          className="w-screen max-w-2xl bg-white border-l border-[#E7E1DA] shadow-2xl flex flex-col justify-between"
        >
          {/* Header */}
          <div className="p-6 border-b border-[#E7E1DA] bg-[#FAF8F6] space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white border border-[#E7E1DA] ${statusMeta.textColor}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dotColor.replace("text-", "bg-")}`} />
                    {statusMeta.label}
                  </span>
                  <span className="text-xs font-mono tabular-nums font-semibold text-[#141414] bg-white px-2 py-0.5 rounded-full border border-[#E7E1DA]">
                    {review.complianceScore}% Score
                  </span>
                  <span className="text-xs text-[#6B6560]">· {review.contentType}</span>
                </div>

                <h2 id="audit-drawer-title" className="text-xl font-bold text-[#141414] leading-snug">
                  {review.title}
                </h2>
                <p className="text-xs text-[#6B6560] mt-0.5">
                  Guideline Collection: <span className="font-semibold text-[#3F3B37]">{review.guidelineCollection}</span>
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close audit history drawer"
                className="p-2 rounded-full hover:bg-black/5 text-[#6B6560] hover:text-[#141414] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-4 gap-2 bg-white border border-[#E7E1DA] rounded-xl p-2.5 text-center text-xs">
              <div>
                <span className="block text-[10px] text-[#6B6560]">Total Records</span>
                <span className="font-bold font-mono text-[#141414]">{summary.totalEntries}</span>
              </div>
              <div>
                <span className="block text-[10px] text-[#6B6560]">Verified Logs</span>
                <span className="font-bold font-mono text-[#14532D]">{summary.recordedEventsCount}</span>
              </div>
              <div>
                <span className="block text-[10px] text-[#6B6560]">Decisions</span>
                <span className="font-bold font-mono text-[#141414]">{summary.decisionsCount}</span>
              </div>
              <div>
                <span className="block text-[10px] text-[#6B6560]">Comments</span>
                <span className="font-bold font-mono text-[#141414]">{summary.commentsCount}</span>
              </div>
            </div>

            {/* Category Filter Pills & Search */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                {CATEGORY_TABS.map((tab) => {
                  const active = selectedCategory === tab.value;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setSelectedCategory(tab.value)}
                      className={`px-3 py-1.5 rounded-full font-medium transition-colors whitespace-nowrap border shrink-0 ${
                        active
                          ? "bg-[#141414] text-white border-[#141414]"
                          : "bg-white text-[#524E4A] border-[#E7E1DA] hover:bg-[#FAF8F6]"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#6B6560] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter audit entries by actor, action, finding, or keyword..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl bg-white border border-[#E7E1DA] text-xs text-[#141414] placeholder:text-[#8E8780] focus:outline-none focus:border-[#141414]"
                />
              </div>
            </div>
          </div>

          {/* Body: Scrollable Audit Timeline */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between text-xs text-[#6B6560]">
              <span>
                Showing <strong className="text-[#141414]">{filteredEntries.length}</strong> of{" "}
                <strong className="text-[#141414]">{allEntries.length}</strong> audit records
              </span>

              {(selectedCategory !== "all" || searchQuery.trim()) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory("all");
                    setSearchQuery("");
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7F1D1D] hover:underline"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset filters
                </button>
              )}
            </div>

            <ReviewAuditTimeline entries={filteredEntries} referenceNow={mountedNow} />
          </div>

          {/* Footer Note on Audit Integrity */}
          <div className="p-4 border-t border-[#E7E1DA] bg-[#FAF8F6] text-[11px] text-[#6B6560] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#14532D] shrink-0" />
              <span>Verified governance records are logged with immutable IDs and ISO timestamps.</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B]"
            >
              Done
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
