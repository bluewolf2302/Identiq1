"use client";

import React from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  FileCheck,
  FilePlus2,
  History,
  MessageSquare,
  ShieldAlert,
  Upload,
} from "lucide-react";
import {
  ACTIVITY_EVENT_META,
  getActivityTimeInfo,
} from "@/lib/activity-timeline";
import { ActivityEvent, ReviewSubmission } from "@/lib/types";

interface ActivityTimelineCardProps {
  event: ActivityEvent;
  review?: ReviewSubmission;
  referenceNow?: Date | null;
  onOpenReview?: (reviewId: string) => void;
}

export function ActivityTimelineCard({
  event,
  review,
  referenceNow,
  onOpenReview,
}: ActivityTimelineCardProps) {
  const meta = ACTIVITY_EVENT_META[event.type];
  const timeInfo = getActivityTimeInfo(event.timestamp, referenceNow);

  const renderIcon = () => {
    switch (event.type) {
      case "approved":
        return <CheckCircle2 className="w-4 h-4 text-[#14532D]" />;
      case "submitted":
        return <FilePlus2 className="w-4 h-4 text-[#1E3A8A]" />;
      case "changes_requested":
        return <ShieldAlert className="w-4 h-4 text-[#7F1D1D]" />;
      case "resolved":
        return <Check className="w-4 h-4 text-[#14532D]" />;
      case "knowledge_updated":
        return <BookOpen className="w-4 h-4 text-[#4A3E7A]" />;
      case "asset_uploaded":
        return <Upload className="w-4 h-4 text-[#7C2D12]" />;
      case "correction_applied":
        return <FileCheck className="w-4 h-4 text-[#744210]" />;
      case "comment_added":
        return <MessageSquare className="w-4 h-4 text-[#524E4A]" />;
      case "manual_finding_added":
        return <ShieldAlert className="w-4 h-4 text-[#7C2D12]" />;
      default:
        return <Clock className="w-4 h-4 text-[#524E4A]" />;
    }
  };

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl ${meta.bgClass} border ${meta.borderClass} transition-all hover:brightness-[0.985]`}
    >
      <div className="flex items-start gap-3 min-w-0">
        {/* Type Icon */}
        <span className="w-9 h-9 rounded-full bg-white border border-black/10 flex items-center justify-center shrink-0 shadow-2xs">
          {renderIcon()}
        </span>

        {/* Event Content */}
        <div className="space-y-1 text-xs min-w-0">
          {/* Top Line: Actor, Event Type Badge, and Timestamp */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-[#141414]">{event.actor}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.badgeBg} ${meta.textClass} border border-black/5`}
            >
              {meta.label}
            </span>

            {/* Timestamp Badge */}
            <span
              className="inline-flex items-center gap-1 text-[11px] text-[#6B6560] tabular-nums"
              title={timeInfo.absolute || "Legacy unstandardized record"}
            >
              <Clock className="w-3 h-3 text-[#8E8780]" />
              {timeInfo.display}
            </span>

            {/* Legacy Badge if unstandardized */}
            {timeInfo.isLegacy && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md bg-black/5 text-[10px] font-medium text-[#6B6560]"
                title="This historical record has no precise ISO 8601 timestamp"
              >
                <History className="w-2.5 h-2.5" />
                Legacy seed record
              </span>
            )}
          </div>

          {/* Action and Target */}
          <p className="text-[#2B2927] leading-relaxed">
            {event.action} <span className="font-semibold text-[#141414]">{event.target}</span>
          </p>

          {/* Associated Review Context (if available) */}
          {review && (
            <p className="text-[11px] text-[#524E4A] truncate">
              Review: <span className="font-medium text-[#141414]">{review.title}</span> ·{" "}
              <span>{review.guidelineCollection}</span> ({review.complianceScore}% score)
            </p>
          )}
        </div>
      </div>

      {/* Review Studio Deep-Link Action (Only rendered when reviewId exists) */}
      {event.reviewId && onOpenReview && (
        <button
          type="button"
          onClick={() => onOpenReview(event.reviewId!)}
          className="inline-flex items-center justify-center gap-1 px-3.5 py-1.5 rounded-full bg-white border border-[#E7E1DA] hover:border-[#141414] hover:bg-[#FAF8F6] text-xs font-semibold text-[#141414] transition-all self-start sm:self-center shrink-0 shadow-2xs whitespace-nowrap"
        >
          <span>Open Review</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
