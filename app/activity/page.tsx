"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Calendar,
  Filter,
  History,
  RotateCcw,
  Search,
  User,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";
import { REVIEW_STATUS_META } from "@/components/ThemeTokens";
import {
  ActivityDateRange,
  ActivityEventType,
  filterActivities,
  getUniqueActors,
  groupActivitiesByDate,
} from "@/lib/activity-timeline";
import { ActivityTimelineCard } from "@/components/activity/ActivityTimelineCard";
import { ReviewAuditDrawer } from "@/components/audit/ReviewAuditDrawer";
import { ReviewSubmission } from "@/lib/types";

const EVENT_TYPE_OPTIONS: Array<{ label: string; value: "all" | ActivityEventType }> = [
  { label: "All Event Types", value: "all" },
  { label: "Submissions", value: "submitted" },
  { label: "Approvals", value: "approved" },
  { label: "Changes Requested", value: "changes_requested" },
  { label: "Resolved Findings", value: "resolved" },
  { label: "Corrections Applied", value: "correction_applied" },
  { label: "Reviewer Comments", value: "comment_added" },
  { label: "Manual Findings", value: "manual_finding_added" },
  { label: "Knowledge Updates", value: "knowledge_updated" },
  { label: "Asset Uploads", value: "asset_uploaded" },
];

const DATE_RANGE_OPTIONS: Array<{ label: string; value: ActivityDateRange }> = [
  { label: "All Time", value: "all" },
  { label: "Today", value: "today" },
  { label: "Last 7 Days", value: "7d" },
  { label: "Last 30 Days", value: "30d" },
  { label: "Legacy Records Only", value: "legacy" },
];

