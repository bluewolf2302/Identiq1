import { ActivityEvent, ReviewSubmission } from "./types";
import {
  formatActivityTimestamp,
  parseActivityDate,
} from "./activity-timeline";

export type ReviewAuditCategory =
  | "all"
  | "submission"
  | "analysis"
  | "decision"
  | "finding"
  | "correction"
  | "comment";

export interface ReviewAuditEntry {
  id: string;
  reviewId: string;
  category: "submission" | "analysis" | "decision" | "finding" | "correction" | "comment";
  title: string;
  action: string;
  actor: string;
  actorRole?: string;
  timestamp: string;
  displayTime: string;
  isRecordedEvent: boolean; // True if genuinely captured in ActivityEvent
  isSnapshot: boolean;      // True if synthesized from current state snapshot
  statusLabel?: string;
  badgeClass?: string;
  details?: {
    findingId?: string;
    findingTitle?: string;
    findingCategory?: string;
    severity?: string;
    evidenceStatus?: string;
    detectedValue?: string;
    expectedValue?: string;
    correctionText?: string;
    commentText?: string;
    reviewerNote?: string;
    complianceScore?: number;
    analysisRunId?: string;
    providerUsed?: string;
    analysisStatus?: string;
    affectedContent?: string;
    historicalValueAvailable: boolean; // Explicit flag distinguishing recorded vs unavailable history
    previousValueNotice?: string;      // e.g. "Previous version not recorded"
  };
}

export interface ReviewAuditSummary {
  totalEntries: number;
  recordedEventsCount: number;
  decisionsCount: number;
  findingsCount: number;
  correctionsCount: number;
  commentsCount: number;
  hasAnalysisRun: boolean;
}

/**
 * Builds a comprehensive, review-level audit trail.
 * Combines genuinely recorded ActivityEvents with current review state snapshots,
 * while strictly distinguishing verified recorded events from unavailable historical values.
 */
