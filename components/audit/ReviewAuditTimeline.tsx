"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCheck,
  FilePlus2,
  History,
  Info,
  MessageSquare,
  ShieldAlert,
  Sparkles,
  User,
} from "lucide-react";
import { ReviewAuditEntry } from "@/lib/audit-history";

interface ReviewAuditTimelineProps {
  entries: ReviewAuditEntry[];
  referenceNow?: Date | null;
}

export function ReviewAuditTimeline({ entries }: ReviewAuditTimelineProps) {
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});

  const toggleDetails = (id: string) => {
    setExpandedDetails((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  if (entries.length === 0) {
    return (
      <div className="p-8 text-center space-y-2 bg-[#FAF8F6] border border-[#E7E1DA] rounded-2xl">
        <History className="w-7 h-7 text-[#8E8780] mx-auto" />
        <p className="text-xs font-semibold text-[#141414]">No audit entries match your filters</p>
        <p className="text-[11px] text-[#6B6560]">
          Adjust the category filter or search keywords to view other recorded events.
        </p>
      </div>
    );
  }

  const renderCategoryIcon = (category: ReviewAuditEntry["category"], title: string) => {
    switch (category) {
      case "submission":
        return <FilePlus2 className="w-4 h-4 text-[#1E3A8A]" />;
      case "analysis":
        return <Sparkles className="w-4 h-4 text-[#4A3E7A]" />;
      case "decision":
        return title.toLowerCase().includes("approved") ? (
          <CheckCircle2 className="w-4 h-4 text-[#14532D]" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-[#7F1D1D]" />
        );
      case "correction":
        return <FileCheck className="w-4 h-4 text-[#744210]" />;
      case "comment":
        return <MessageSquare className="w-4 h-4 text-[#524E4A]" />;
      case "finding":
      default:
        return <ShieldAlert className="w-4 h-4 text-[#7C2D12]" />;
    }
  };

  const getCategoryStyles = (category: ReviewAuditEntry["category"], title: string) => {
    switch (category) {
      case "submission":
        return {
          cardBg: "bg-[#DDF0FA]/50 hover:bg-[#DDF0FA]/70",
          border: "border-[#CBE2EF]",
          badgeBg: "bg-[#DDF0FA]",
          badgeText: "text-[#1E3A8A]",
        };
      case "analysis":
        return {
          cardBg: "bg-[#E2DBFB]/50 hover:bg-[#E2DBFB]/70",
          border: "border-[#D3CAEE]",
          badgeBg: "bg-[#E2DBFB]",
          badgeText: "text-[#4A3E7A]",
        };
      case "decision":
        return title.toLowerCase().includes("approved")
          ? {
              cardBg: "bg-[#CDEEE0]/50 hover:bg-[#CDEEE0]/70",
              border: "border-[#BAE0D0]",
              badgeBg: "bg-[#CDEEE0]",
              badgeText: "text-[#14532D]",
            }
          : {
              cardBg: "bg-[#F6D5DA]/50 hover:bg-[#F6D5DA]/70",
              border: "border-[#EBC3CA]",
              badgeBg: "bg-[#F6D5DA]",
              badgeText: "text-[#7F1D1D]",
            };
      case "correction":
        return {
          cardBg: "bg-[#FAF0C8]/50 hover:bg-[#FAF0C8]/70",
          border: "border-[#EEDF98]",
          badgeBg: "bg-[#FAF0C8]",
          badgeText: "text-[#744210]",
        };
      case "comment":
        return {
          cardBg: "bg-white hover:bg-[#FAF8F6]",
          border: "border-[#E7E1DA]",
          badgeBg: "bg-[#F3EDE8]",
          badgeText: "text-[#524E4A]",
        };
      case "finding":
      default:
        return {
          cardBg: "bg-[#F9DEC0]/50 hover:bg-[#F9DEC0]/70",
          border: "border-[#EDD0AF]",
          badgeBg: "bg-[#F9DEC0]",
          badgeText: "text-[#7C2D12]",
        };
    }
  };

  return (
    <div className="space-y-3 relative before:absolute before:left-5 before:top-3 before:bottom-3 before:w-px before:bg-[#E7E1DA]">
      {entries.map((entry) => {
        const styles = getCategoryStyles(entry.category, entry.title);
        const isExpanded = expandedDetails[entry.id] ?? false;
        const hasDetails = Boolean(
          entry.details?.commentText ||
            entry.details?.correctionText ||
            entry.details?.reviewerNote ||
            entry.details?.detectedValue ||
            entry.details?.expectedValue ||
            entry.details?.analysisRunId ||
            entry.details?.previousValueNotice,
        );

        return (
          <div
            key={entry.id}
            className={`relative ml-10 p-4 rounded-2xl border transition-all ${styles.cardBg} ${styles.border}`}
          >
            {/* Timeline node icon */}
            <div className="absolute -left-10 top-3.5 w-6 h-6 rounded-full bg-white border border-[#E7E1DA] flex items-center justify-center shadow-2xs">
              {renderCategoryIcon(entry.category, entry.title)}
            </div>

            {/* Header row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${styles.badgeBg} ${styles.badgeText}`}
                >
                  {entry.category}
                </span>

                <h3 className="text-xs font-bold text-[#141414]">{entry.title}</h3>

                {/* Verified Recorded vs Snapshot Badge */}
                {entry.isRecordedEvent ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-[#14532D]/10 text-[#14532D] px-2 py-0.5 rounded-full">
                    Verified Log
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-black/5 text-[#6B6560] px-2 py-0.5 rounded-full">
                    Current Snapshot
                  </span>
                )}
              </div>

              {/* Timestamp */}
              <span className="text-[11px] font-mono text-[#6B6560] tabular-nums whitespace-nowrap">
                {entry.displayTime}
              </span>
            </div>

            {/* Action & Actor */}
            <p className="text-xs text-[#2B2927] leading-relaxed mb-1.5">
              <span className="font-semibold text-[#141414] inline-flex items-center gap-1">
                <User className="w-3 h-3 text-[#6B6560] inline" />
                {entry.actor}
              </span>{" "}
              {entry.actorRole && (
                <span className="text-[11px] text-[#6B6560] font-normal">
                  ({entry.actorRole}){" "}
                </span>
              )}
              {entry.action}
            </p>

            {/* Previous value notice (strict data accuracy requirement) */}
            {entry.details?.previousValueNotice && (
              <div className="flex items-center gap-1.5 text-[11px] text-[#6B6560] bg-white/75 border border-black/5 rounded-lg px-2.5 py-1 mt-2">
                <Info className="w-3.5 h-3.5 text-[#8E8780] shrink-0" />
                <span className="italic">{entry.details.previousValueNotice}</span>
              </div>
            )}

            {/* Collapsible details toggle */}
            {hasDetails && (
              <div className="mt-2.5 pt-2 border-t border-black/5">
                <button
                  type="button"
                  onClick={() => toggleDetails(entry.id)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#141414] hover:underline"
                >
                  {isExpanded ? (
                    <>
                      <span>Hide recorded details</span>
                      <ChevronUp className="w-3 h-3" />
                    </>
                  ) : (
                    <>
                      <span>View recorded details</span>
                      <ChevronDown className="w-3 h-3" />
                    </>
                  )}
                </button>

                {isExpanded && (
                  <div className="mt-2.5 space-y-2 bg-white/90 border border-black/10 rounded-xl p-3 text-xs text-[#2B2927]">
                    {entry.details?.commentText && (
                      <div>
                        <span className="font-semibold text-[#6B6560] block text-[11px]">
                          Comment:
                        </span>
                        <p className="bg-[#FAF8F6] p-2 rounded-lg mt-0.5 border border-[#E7E1DA]">
                          &ldquo;{entry.details.commentText}&rdquo;
                        </p>
                      </div>
                    )}

                    {entry.details?.correctionText && (
                      <div className="space-y-1">
                        <span className="font-semibold text-[#6B6560] block text-[11px]">
                          Applied Replacement Copy:
                        </span>
                        <p className="bg-[#FAF8F6] p-2 rounded-lg border border-[#E7E1DA] font-mono text-[11px]">
                          {entry.details.correctionText}
                        </p>
                        {entry.details?.detectedValue && (
                          <p className="text-[11px] text-[#6B6560]">
                            Replaced: &ldquo;{entry.details.detectedValue}&rdquo;
                          </p>
                        )}
                      </div>
                    )}

                    {entry.details?.reviewerNote && (
                      <div>
                        <span className="font-semibold text-[#6B6560] block text-[11px]">
                          Decision Summary Note:
                        </span>
                        <p className="bg-[#FAF8F6] p-2 rounded-lg mt-0.5 border border-[#E7E1DA]">
                          &ldquo;{entry.details.reviewerNote}&rdquo;
                        </p>
                      </div>
                    )}

                    {entry.details?.analysisRunId && (
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-[#6B6560]">Run ID:</span>{" "}
                          <span className="font-mono text-[#141414]">
                            {entry.details.analysisRunId}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#6B6560]">Provider:</span>{" "}
                          <span className="font-semibold text-[#141414]">
                            {entry.details.providerUsed || "Unknown"}
                          </span>
                        </div>
                        {entry.details?.complianceScore !== undefined && (
                          <div>
                            <span className="text-[#6B6560]">Compliance Score:</span>{" "}
                            <span className="font-mono font-bold text-[#141414]">
                              {entry.details.complianceScore}%
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