export default function ActivityHistoryPage() {
  const router = useRouter();
  const { reviews, activities, setActiveReviewId } = useIdentiq();

  const [viewMode, setViewMode] = useState<"audit" | "reviews">("audit");

  // Filters for Audit Timeline
  const [selectedEventType, setSelectedEventType] = useState<"all" | ActivityEventType>("all");
  const [selectedActor, setSelectedActor] = useState<string>("all");
  const [selectedDateRange, setSelectedDateRange] = useState<ActivityDateRange>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [mountedNow, setMountedNow] = useState<Date | null>(null);
  const [selectedAuditReview, setSelectedAuditReview] = useState<ReviewSubmission | null>(null);

  useEffect(() => {
    // Hydration-safe client reference timestamp initialization
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMountedNow(new Date());
  }, []);

  // Map reviews by id for fast lookup
  const reviewsMap = useMemo(() => {
    const map = new Map<string, ReviewSubmission>();
    for (const r of reviews) {
      map.set(r.id, r);
    }
    return map;
  }, [reviews]);

  // Unique list of actors across all activities
  const availableActors = useMemo(() => getUniqueActors(activities), [activities]);

  // Filtered reviews for "Previous Reviews" table view
  const filteredReviews = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return reviews.filter(
      (r) =>
        !q ||
        r.title.toLowerCase().includes(q) ||
        r.submittedBy.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q) ||
        r.guidelineCollection.toLowerCase().includes(q),
    );
  }, [reviews, searchQuery]);

  // Filtered and sorted activities for "Audit Timeline" view
  const filteredActivities = useMemo(() => {
    return filterActivities(
      activities,
      {
        eventType: selectedEventType,
        actor: selectedActor,
        dateRange: selectedDateRange,
        searchQuery,
      },
      reviewsMap,
      mountedNow,
    );
  }, [activities, selectedEventType, selectedActor, selectedDateRange, searchQuery, reviewsMap, mountedNow]);

  // Grouped activities (Today, Yesterday, Older, Legacy)
  const groupedActivities = useMemo(() => {
    return groupActivitiesByDate(filteredActivities, mountedNow);
  }, [filteredActivities, mountedNow]);

  const isTimelineFiltered =
    selectedEventType !== "all" ||
    selectedActor !== "all" ||
    selectedDateRange !== "all" ||
    searchQuery.trim().length > 0;

  const resetAllTimelineFilters = () => {
    setSelectedEventType("all");
    setSelectedActor("all");
    setSelectedDateRange("all");
    setSearchQuery("");
    setMountedNow(new Date());
  };

  const openStudio = (reviewId: string) => {
    setActiveReviewId(reviewId);
    router.push(`/studio?id=${reviewId}`);
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
      {/* Header & View Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#6B6560] mb-1">
            Governance Audit Trail & Submission Records
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">
            Activity & History
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-[#F3EDE8] p-1 rounded-full border border-[#E7E1DA]">
            <button
              type="button"
              onClick={() => setViewMode("audit")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                viewMode === "audit"
                  ? "bg-[#141414] text-white shadow-xs"
                  : "text-[#524E4A] hover:text-[#141414]"
              }`}
            >
              Audit Timeline
            </button>
            <button
              type="button"
              onClick={() => setViewMode("reviews")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                viewMode === "reviews"
                  ? "bg-[#141414] text-white shadow-xs"
                  : "text-[#524E4A] hover:text-[#141414]"
              }`}
            >
              Previous Reviews ({reviews.length})
            </button>
          </div>
        </div>
      </div>

      {viewMode === "audit" ? (
        <div className="space-y-6">
          {/* Multi-Parameter Timeline Filter Strip */}
          <div className="bg-white border border-[#E7E1DA] rounded-2xl p-4 space-y-3 shadow-2xs">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
              {/* Event Type Filter */}
              <div className="sm:col-span-3">
                <div className="flex items-center gap-2 bg-[#FAF8F6] border border-[#E7E1DA] rounded-xl px-3 py-2 text-xs">
                  <Filter className="w-3.5 h-3.5 text-[#6B6560] shrink-0" />
                  <select
                    aria-label="Filter by event type"
                    value={selectedEventType}
                    onChange={(e) =>
                      setSelectedEventType(e.target.value as "all" | ActivityEventType)
                    }
                    className="w-full bg-transparent text-[#141414] font-medium focus:outline-none truncate"
                  >
                    {EVENT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Actor Filter */}
              <div className="sm:col-span-3">
                <div className="flex items-center gap-2 bg-[#FAF8F6] border border-[#E7E1DA] rounded-xl px-3 py-2 text-xs">
                  <User className="w-3.5 h-3.5 text-[#6B6560] shrink-0" />
                  <select
                    aria-label="Filter by actor"
                    value={selectedActor}
                    onChange={(e) => setSelectedActor(e.target.value)}
                    className="w-full bg-transparent text-[#141414] font-medium focus:outline-none truncate"
                  >
                    <option value="all">All Actors</option>
                    {availableActors.map((actor) => (
                      <option key={actor} value={actor}>
                        {actor}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Date Range Filter */}
              <div className="sm:col-span-3">
                <div className="flex items-center gap-2 bg-[#FAF8F6] border border-[#E7E1DA] rounded-xl px-3 py-2 text-xs">
                  <Calendar className="w-3.5 h-3.5 text-[#6B6560] shrink-0" />
                  <select
                    aria-label="Filter by date range"
                    value={selectedDateRange}
                    onChange={(e) => {
                      setSelectedDateRange(e.target.value as ActivityDateRange);
                      setMountedNow(new Date());
                    }}
                    className="w-full bg-transparent text-[#141414] font-medium focus:outline-none truncate"
                  >
                    {DATE_RANGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Text Search Input */}
              <div className="sm:col-span-3 relative">
                <Search className="w-3.5 h-3.5 text-[#6B6560] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter activity..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#FAF8F6] border border-[#E7E1DA] text-xs text-[#141414] placeholder:text-[#8E8780] focus:outline-none focus:border-[#141414]"
                />
              </div>
            </div>

            {/* Filter Status Strip */}
            <div className="flex items-center justify-between text-xs pt-1 border-t border-[#EFECE7]">
              <span className="text-[#6B6560]">
                Showing <span className="font-bold text-[#141414]">{filteredActivities.length}</span>{" "}
                of <span className="font-bold text-[#141414]">{activities.length}</span> recorded events
              </span>

              {isTimelineFiltered && (
                <button
                  type="button"
                  onClick={resetAllTimelineFilters}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#7F1D1D] hover:underline"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Filters
                </button>
              )}
            </div>
          </div>

          {/* Grouped Chronological Activity Stream */}
          {filteredActivities.length === 0 ? (
            <div className="bg-white border border-[#E7E1DA] rounded-[24px] p-10 text-center space-y-3">
              <History className="w-8 h-8 text-[#8E8780] mx-auto" />
              <p className="text-sm font-semibold text-[#141414]">
                {activities.length === 0
                  ? "No activity recorded yet"
                  : "No activity events match your active filters"}
              </p>
              <p className="text-xs text-[#6B6560] max-w-sm mx-auto">
                {activities.length === 0
                  ? "Review actions, sign-offs, and knowledge edits will appear here."
                  : "Try clearing search keywords or switching date ranges to include historical seed records."}
              </p>
              {isTimelineFiltered && (
                <button
                  type="button"
                  onClick={resetAllTimelineFilters}
                  className="px-4 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B]"
                >
                  Reset All Filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {groupedActivities.map(({ group, items }) => (
                <div key={group} className="space-y-3">
                  {/* Group Heading */}
                  <div className="flex items-center gap-2 px-1">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-[#6B6560]">
                      {group}
                    </h2>
                    <span className="text-[11px] font-mono tabular-nums text-[#8E8780]">
                      ({items.length})
                    </span>
                    <div className="flex-1 h-px bg-[#E7E1DA]" />
                  </div>

                  {/* Activity Cards in Group */}
                  <div className="space-y-2.5">
                    {items.map((event) => (
                      <ActivityTimelineCard
                        key={event.id}
                        event={event}
                        review={event.reviewId ? reviewsMap.get(event.reviewId) : undefined}
                        referenceNow={mountedNow}
                        onOpenReview={openStudio}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Previous Reviews Table View (Preserved) */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#6B6560]">
              Showing {filteredReviews.length} of {reviews.length} total reviews
            </p>
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-[#6B6560] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search reviews..."
                className="w-full pl-9 pr-3 py-2 rounded-full bg-white border border-[#E7E1DA] text-xs text-[#141414] focus:outline-none focus:border-[#141414]"
              />
            </div>
          </div>

          <div className="bg-white border border-[#E7E1DA] rounded-[24px] overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E7E1DA] bg-[#FAF8F6] text-[11px] font-semibold text-[#6B6560]">
                    <th className="py-3.5 px-5">Submission</th>
                    <th className="py-3.5 px-4">Type & Collection</th>
                    <th className="py-3.5 px-4">Submitted By</th>
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4 text-right">Compliance</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0ECE7] text-xs">
                  {filteredReviews.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-xs text-[#6B6560]">
                        No submissions match the search query.
                      </td>
                    </tr>
                  ) : (
                    filteredReviews.map((rev) => {
                      const statusMeta = REVIEW_STATUS_META[rev.status];
                      return (
                        <tr key={rev.id} className="hover:bg-[#FAF8F6]/70 transition-colors">
                          <td className="py-3.5 px-5 font-semibold text-[#141414]">
                            {rev.title}
                          </td>
                          <td className="py-3.5 px-4 text-[#524E4A]">
                            {rev.contentType} · {rev.guidelineCollection}
                          </td>
                          <td className="py-3.5 px-4 text-[#3F3B37]">{rev.submittedBy}</td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-[#6B6560]">
                            {rev.submittedAt}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-[#141414]">
                            {rev.complianceScore}%
                          </td>
                          <td className={`py-3.5 px-4 font-semibold ${statusMeta.textColor}`}>
                            {statusMeta.label}
                          </td>
                          <td className="py-3.5 px-5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-2.5">
                              <button
                                type="button"
                                onClick={() => setSelectedAuditReview(rev)}
                                className="inline-flex items-center gap-1 font-semibold text-[#524E4A] hover:text-[#141414] hover:underline"
                              >
                                <History className="w-3.5 h-3.5" />
                                Audit
                              </button>
                              <span className="text-[#E7E1DA]">·</span>
                              <button
                                type="button"
                                onClick={() => openStudio(rev.id)}
                                className="inline-flex items-center gap-1 font-semibold text-[#141414] hover:underline"
                              >
                                Inspect
                                <ArrowUpRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Review-Level Audit History Drawer */}
      <ReviewAuditDrawer
        review={selectedAuditReview}
        isOpen={Boolean(selectedAuditReview)}
        onClose={() => setSelectedAuditReview(null)}
      />
    </div>
  );
}
