"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  FileBarChart,
  FileText,
  Filter,
  HelpCircle,
  Layers,
  Megaphone,
  Newspaper,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useIdentiq } from "@/components/IdentiqProvider";
import { PASTEL_SURFACE, REVIEW_STATUS_META } from "@/components/ThemeTokens";
import { GUIDELINE_COLLECTIONS } from "@/lib/seed-data";
import { ContentType } from "@/lib/types";
import {
  computeDashboardStats,
  DateRangeOption,
  filterReviews,
  formatReviewDate,
  getUniqueBrands,
} from "@/lib/dashboard-metrics";
import { formatActivityTimestamp } from "@/lib/activity-timeline";
import { KpiCardGrid } from "@/components/dashboard/KpiCardGrid";
import { DynamicComplianceChart } from "@/components/dashboard/DynamicComplianceChart";
import { LandingView } from "@/components/onboarding/LandingView";
import { OnboardingView } from "@/components/onboarding/OnboardingView";
import { ViewerAvatar } from "@/components/ViewerAvatar";
import { resolveActiveActorIdentity } from "@/lib/viewer-profile";

const CONTENT_FILTERS: Array<{
  label: string;
  value: "All" | ContentType;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { label: "All", value: "All", icon: Layers },
  { label: "Campaign Copy", value: "Campaign Copy", icon: Megaphone },
  { label: "Social Creative", value: "Social Creative", icon: Sparkles },
  { label: "Product Sheet", value: "Product Sheet", icon: FileText },
  { label: "Press Release", value: "Press Release", icon: Newspaper },
];

const DATE_RANGE_OPTIONS: Array<{ label: string; value: DateRangeOption }> = [
  { label: "All Time", value: "all" },
  { label: "Last 30 Days", value: "30d" },
  { label: "Last 7 Days", value: "7d" },
];

