"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  HelpCircle,
  History,
  MessageSquare,
  Search,
  Send,
  XCircle,
} from "lucide-react";
import { ReviewAuditDrawer } from "@/components/audit/ReviewAuditDrawer";
import { useIdentiq } from "@/components/IdentiqProvider";
import { EVIDENCE_STYLE, REVIEW_STATUS_META } from "@/components/ThemeTokens";
import { ReviewStatus } from "@/lib/types";

const STATUS_TABS: Array<"All" | ReviewStatus> = [
  "All",
  "Pending Approval",
  "In Review",
  "Changes Requested",
  "Approved",
];

export default function ApprovalsPage() {
  const {
    reviews,
    toggleFindingResolved,
    updateFindingCorrection,
    addFindingComment,
    updateReviewStatus,
  } = useIdentiq();

  const [statusFilter, setStatusFilter] = useState<"All" | ReviewStatus>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedReviewId, setSelectedReviewId] = useState<string>(reviews[0]?.id || "");
  const [reviewerNote, setReviewerNote] = useState("");
  const [inlineEdits, setInlineEdits] = useState<Record<string, string>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [auditOpen, setAuditOpen] = useState(false);

  const filteredReviews = useMemo(() => {
    return reviews.filter((r) => {
      const statusMatch = statusFilter === "All" || r.status === statusFilter;
      const q = searchQuery.trim().toLowerCase();
      const searchMatch =
        !q ||
        r.title.toLowerCase().includes(q) ||
        r.submittedBy.toLowerCase().includes(q) ||
        r.guidelineCollection.toLowerCase().includes(q);
      return statusMatch && searchMatch;
    });
  }, [reviews, statusFilter, searchQuery]);

  const activeReview = useMemo(() => {
    return (
      filteredReviews.find((r) => r.id === selectedReviewId) ||
      filteredReviews[0] ||
      reviews[0]
    );
  }, [filteredReviews, selectedReviewId, reviews]);

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#6B6560] mb-1">
            Corrections & Final Sign-Off Queue
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">
            Approvals
          </h1>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-[#6B6560] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter approval queue..."
            className="w-full pl-9 pr-3 py-2 rounded-full bg-white border border-[#E7E1DA] text-xs text-[#141414] focus:outline-none focus:border-[#141414]"
          />
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => {
          const active = statusFilter === tab;
          const count =
            tab === "All"
              ? reviews.length
              : reviews.filter((r) => r.status === tab).length;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-4 py-2 rounded-full text-xs font-medium border transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                active
                  ? "bg-[#141414] text-white border-[#141414]"
                  : "bg-white text-[#3F3B37] border-[#E7E1DA] hover:bg-[#F3EDE8]"
              }`}
            >
              {tab} ({count})
            </button>
          );
        })}
      </div>

      {filteredReviews.length === 0 || !activeReview ? (
        <div className="bg-white border border-[#E7E1DA] rounded-[24px] p-10 text-center">
          <p className="text-sm font-semibold text-[#141414]">No submissions in this queue</p>
          <button
            type="button"
            onClick={() => {
              setStatusFilter("All");
              setSearchQuery("");
            }}
            className="mt-3 px-4 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold"
          >
            Show All Submissions
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Queue List */}
          <div className="lg:col-span-4 space-y-3">
            {filteredReviews.map((rev) => {
              const isSelected = activeReview.id === rev.id;
              const openIssues = rev.findings.filter((f) => !f.resolved).length;
              const statusMeta = REVIEW_STATUS_META[rev.status];
              return (
                <button
                  key={rev.id}
                  type="button"
                  onClick={() => setSelectedReviewId(rev.id)}
                  className={`w-full text-left rounded-[22px] p-4 border transition-all ${
                    isSelected
                      ? "bg-white border-[#141414] ring-1 ring-[#141414]"
                      : "bg-[#F3EDE8]/65 border-[#E7E1DA] hover:bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs mb-1">
                    <span className={`font-semibold ${statusMeta.textColor}`}>
                      {statusMeta.label}
                    </span>
                    <span className="font-mono tabular-nums text-[#524E4A]">
                      {rev.complianceScore}%
                    </span>
                  </div>
                  <h2 className="text-sm font-bold text-[#141414] mb-1">{rev.title}</h2>
                  <p className="text-xs text-[#6B6560] tabular-nums">
                    {rev.submittedBy} · {openIssues} open {openIssues === 1 ? "finding" : "findings"}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Right Decision & Corrections Workspace */}
          <div className="lg:col-span-8 bg-white border border-[#E7E1DA] rounded-[26px] p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-[#EFECE7]">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B6560] mb-1">
                  <span>{activeReview.contentType}</span>
                  <span>·</span>
                  <span>{activeReview.guidelineCollection}</span>
                  <span>·</span>
                  <span className="font-semibold text-[#141414]">
                    {activeReview.complianceScore}% Compliance
                  </span>
                </div>
                <h2 className="text-xl font-bold text-[#141414]">{activeReview.title}</h2>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setAuditOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[#E7E1DA] text-xs font-semibold text-[#141414] hover:bg-[#FAF8F6] whitespace-nowrap shadow-2xs transition-colors"
                >
                  <History className="w-3.5 h-3.5 text-[#524E4A]" />
                  Audit History
                </button>
                <Link
                  href={`/studio?id=${activeReview.id}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-[#E7E1DA] text-xs font-semibold text-[#141414] hover:bg-[#FAF8F6] whitespace-nowrap shrink-0 transition-colors"
                >
                  Open in Review Studio
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            {/* Active Copy Snapshot */}
            <div className="bg-[#FAF8F6] border border-[#E7E1DA] rounded-2xl p-4">
              <p className="text-[11px] font-semibold text-[#6B6560] mb-1">Current Copy</p>
              <p className="text-sm text-[#141414] leading-relaxed">{activeReview.textContent}</p>
            </div>

            {/* Findings & Inline Corrections */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-[#141414]">
                Detected Issues & Recommended Corrections ({activeReview.findings.length})
              </h3>

              {activeReview.findings.map((finding) => {
                const ev = EVIDENCE_STYLE[finding.evidenceStatus];
                const draftVal =
                  inlineEdits[finding.id] ??
                  finding.editedCorrection ??
                  finding.expectedValue;
                const cmtVal = commentInputs[finding.id] ?? "";

                return (
                  <div
                    key={finding.id}
                    className={`border rounded-2xl p-4 space-y-3 ${
                      finding.resolved
                        ? "bg-[#FAF8F6] border-[#E7E1DA]"
                        : `${ev.cardBg} ${ev.cardBorder}`
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold">
                        {finding.evidenceStatus === "supported" ? (
                          <CheckCircle2 className="w-4 h-4 text-[#14532D]" />
                        ) : finding.evidenceStatus === "conflicting" ? (
                          <AlertTriangle className="w-4 h-4 text-[#842029]" />
                        ) : (
                          <HelpCircle className="w-4 h-4 text-[#664D03]" />
                        )}
                        <span className="text-[#141414]">{finding.title}</span>
                        <span className="text-[#6B6560] font-normal">({finding.category})</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleFindingResolved(activeReview.id, finding.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                          finding.resolved
                            ? "bg-[#CDEEE0] text-[#14532D]"
                            : "bg-[#141414] text-white"
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        {finding.resolved ? "Resolved" : "Mark Resolved"}
                      </button>
                    </div>

                    <p className="text-xs text-[#3F3B37]">{finding.description}</p>
                    <p className="text-[11px] font-medium text-[#524E4A]">
                      Source: {finding.sourceReference}
                    </p>

                    <div className="bg-white/90 border border-black/10 rounded-xl p-3 space-y-2">
                      <label className="block text-[11px] font-semibold text-[#3F3B37]">
                        Edit / Accept Suggested Replacement
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={draftVal}
                          onChange={(e) =>
                            setInlineEdits((prev) => ({
                              ...prev,
                              [finding.id]: e.target.value,
                            }))
                          }
                          className="flex-1 px-3 py-1.5 rounded-lg border border-[#E7E1DA] text-xs text-[#141414]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateFindingCorrection(
                              activeReview.id,
                              finding.id,
                              draftVal,
                              true
                            )
                          }
                          className="px-3.5 py-1.5 rounded-lg bg-[#141414] text-white text-xs font-semibold whitespace-nowrap"
                        >
                          Accept & Apply
                        </button>
                      </div>
                    </div>

                    {/* Comment input */}
                    <div className="space-y-2">
                      {finding.comments.length > 0 && (
                        <div className="space-y-1">
                          {finding.comments.map((c) => (
                            <p
                              key={c.id}
                              className="text-xs text-[#2B2927] bg-white/75 px-3 py-1.5 rounded-lg"
                            >
                              <span className="font-semibold">{c.author}:</span> {c.text}
                            </p>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-3.5 h-3.5 text-[#524E4A] shrink-0" />
                        <input
                          type="text"
                          value={cmtVal}
                          onChange={(e) =>
                            setCommentInputs((prev) => ({
                              ...prev,
                              [finding.id]: e.target.value,
                            }))
                          }
                          placeholder="Add reviewer comment on this issue..."
                          className="flex-1 px-3 py-1.5 rounded-full bg-white/90 border border-black/10 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!cmtVal.trim()) return;
                            addFindingComment(activeReview.id, finding.id, cmtVal);
                            setCommentInputs((prev) => ({ ...prev, [finding.id]: "" }));
                          }}
                          aria-label="Post comment"
                          className="p-1.5 rounded-full bg-[#141414] text-white"
                        >
                          <Send className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Final Reviewer Sign-Off Footer */}
            <div className="pt-5 border-t border-[#EFECE7] space-y-3">
              <label
                htmlFor="signoff-note"
                className="block text-xs font-semibold text-[#141414]"
              >
                Decision Summary Note
              </label>
              <input
                id="signoff-note"
                type="text"
                value={reviewerNote}
                onChange={(e) => setReviewerNote(e.target.value)}
                placeholder="Optional note for submitter or audit trail..."
                className="w-full px-4 py-2.5 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-xs text-[#141414]"
              />
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    updateReviewStatus(activeReview.id, "Changes Requested", reviewerNote);
                    setReviewerNote("");
                  }}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-[#F6D5DA] text-[#7F1D1D] hover:brightness-95 text-xs font-semibold transition-all"
                >
                  <XCircle className="w-4 h-4" />
                  Request Changes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateReviewStatus(activeReview.id, "Approved", reviewerNote);
                    setReviewerNote("");
                  }}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-[#141414] text-white hover:bg-[#2B2B2B] text-xs font-semibold transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#CDEEE0]" />
                  Approve Content
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Review-Level Audit History Drawer */}
      <ReviewAuditDrawer
        review={activeReview}
        isOpen={auditOpen}
        onClose={() => setAuditOpen(false)}
      />
    </div>
  );
}
