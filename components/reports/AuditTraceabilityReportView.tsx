"use client";

import React, { useState, useMemo } from "react";
import {
  History,
  Search,
  Info,
} from "lucide-react";
import { ReviewSubmission, ActivityEvent } from "@/lib/types";
import {
  buildReviewAuditTrail,
  sortAuditEntries,
  ReviewAuditEntry,
} from "@/lib/audit-history";

interface AuditTraceabilityReportViewProps {
  reviews: ReviewSubmission[];
  activities: ActivityEvent[];
  selectedReviewId?: string;
  referenceNow?: Date | null;
  onSelectReview?: (reviewId: string) => void;
}

export function AuditTraceabilityReportView({
  reviews,
  activities,
  selectedReviewId,
  referenceNow,
  onSelectReview,
}: AuditTraceabilityReportViewProps) {
  const [scope, setScope] = useState<"selected" | "system">(
    selectedReviewId ? "selected" : "system"
  );
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [provenanceFilter, setProvenanceFilter] = useState<"all" | "recorded" | "snapshot">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const activeReview = useMemo(() => {
    return reviews.find((r) => r.id === selectedReviewId) || reviews[0];
  }, [reviews, selectedReviewId]);

  // Generate audit entries based on scope
  const allEntries: ReviewAuditEntry[] = useMemo(() => {
    if (scope === "selected") {
      if (!activeReview) return [];
      return buildReviewAuditTrail(activeReview, activities, referenceNow);
    } else {
      // System-wide: combine audit trails for all reviews
      const entries: ReviewAuditEntry[] = [];
      for (const rev of reviews) {
        const trail = buildReviewAuditTrail(rev, activities, referenceNow);
        entries.push(...trail);
      }
      return sortAuditEntries(entries);
    }
  }, [scope, activeReview, reviews, activities, referenceNow]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return allEntries.filter((entry) => {
      // Category filter
      if (categoryFilter !== "all" && entry.category !== categoryFilter) {
        return false;
      }
      // Provenance filter
      if (provenanceFilter === "recorded" && !entry.isRecordedEvent) {
        return false;
      }
      if (provenanceFilter === "snapshot" && entry.isRecordedEvent) {
        return false;
      }
      // Search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesText =
          entry.action.toLowerCase().includes(query) ||
          entry.actor.toLowerCase().includes(query) ||
          entry.title.toLowerCase().includes(query) ||
          entry.reviewId.toLowerCase().includes(query) ||
          (entry.details?.findingTitle && entry.details.findingTitle.toLowerCase().includes(query));
        if (!matchesText) return false;
      }
      return true;
    });
  }, [allEntries, categoryFilter, provenanceFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Notice Banner: Client State Governance vs Immutable Ledger */}
      <div className="bg-[#FAF8F6] border border-[#E7E1DA] rounded-2xl p-4 flex items-start gap-3 text-xs text-[#5A5550]">
        <Info className="w-4 h-4 text-[#8C827A] shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-[#141414]">Audit Provenance & State Integrity Notice:</span>
          <p className="mt-0.5 leading-relaxed">
            Events marked as <span className="font-semibold text-[#14532D]">Recorded Event</span> represent verified action logs captured during user sessions. Entries marked as <span className="font-semibold text-[#736B63]">Current Snapshot</span> represent synthesized lifecycle records from creative state. In client preview mode, session events reside in local storage and will transition to cryptographically verifiable immutable audit records upon Supabase database persistence.
          </p>
        </div>
      </div>

      {/* Scope and Controls Bar */}
      <div className="bg-white border border-[#E7E1DA] rounded-2xl p-5 shadow-sm space-y-4 no-print">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Scope Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#736B63]">Audit Scope:</span>
            <div className="flex p-0.5 rounded-xl bg-[#FAF8F6] border border-[#E7E1DA]">
              <button
                type="button"
                onClick={() => setScope("selected")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  scope === "selected"
                    ? "bg-white text-[#141414] shadow-xs"
                    : "text-[#736B63] hover:text-[#141414]"
                }`}
              >
                Selected Review ({activeReview?.id || "None"})
              </button>
              <button
                type="button"
                onClick={() => setScope("system")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  scope === "system"
                    ? "bg-white text-[#141414] shadow-xs"
                    : "text-[#736B63] hover:text-[#141414]"
                }`}
              >
                System-Wide ({reviews.length} Creatives)
              </button>
            </div>
          </div>

          {/* Review Picker if scope === "selected" */}
          {scope === "selected" && reviews.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#736B63]">Creative:</span>
              <select
                value={activeReview?.id || ""}
                onChange={(e) => onSelectReview && onSelectReview(e.target.value)}
                className="text-xs bg-[#FAF8F6] border border-[#E7E1DA] rounded-lg px-2.5 py-1.5 font-medium text-[#141414] focus:outline-hidden"
              >
                {reviews.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({r.id})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Filter Row */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-[#E7E1DA]/80">
          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-xs bg-[#FAF8F6] border border-[#E7E1DA] rounded-lg px-2.5 py-1.5 font-medium text-[#141414]"
          >
            <option value="all">All Categories</option>
            <option value="submission">Submission</option>
            <option value="analysis">Analysis Run</option>
            <option value="decision">Decisions</option>
            <option value="finding">Findings</option>
            <option value="correction">Corrections</option>
            <option value="comment">Comments</option>
          </select>

          {/* Provenance Filter */}
          <select
            value={provenanceFilter}
            onChange={(e) => setProvenanceFilter(e.target.value as "all" | "recorded" | "snapshot")}
            className="text-xs bg-[#FAF8F6] border border-[#E7E1DA] rounded-lg px-2.5 py-1.5 font-medium text-[#141414]"
          >
            <option value="all">All Provenance</option>
            <option value="recorded">Recorded Events Only</option>
            <option value="snapshot">State Snapshots Only</option>
          </select>

          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-[#8C827A] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search action, actor, finding or review..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#FAF8F6] border border-[#E7E1DA] rounded-lg placeholder-[#8C827A] focus:outline-hidden"
            />
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white border border-[#E7E1DA] rounded-2xl p-5 shadow-sm break-inside-avoid">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-[#141414] font-display flex items-center gap-2">
              <History className="w-4 h-4 text-[#8C827A]" />
              Audit Traceability Log ({filteredEntries.length} entries)
            </h3>
            <p className="text-xs text-[#5A5550]">
              Chronological log of verified user actions, compliance decisions, and state transitions
            </p>
          </div>
        </div>

        {filteredEntries.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#736B63] bg-[#FAF8F6] rounded-xl border border-dashed border-[#E7E1DA]">
            No audit records match the current filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E7E1DA] text-[#736B63] font-semibold">
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Review</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">Actor</th>
                  <th className="py-2.5 px-3">Details / Target</th>
                  <th className="py-2.5 px-3 text-right">Provenance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E1DA]/60">
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-[#FAF8F6]/60 transition-colors">
                    <td className="py-3 px-3 font-mono text-[11px] text-[#736B63] whitespace-nowrap">
                      {entry.timestamp}
                    </td>
                    <td className="py-3 px-3 font-semibold text-[#141414] whitespace-nowrap">
                      {entry.reviewId}
                    </td>
                    <td className="py-3 px-3">
                      <span className="capitalize font-medium text-[#141414]">
                        {entry.category}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-medium text-[#141414]">{entry.action}</td>
                    <td className="py-3 px-3 text-[#5A5550] whitespace-nowrap">
                      {entry.actor}
                      {entry.actorRole && (
                        <span className="text-[10px] text-[#8C827A] ml-1">
                          ({entry.actorRole})
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-[#5A5550] max-w-sm truncate">
                      {entry.details?.findingTitle && (
                        <span className="font-medium text-[#141414] mr-1">
                          [{entry.details.findingTitle}]
                        </span>
                      )}
                      {entry.details?.commentText ||
                        entry.details?.correctionText ||
                        entry.details?.reviewerNote ||
                        entry.details?.previousValueNotice ||
                        entry.title}
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                          entry.isRecordedEvent
                            ? "bg-[#CDEEE0] text-[#14532D]"
                            : "bg-[#FAF8F6] text-[#736B63] border border-[#E7E1DA]"
                        }`}
                      >
                        {entry.isRecordedEvent ? "Recorded Event" : "Current Snapshot"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