export function buildReviewAuditTrail(
  review?: ReviewSubmission | null,
  activities: ActivityEvent[] = [],
  referenceNow?: Date | null,
): ReviewAuditEntry[] {
  if (!review || !review.id) {
    return [];
  }

  const entries: ReviewAuditEntry[] = [];
  const reviewActivities = activities.filter((act) => act.reviewId === review.id);

  // 1. Creative Submission Event
  const recordedSubmissionAct = reviewActivities.find((act) => act.type === "submitted");
  const submissionTimestamp = recordedSubmissionAct?.timestamp || review.submittedAt || "";
  const submissionActor = recordedSubmissionAct?.actor || review.submittedBy || "Unknown Submitter";

  entries.push({
    id: recordedSubmissionAct?.id || `sub-${review.id}`,
    reviewId: review.id,
    category: "submission",
    title: "Creative Content Submitted",
    action: recordedSubmissionAct
      ? recordedSubmissionAct.action
      : "submitted content for governance review:",
    actor: submissionActor,
    actorRole: "Content Submitter",
    timestamp: submissionTimestamp,
    displayTime: formatActivityTimestamp(submissionTimestamp, referenceNow),
    isRecordedEvent: Boolean(recordedSubmissionAct),
    isSnapshot: !recordedSubmissionAct,
    statusLabel: review.status,
    details: {
      complianceScore: review.complianceScore,
      historicalValueAvailable: true,
      previousValueNotice: "Initial submission baseline (Version 1.0)",
    },
  });

  // 2. Automated AI / Deterministic Analysis Run (if information is present)
  if (review.analysisRunId || review.providerUsed) {
    entries.push({
      id: `analysis-${review.analysisRunId || review.id}`,
      reviewId: review.id,
      category: "analysis",
      title: "Automated Compliance Analysis",
      action: `executed multimodal governance scan using ${review.providerUsed || "AI engine"}`,
      actor: review.providerUsed ? `AI Engine (${review.providerUsed})` : "Compliance Orchestrator",
      actorRole: "Automated Analysis",
      timestamp: review.submittedAt || "",
      displayTime: formatActivityTimestamp(review.submittedAt, referenceNow),
      isRecordedEvent: Boolean(review.analysisRunId),
      isSnapshot: false,
      statusLabel: review.analysisStatus || "COMPLETED",
      details: {
        analysisRunId: review.analysisRunId,
        providerUsed: review.providerUsed,
        analysisStatus: review.analysisStatus,
        complianceScore: review.complianceScore,
        historicalValueAvailable: false,
        previousValueNotice:
          "Only the latest analysis run metadata is retained; intermediate runs or raw prompt iterations are not recorded.",
      },
    });
  }

  // 3. Genuine ActivityEvent records linked to this review
  for (const act of reviewActivities) {
    // Skip the submission event since we already handled it above
    if (act.type === "submitted") continue;

    let category: ReviewAuditEntry["category"] = "finding";
    let title = "Governance Action";
    let reviewerNote: string | undefined;

    const actionLower = act.action.toLowerCase();

    if (act.type === "approved") {
      category = "decision";
      title = "Content Approved";
      reviewerNote = review.reviewerNotes;
    } else if (act.type === "changes_requested") {
      if (actionLower.includes("comment")) {
        category = "comment";
        title = "Reviewer Finding Comment";
      } else if (actionLower.includes("manual")) {
        category = "finding";
        title = "Manual Finding Added";
      } else {
        category = "decision";
        title = "Changes Requested";
        reviewerNote = review.reviewerNotes;
      }
    } else if (act.type === "resolved") {
      if (actionLower.includes("correction")) {
        category = "correction";
        title = "Finding Correction Recorded";
      } else if (actionLower.includes("reopened")) {
        category = "finding";
        title = "Finding Reopened";
      } else {
        category = "finding";
        title = "Finding Resolved";
      }
    } else if (act.type === "correction_applied") {
      category = "correction";
      title = "Finding Correction Recorded";
    } else if (act.type === "comment_added") {
      category = "comment";
      title = "Reviewer Finding Comment";
    } else if (act.type === "manual_finding_added") {
      category = "finding";
      title = "Manual Finding Added";
    }

    entries.push({
      id: act.id,
      reviewId: review.id,
      category,
      title,
      action: act.action,
      actor: act.actor,
      timestamp: act.timestamp,
      displayTime: formatActivityTimestamp(act.timestamp, referenceNow),
      isRecordedEvent: true,
      isSnapshot: false,
      details: {
        reviewerNote,
        historicalValueAvailable: true,
      },
    });
  }

  // 4. Threaded Finding Comments (from review.findings)
  if (Array.isArray(review.findings)) {
    for (const finding of review.findings) {
      if (!Array.isArray(finding.comments)) continue;

      for (const cmt of finding.comments) {
        // Prevent duplicate if an activity event already exists for this comment
        const matchingRecordedCmt = entries.find(
          (e) =>
            e.category === "comment" &&
            (e.id === cmt.id ||
              (e.isRecordedEvent && (e.action.includes(finding.title) || e.actor === cmt.author))),
        );

        if (matchingRecordedCmt) {
          if (matchingRecordedCmt.details) {
            matchingRecordedCmt.details.findingId = finding.id;
            matchingRecordedCmt.details.findingTitle = finding.title;
            matchingRecordedCmt.details.commentText = cmt.text;
          }
        } else {
          entries.push({
            id: cmt.id,
            reviewId: review.id,
            category: "comment",
            title: `Reviewer Comment: ${finding.title}`,
            action: `commented on issue in "${finding.title}"`,
            actor: cmt.author,
            actorRole: cmt.role,
            timestamp: cmt.createdAt,
            displayTime: formatActivityTimestamp(cmt.createdAt, referenceNow),
            isRecordedEvent: false,
            isSnapshot: true,
            details: {
              findingId: finding.id,
              findingTitle: finding.title,
              findingCategory: finding.category,
              commentText: cmt.text,
              historicalValueAvailable: true,
            },
          });
        }
      }

      // 5. Applied Finding Corrections (from review.findings)
      if (finding.editedCorrection) {
        const matchingRecordedCorr = entries.find(
          (e) =>
            e.category === "correction" &&
            (e.details?.findingId === finding.id ||
              (e.isRecordedEvent && e.action.includes(finding.title))),
        );

        if (matchingRecordedCorr) {
          if (matchingRecordedCorr.details) {
            matchingRecordedCorr.details.findingId = finding.id;
            matchingRecordedCorr.details.findingTitle = finding.title;
            matchingRecordedCorr.details.correctionText = finding.editedCorrection;
            matchingRecordedCorr.details.detectedValue = finding.detectedValue;
            matchingRecordedCorr.details.expectedValue = finding.expectedValue;
          }
        } else {
          entries.push({
            id: `corr-${finding.id}`,
            reviewId: review.id,
            category: "correction",
            title: `Correction Applied: ${finding.title}`,
            action: `applied replacement copy for "${finding.title}"`,
            actor: review.submittedBy || "Reviewer",
            timestamp: review.submittedAt || "",
            displayTime: formatActivityTimestamp(review.submittedAt, referenceNow),
            isRecordedEvent: false,
            isSnapshot: true,
            details: {
              findingId: finding.id,
              findingTitle: finding.title,
              findingCategory: finding.category,
              detectedValue: finding.detectedValue,
              expectedValue: finding.expectedValue,
              correctionText: finding.editedCorrection,
              affectedContent: finding.affectedContent,
              historicalValueAvailable: false,
              previousValueNotice:
                "Previous copy text version not recorded (in-place replacement).",
            },
          });
        }
      }

      // 6. Finding Resolution Snapshot (if resolved and not recorded in activities)
      if (finding.resolved) {
        const isRecorded = entries.some(
          (e) =>
            e.category === "finding" &&
            e.title.toLowerCase().includes("resolved") &&
            (e.details?.findingId === finding.id || e.action.includes(finding.title)),
        );

        if (!isRecorded) {
          entries.push({
            id: `res-${finding.id}`,
            reviewId: review.id,
            category: "finding",
            title: `Finding Resolved: ${finding.title}`,
            action: `marked finding as resolved in "${review.title}"`,
            actor: finding.resolvedBy || "Governance Reviewer",
            timestamp: finding.resolvedAt || review.submittedAt || "",
            displayTime: formatActivityTimestamp(finding.resolvedAt || review.submittedAt, referenceNow),
            isRecordedEvent: Boolean(finding.resolvedAt),
            isSnapshot: !finding.resolvedAt,
            details: {
              findingId: finding.id,
              findingTitle: finding.title,
              findingCategory: finding.category,
              severity: finding.severity,
              evidenceStatus: finding.evidenceStatus,
              historicalValueAvailable: Boolean(finding.resolvedAt),
              previousValueNotice: finding.resolvedAt
                ? undefined
                : "Resolution timestamp not recorded in historical seed data.",
            },
          });
        }
      }
    }
  }

  // 7. Reviewer Decision Snapshot (if approved or changes requested, but no matching activity event)
  const hasDecisionEvent = entries.some((e) => e.category === "decision");
  if (!hasDecisionEvent && (review.status === "Approved" || review.status === "Changes Requested")) {
    entries.push({
      id: `dec-${review.id}`,
      reviewId: review.id,
      category: "decision",
      title: review.status === "Approved" ? "Current Status: Approved" : "Current Status: Changes Requested",
      action: `recorded final status as "${review.status}"`,
      actor: "Brand Governance Reviewer",
      timestamp: review.submittedAt || "",
      displayTime: formatActivityTimestamp(review.submittedAt, referenceNow),
      isRecordedEvent: false,
      isSnapshot: true,
      statusLabel: review.status,
      details: {
        reviewerNote: review.reviewerNotes,
        historicalValueAvailable: false,
        previousValueNotice:
          "Status transition timestamp not recorded in historical session; current status captured from review state.",
      },
    });
  }

  // 8. Chronological Sorting: newest events first
  return sortAuditEntries(entries);
}