export default function HomePage() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const {
    reviews,
    activities,
    knowledge,
    setActiveReviewId,
    user,
    viewerProfile,
    profileHydrated,
    completeOnboarding,
    replayGuidedTour,
  } = useIdentiq();

  const [entryStep, setEntryStep] = useState<"landing" | "onboarding">("landing");

  // Filter States
  const [selectedContentType, setSelectedContentType] = useState<"All" | ContentType>("All");
  const [selectedBrand, setSelectedBrand] = useState<string>("All");
  const [selectedDateRange, setSelectedDateRange] = useState<DateRangeOption>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [mountedNow, setMountedNow] = useState<Date | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMountedNow(new Date());
  }, []);

  const availableBrands = useMemo(
    () => getUniqueBrands(reviews, GUIDELINE_COLLECTIONS),
    [reviews]
  );

  const activeFilters = useMemo(
    () => ({
      contentType: selectedContentType,
      brand: selectedBrand,
      dateRange: selectedDateRange,
      searchQuery,
    }),
    [selectedContentType, selectedBrand, selectedDateRange, searchQuery]
  );

  const filteredReviews = useMemo(
    () => filterReviews(reviews, activeFilters, mountedNow),
    [reviews, activeFilters, mountedNow]
  );

  const stats = useMemo(
    () => computeDashboardStats(filteredReviews),
    [filteredReviews]
  );

  const actor = resolveActiveActorIdentity({
    viewerProfile,
    authUser: user,
  });

  if (!profileHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF8F6] text-[#141414]">
        <div className="flex items-center gap-2.5 text-sm font-semibold">
          <span className="w-8 h-8 rounded-xl bg-[#141414] text-white flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </span>
          <span>Identiq</span>
        </div>
      </div>
    );
  }

  if (!viewerProfile.onboardingCompleted) {
    if (entryStep === "onboarding") {
      return (
        <OnboardingView
          onBack={() => setEntryStep("landing")}
          onComplete={completeOnboarding}
        />
      );
    }
    return <LandingView onGetStarted={() => setEntryStep("onboarding")} />;
  }

  const isFiltered =
    selectedContentType !== "All" ||
    selectedBrand !== "All" ||
    selectedDateRange !== "all" ||
    searchQuery.trim().length > 0;

  const resetAllFilters = () => {
    setSelectedContentType("All");
    setSelectedBrand("All");
    setSelectedDateRange("all");
    setSearchQuery("");
    setMountedNow(new Date());
  };

  const openInStudio = (reviewId: string) => {
    setActiveReviewId(reviewId);
    router.push(`/studio?id=${reviewId}`);
  };

  const approvedKnowledgeCount = knowledge.filter((k) => k.status === "Approved").length;

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="flex flex-col xl:flex-row gap-7 items-start">
        {/* Main Left / Center Editorial Workspace */}
        <div className="flex-1 min-w-0 w-full space-y-6">
          {/* Welcome Header + Primary CTA */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#6B6560] mb-1.5">
                Identiq Governance Overview · {approvedKnowledgeCount} active brand rules
              </p>
              <h1 className="text-3xl sm:text-[40px] font-bold tracking-tight leading-[1.12] text-[#141414] max-w-xl text-balance">
                Govern your brand with verified evidence
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <Link
                href="/reports"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-[#E7E1DA] text-[#141414] hover:bg-[#FAF8F6] text-xs font-semibold transition-colors whitespace-nowrap shadow-xs"
              >
                <FileBarChart className="w-4 h-4 text-[#736B63]" />
                Compliance Reports
              </Link>
              <Link
                href="/reviews/new"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#141414] text-white hover:bg-[#2B2B2B] text-xs font-semibold transition-colors whitespace-nowrap shadow-xs"
              >
                <Plus className="w-4 h-4" />
                Start New Review
              </Link>
            </div>
          </div>

          {/* Comprehensive Multi-Filter Bar */}
          <div className="bg-[#F3EDE8]/70 border border-[#E7E1DA] rounded-2xl p-3 sm:p-3.5 space-y-3">
            {/* Top row: Content type chips (wrapped cleanly across screen widths) */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {CONTENT_FILTERS.map((f) => {
                  const Icon = f.icon;
                  const active = selectedContentType === f.value;
                  return (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setSelectedContentType(f.value)}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap border ${
                        active
                          ? "bg-[#141414] text-white border-[#141414]"
                          : "bg-white text-[#3F3B37] border-[#E7E1DA] hover:bg-[#FAF8F6]"
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-md flex items-center justify-center ${
                          active ? "bg-white/15 text-white" : "bg-[#FAF8F6] text-[#141414]"
                        }`}
                      >
                        <Icon className="w-3 h-3" />
                      </span>
                      {f.label}
                    </button>
                  );
                })}
              </div>

              {isFiltered && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-[#7F1D1D] hover:bg-[#F6D5DA]/60 transition-colors shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Filters
                </button>
              )}
            </div>

            {/* Bottom row: Brand Dropdown, Date Range Selector, Search Input */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
              <div className="sm:col-span-4 relative min-w-0">
                <div className="flex items-center gap-2 bg-white border border-[#E7E1DA] rounded-xl px-3 py-2 text-xs">
                  <Tag className="w-3.5 h-3.5 text-[#6B6560] shrink-0" />
                  <select
                    aria-label="Filter by brand or guideline collection"
                    value={selectedBrand}
                    onChange={(e) => setSelectedBrand(e.target.value)}
                    className="w-full bg-transparent text-[#141414] font-medium focus:outline-none truncate"
                  >
                    <option value="All">All Brands &amp; Collections</option>
                    {availableBrands.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="sm:col-span-3 min-w-0">
                <div className="flex items-center gap-2 bg-white border border-[#E7E1DA] rounded-xl px-3 py-2 text-xs">
                  <Calendar className="w-3.5 h-3.5 text-[#6B6560] shrink-0" />
                  <select
                    aria-label="Filter by date range"
                    value={selectedDateRange}
                    onChange={(e) => {
                      setSelectedDateRange(e.target.value as DateRangeOption);
                      setMountedNow(new Date());
                    }}
                    className="w-full bg-transparent text-[#141414] font-medium focus:outline-none"
                  >
                    {DATE_RANGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="sm:col-span-5 relative min-w-0">
                <Search className="w-3.5 h-3.5 text-[#6B6560] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by title, brand, or copy..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-[#E7E1DA] text-xs text-[#141414] placeholder:text-[#8E8780] focus:outline-none focus:border-[#141414]"
                />
              </div>
            </div>
          </div>

          {/* Dynamic 8-Metric KPI Card Grid */}
          <KpiCardGrid stats={stats} />

          {/* Recent Submissions Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-[#141414]">Recent Submissions</h2>
                <p className="text-xs text-[#6B6560]">
                  Showing {filteredReviews.length} of {reviews.length} total submissions
                </p>
              </div>

              <Link
                href="/approvals"
                className="text-xs font-semibold text-[#524E4A] hover:text-[#141414] inline-flex items-center gap-1 transition-colors shrink-0"
              >
                View approval queue
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {filteredReviews.length === 0 ? (
              <div className="bg-white border border-[#E7E1DA] rounded-[22px] p-8 text-center space-y-3">
                <Filter className="w-7 h-7 text-[#8E8780] mx-auto" />
                <p className="text-sm font-semibold text-[#141414]">
                  {reviews.length === 0
                    ? "No reviews in workspace yet"
                    : "No submissions match your active filters"}
                </p>
                <p className="text-xs text-[#6B6560] max-w-sm mx-auto">
                  {reviews.length === 0
                    ? "Start your first multimodal brand governance review to view insights."
                    : "Try adjusting your date range, brand selection, or content type filter."}
                </p>
                {isFiltered ? (
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="px-4 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B]"
                  >
                    Reset All Filters
                  </button>
                ) : (
                  <Link
                    href="/reviews/new"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B]"
                  >
                    <Plus className="w-3.5 h-3.5" /> Start New Review
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredReviews.map((review, index) => {
                  const surface = PASTEL_SURFACE[review.pastelTheme];
                  const openCount = review.findings.filter((f) => !f.resolved).length;
                  const statusMeta = REVIEW_STATUS_META[review.status];
                  const motionProps = prefersReducedMotion
                    ? {}
                    : {
                        initial: { opacity: 0, y: 6 },
                        animate: { opacity: 1, y: 0 },
                        transition: { duration: 0.18, delay: index * 0.03 },
                      };

                  return (
                    <motion.button
                      key={review.id}
                      type="button"
                      {...motionProps}
                      onClick={() => openInStudio(review.id)}
                      className={`text-left w-full min-w-0 ${surface.bg} border ${surface.border} rounded-[22px] p-5 hover:brightness-[0.985] transition-all flex flex-col justify-between min-h-[192px]`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-7 h-7 rounded-lg ${surface.iconBg} flex items-center justify-center shrink-0 text-[#141414]`}
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </span>
                            <span className="text-xs font-semibold text-[#3F3B37] truncate">
                              {review.contentType}
                            </span>
                          </div>

                          <span className="px-2.5 py-1 rounded-lg bg-white/90 text-[11px] font-bold text-[#141414] tabular-nums shrink-0 shadow-2xs">
                            {review.complianceScore}% Score
                          </span>
                        </div>

                        <h3 className="text-base font-bold text-[#141414] leading-snug mb-1 truncate">
                          {review.title}
                        </h3>
                        <p className="text-[11px] font-medium text-[#524E4A] mb-2 truncate">
                          {review.guidelineCollection}
                        </p>

                        <p className="text-xs text-[#3F3B37] line-clamp-2 leading-relaxed">
                          {review.textContent}
                        </p>
                      </div>

                      <div className="pt-3 mt-3 border-t border-black/8 space-y-1.5 text-xs text-[#3F3B37]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[11px] text-[#6B6560]">
                            {review.submittedBy} · {formatReviewDate(review.submittedAt)}
                          </span>
                          <span className={`font-semibold shrink-0 text-xs ${statusMeta.textColor}`}>
                            {statusMeta.label}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="tabular-nums font-medium text-[#141414]">
                            {openCount} {openCount === 1 ? "open issue" : "open issues"}
                          </span>
                          <span className="font-semibold text-[#141414] underline underline-offset-2">
                            Inspect Studio →
                          </span>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right Aside: Viewer Profile, Approvals Shortcut & Dynamic Analytics Chart */}
        <aside className="w-full xl:w-[356px] shrink-0 bg-[#F3EDE8] border border-[#E7E1DA] rounded-[28px] p-5 space-y-5 min-w-0">
          <div className="flex items-center justify-between">
            <Link
              href="/activity"
              aria-label="View governance notifications"
              className="w-9 h-9 rounded-full bg-white border border-[#E7E1DA] flex items-center justify-center text-[#141414] hover:bg-[#FAF8F6] transition-colors"
            >
              <Bell className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => replayGuidedTour()}
                aria-label="Replay quick tour"
                title="Quick Product Tour"
                className="w-9 h-9 rounded-full bg-white border border-[#E7E1DA] flex items-center justify-center text-[#141414] hover:bg-[#FAF8F6] transition-colors"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
              <Link
                href="/settings"
                aria-label="Open workspace settings"
                className="w-9 h-9 rounded-full bg-white border border-[#E7E1DA] flex items-center justify-center text-[#141414] hover:bg-[#FAF8F6] transition-colors"
              >
                <Settings className="w-4 h-4" />
              </Link>
            </div>
          </div>

          <div className="text-center px-2 min-w-0">
            <ViewerAvatar
              name={actor.name}
              avatarId={viewerProfile.avatarId}
              customAvatarDataUrl={viewerProfile.customAvatarDataUrl}
              size="xl"
              className="mx-auto mb-2.5 shadow-xs"
            />
            <h2 className="text-base font-bold text-[#141414] truncate">{actor.name}</h2>
            <p className="text-xs text-[#6B6560] truncate">{actor.role}</p>
          </div>

          <Link
            href="/approvals"
            className="flex items-center justify-between bg-white border border-[#E7E1DA] rounded-2xl px-4 py-3 hover:border-[#141414]/40 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-7 h-7 rounded-full bg-[#FAF8F6] flex items-center justify-center text-[#141414] shrink-0">
                <Clock className="w-3.5 h-3.5" />
              </span>
              <span className="text-xs font-semibold text-[#141414] tabular-nums truncate">
                {stats.pendingReviews} Pending Approvals
              </span>
            </div>
            <ArrowRight className="w-4 h-4 text-[#6B6560] shrink-0" />
          </Link>

          <DynamicComplianceChart
            reviews={filteredReviews}
            allReviewsCount={reviews.length}
            onResetFilters={resetAllFilters}
          />

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#141414]">Recent Activity</h3>
              <Link
                href="/activity"
                className="text-[11px] font-semibold text-[#524E4A] hover:text-[#141414]"
              >
                All logs
              </Link>
            </div>

            <div className="space-y-2.5">
              {activities.slice(0, 3).map((act, idx) => {
                const cardColor =
                  idx === 0
                    ? "bg-[#F6D5DA] border-[#EBC3CA]"
                    : idx === 1
                    ? "bg-[#DDF0FA] border-[#CBE2EF]"
                    : "bg-[#CDEEE0] border-[#BAE0D0]";
                return (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() =>
                      act.reviewId ? openInStudio(act.reviewId) : router.push("/activity")
                    }
                    className={`w-full text-left ${cardColor} border rounded-2xl p-3.5 hover:brightness-[0.985] transition-all`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[11px] font-semibold text-[#141414] flex items-center gap-1.5 min-w-0 truncate">
                        {act.type === "approved" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#14532D] shrink-0" />
                        ) : (
                          <ShieldAlert className="w-3.5 h-3.5 text-[#141414] shrink-0" />
                        )}
                        <span className="truncate">{act.actor}</span>
                      </span>
                      <span className="text-[11px] text-[#524E4A] tabular-nums shrink-0">
                        {formatActivityTimestamp(act.timestamp, mountedNow)}
                      </span>
                    </div>
                    <p className="text-xs text-[#2B2927] leading-snug">
                      {act.action} <span className="font-semibold">{act.target}</span>
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
