"use client";

import React from "react";
import {
  FileText,
  Building2,
  Calendar,
  User,
  AlertTriangle,
  CheckCircle2,
  Check,
  Cpu,
  History,
} from "lucide-react";
import { ReviewSubmission, ReviewFinding, ActivityEvent } from "@/lib/types";
import { buildReviewAuditTrail } from "@/lib/audit-history";
import {
  REVIEW_STATUS_META,
  SEVERITY_LABEL,
  EVIDENCE_STYLE,
} from "@/components/ThemeTokens";

interface ReviewDossierReportViewProps {
  review: ReviewSubmission;
  activities?: ActivityEvent[];
  referenceNow?: Date | null;
}

export function ReviewDossierReportView({
  review,
  activities = [],
  referenceNow,
}: ReviewDossierReportViewProps) {
  const statusMeta = REVIEW_STATUS_META[review.status] || {
    label: review.status,
    dotColor: "text-gray-500",
    textColor: "text-gray-800",
  };
  const statusBadgeStyle =
    review.status === "Approved"
      ? "bg-[#CDEEE0] text-[#14532D]"
      : review.status === "Changes Requested"
      ? "bg-[#F6D5DA] text-[#7F1D1D]"
      : "bg-[#F9DEC0] text-[#78350F]";

  // Build audit trail appendix
  const auditEntries = buildReviewAuditTrail(review, activities, referenceNow);

  // Group findings into unresolved vs resolved
  const openFindings = review.findings?.filter((f) => !f.resolved) || [];
  const resolvedFindings = review.findings?.filter((f) => f.resolved) || [];

  return (
    <div className="space-y-8">
      {/* Dossier Header Card */}
      <div className="bg-white border border-[#E7E1DA] rounded-2xl p-6 shadow-sm break-inside-avoid">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E7E1DA] pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-mono text-xs px-2.5 py-0.5 rounded-md bg-[#FAF8F6] border border-[#E7E1DA] text-[#736B63]">
                {review.id}
              </span>
              <span className={`px-2.5 py-0.5 rounded-md text-xs font-semibold ${statusBadgeStyle}`}>
                {statusMeta.label}
              </span>
              <span className="px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#FAF8F6] text-[#5A5550]">
                {review.contentType}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#141414] font-display">
              {review.title}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-[#736B63] font-medium">Compliance Score</div>
              <div
                className={`text-3xl font-extrabold font-display tabular-nums ${
                  review.complianceScore < 70
                    ? "text-[#9C2740]"
                    : review.complianceScore < 85
                    ? "text-[#B45309]"
                    : "text-[#15803D]"
                }`}
              >
                {review.complianceScore}%
              </div>
            </div>
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 text-xs">
          <div>
            <div className="text-[#8C827A] flex items-center gap-1.5 mb-1">
              <Building2 className="w-3.5 h-3.5" />
              <span>Brand Collection</span>
            </div>
            <div className="font-semibold text-[#141414]">{review.guidelineCollection}</div>
          </div>

          <div>
            <div className="text-[#8C827A] flex items-center gap-1.5 mb-1">
              <User className="w-3.5 h-3.5" />
              <span>Submitted By</span>
            </div>
            <div className="font-semibold text-[#141414]">{review.submittedBy}</div>
          </div>

          <div>
            <div className="text-[#8C827A] flex items-center gap-1.5 mb-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>Submitted At</span>
            </div>
            <div className="font-semibold text-[#141414]">{review.submittedAt}</div>
          </div>

          <div>
            <div className="text-[#8C827A] flex items-center gap-1.5 mb-1">
              <Cpu className="w-3.5 h-3.5" />
              <span>AI Analysis Engine</span>
            </div>
            <div className="font-semibold text-[#141414]">
              {review.providerUsed || "Gemini 2.5 Flash"}
              {review.analysisStatus && (
                <span className="ml-1.5 text-[10px] text-[#8C827A] font-normal">
                  ({review.analysisStatus})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Reviewer Notes if available */}
        {review.reviewerNotes && (
          <div className="mt-5 p-3.5 rounded-xl bg-[#FAF8F6] border border-[#E7E1DA] text-xs">
            <span className="font-semibold text-[#141414] block mb-1">Reviewer Decision Notes:</span>
            <p className="text-[#5A5550] leading-relaxed">{review.reviewerNotes}</p>
          </div>
        )}
      </div>

      {/* Submitted Creative Content Preview */}
      <div className="bg-white border border-[#E7E1DA] rounded-2xl p-6 shadow-sm break-inside-avoid">
        <h3 className="text-sm font-bold text-[#141414] font-display mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#8C827A]" />
          Submitted Creative Content
        </h3>
        <div className="p-4 rounded-xl bg-[#FAF8F6] border border-[#E7E1DA] text-xs font-mono text-[#332F2B] whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
          {review.textContent}
        </div>
        {review.assetName && (
          <div className="mt-3 text-xs text-[#736B63] flex items-center gap-1.5">
            <span className="font-semibold">Associated Visual Asset:</span>
            <span>{review.assetName}</span>
          </div>
        )}
      </div>

      {/* Findings Inventory: Open Violations */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-[#141414] font-display flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-[#B45309]" />
            Open Compliance Findings ({openFindings.length})
          </h3>
          <span className="text-xs text-[#736B63]">
            {openFindings.filter((f) => f.severity === "high").length} high severity requiring remediation
          </span>
        </div>

        {openFindings.length === 0 ? (
          <div className="bg-white border border-[#E7E1DA] rounded-2xl p-6 text-center text-xs text-[#15803D] shadow-sm flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Zero open violations. Creative is fully compliant with brand guidelines.</span>
          </div>
        ) : (
          <div className="space-y-3">
            {openFindings.map((finding) => (
              <FindingDetailCard key={finding.id} finding={finding} />
            ))}
          </div>
        )}
      </div>

      {/* Findings Inventory: Resolved Findings */}
      {resolvedFindings.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-[#141414] font-display flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-[#15803D]" />
            Resolved Findings ({resolvedFindings.length})
          </h3>
          <div className="space-y-3">
            {resolvedFindings.map((finding) => (
              <FindingDetailCard key={finding.id} finding={finding} isResolved />
            ))}
          </div>
        </div>
      )}

      {/* Audit History Appendix */}
      <div className="bg-white border border-[#E7E1DA] rounded-2xl p-6 shadow-sm break-inside-avoid">
        <h3 className="text-sm font-bold text-[#141414] font-display mb-4 flex items-center gap-2">
          <History className="w-4 h-4 text-[#8C827A]" />
          Review Lifecycle & Decision Audit Appendix
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#E7E1DA] text-[#736B63] font-semibold">
                <th className="py-2 px-3">Timestamp</th>
                <th className="py-2 px-3">Category</th>
                <th className="py-2 px-3">Action</th>
                <th className="py-2 px-3">Actor</th>
                <th className="py-2 px-3">Provenance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E7E1DA]/60">
              {auditEntries.map((entry) => (
                <tr key={entry.id} className="hover:bg-[#FAF8F6]/60">
                  <td className="py-2.5 px-3 font-mono text-[11px] text-[#8C827A] whitespace-nowrap">
                    {entry.timestamp}
                  </td>
                  <td className="py-2.5 px-3 font-medium capitalize text-[#141414]">
                    {entry.category}
                  </td>
                  <td className="py-2.5 px-3 text-[#141414] font-medium">{entry.action}</td>
                  <td className="py-2.5 px-3 text-[#5A5550]">
                    {entry.actor}
                    {entry.actorRole && (
                      <span className="text-[10px] text-[#8C827A] ml-1">({entry.actorRole})</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
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
      </div>
    </div>
  );
}

/**
 * Finding card for Dossier view
 */
function FindingDetailCard({
  finding,
  isResolved = false,
}: {
  finding: ReviewFinding;
  isResolved?: boolean;
}) {
  const sevLabel = SEVERITY_LABEL[finding.severity] || finding.severity;
  const sevBadgeClass =
    finding.severity === "high"
      ? "bg-[#F6D5DA] text-[#9C2740]"
      : finding.severity === "medium"
      ? "bg-[#F9DEC0] text-[#B45309]"
      : "bg-[#DDF0FA] text-[#2563EB]";

  const evStyle = EVIDENCE_STYLE[finding.evidenceStatus] || {
    label: finding.evidenceStatus,
    cardBg: "bg-gray-100",
    cardBorder: "border-gray-300",
    textClass: "text-gray-800",
  };

  return (
    <div
      className={`bg-white border rounded-2xl p-5 shadow-sm break-inside-avoid ${
        isResolved ? "border-[#CDEEE0]/80 bg-[#FAF8F6]/40" : "border-[#E7E1DA]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider ${sevBadgeClass}`}>
            {sevLabel}
          </span>
          <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium border ${evStyle.cardBg} ${evStyle.textClass} ${evStyle.cardBorder}`}>
            {evStyle.label}
          </span>
          <span className="text-xs font-semibold text-[#736B63]">
            {finding.category}
          </span>
          <span className="font-mono text-[11px] text-[#8C827A]">({finding.id})</span>
        </div>

        {isResolved && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#CDEEE0] text-[#14532D]">
            <Check className="w-3.5 h-3.5" />
            <span>Resolved</span>
            {finding.resolvedAt && (
              <span className="font-normal text-[10px] ml-1">at {finding.resolvedAt}</span>
            )}
          </span>
        )}
      </div>

      <h4 className="text-sm font-bold text-[#141414] font-display mb-1.5">
        {finding.title}
      </h4>
      <p className="text-xs text-[#5A5550] leading-relaxed mb-4">
        {finding.description}
      </p>

      {/* Values & Citations Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#FAF8F6] border border-[#E7E1DA] text-xs">
        <div>
          <span className="text-[#8C827A] text-[11px] block font-medium mb-0.5">Detected Value:</span>
          <span className="font-mono font-semibold text-[#9C2740] bg-[#F6D5DA]/30 px-1.5 py-0.5 rounded">
            {finding.detectedValue || "(None)"}
          </span>
        </div>
        <div>
          <span className="text-[#8C827A] text-[11px] block font-medium mb-0.5">Expected / Required:</span>
          <span className="font-mono font-semibold text-[#15803D] bg-[#CDEEE0]/30 px-1.5 py-0.5 rounded">
            {finding.expectedValue || "(None)"}
          </span>
        </div>
      </div>

      {/* Guideline Citation Reference */}
      {finding.sourceReference && (
        <div className="mt-3 text-xs text-[#736B63] flex items-center gap-1.5">
          <span className="font-semibold text-[#141414]">Guideline Citation:</span>
          <span className="italic">{finding.sourceReference}</span>
        </div>
      )}

      {/* Applied Correction if resolved */}
      {finding.editedCorrection && (
        <div className="mt-3 p-3 rounded-lg bg-[#CDEEE0]/20 border border-[#CDEEE0] text-xs">
          <span className="font-semibold text-[#14532D] block mb-0.5">Applied Copy Correction:</span>
          <span className="text-[#141414] font-medium">{finding.editedCorrection}</span>
        </div>
      )}
    </div>
  );
}