/**
 * Sorts audit entries chronologically with newest first.
 * Strictly respects ISO 8601 timestamps, safely handling legacy or snapshot dates.
 */
export function sortAuditEntries(entries: ReviewAuditEntry[]): ReviewAuditEntry[] {
  return [...entries].sort((a, b) => {
    // If one is submission and the other is analysis on the same review at same timestamp,
    // analysis runs after submission
    if (a.reviewId === b.reviewId && a.timestamp === b.timestamp) {
      if (a.category === "submission" && b.category === "analysis") return 1;
      if (a.category === "analysis" && b.category === "submission") return -1;
    }

    const dateA = parseActivityDate(a.timestamp);
    const dateB = parseActivityDate(b.timestamp);

    // Both valid ISO timestamps: newest first
    if (dateA && dateB) {
      return dateB.getTime() - dateA.getTime();
    }

    // Only A has ISO timestamp -> A comes first
    if (dateA && !dateB) return -1;

    // Only B has ISO timestamp -> B comes first
    if (!dateA && dateB) return 1;

    // Neither has a valid timestamp (e.g. legacy strings): maintain stable sort by ID
    return b.id.localeCompare(a.id);
  });
}

/**
 * Filters review audit trail by category and search keyword.
 */
export function filterReviewAuditTrail(
  entries: ReviewAuditEntry[],
  category: ReviewAuditCategory,
  searchQuery: string,
): ReviewAuditEntry[] {
  const q = searchQuery.trim().toLowerCase();

  return entries.filter((entry) => {
    // Category match
    if (category !== "all" && entry.category !== category) {
      return false;
    }

    // Search query match
    if (q) {
      const matchActor = entry.actor.toLowerCase().includes(q);
      const matchAction = entry.action.toLowerCase().includes(q);
      const matchTitle = entry.title.toLowerCase().includes(q);
      const matchFindingTitle = entry.details?.findingTitle?.toLowerCase().includes(q) ?? false;
      const matchComment = entry.details?.commentText?.toLowerCase().includes(q) ?? false;
      const matchCorrection = entry.details?.correctionText?.toLowerCase().includes(q) ?? false;
      const matchNote = entry.details?.reviewerNote?.toLowerCase().includes(q) ?? false;

      if (
        !matchActor &&
        !matchAction &&
        !matchTitle &&
        !matchFindingTitle &&
        !matchComment &&
        !matchCorrection &&
        !matchNote
      ) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Computes audit summary metrics for an individual review.
 */
export function computeReviewAuditSummary(entries: ReviewAuditEntry[]): ReviewAuditSummary {
  let recordedEventsCount = 0;
  let decisionsCount = 0;
  let findingsCount = 0;
  let correctionsCount = 0;
  let commentsCount = 0;
  let hasAnalysisRun = false;

  for (const e of entries) {
    if (e.isRecordedEvent) recordedEventsCount++;
    if (e.category === "decision") decisionsCount++;
    if (e.category === "finding") findingsCount++;
    if (e.category === "correction") correctionsCount++;
    if (e.category === "comment") commentsCount++;
    if (e.category === "analysis") hasAnalysisRun = true;
  }

  return {
    totalEntries: entries.length,
    recordedEventsCount,
    decisionsCount,
    findingsCount,
    correctionsCount,
    commentsCount,
    hasAnalysisRun,
  };
}
