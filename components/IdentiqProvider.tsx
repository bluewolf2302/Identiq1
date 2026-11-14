"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  ActivityEvent,
  BrandAsset,
  KnowledgeEntry,
  ReviewFinding,
  ReviewStatus,
  ReviewSubmission,
} from "@/lib/types";
import type { ReviewDecision } from "@/lib/contracts/workflow";
import {
  buildFindingDecisionPatch,
  getFindingDecisionValidationError,
} from "@/lib/review-decisions";
import {
  INITIAL_ACTIVITY,
  INITIAL_ASSETS,
  INITIAL_KNOWLEDGE,
  INITIAL_REVIEWS,
} from "@/lib/seed-data";
import { CheckCircle2, Info, X } from "lucide-react";

interface ToastMessage {
  id: string;
  text: string;
  tone: "success" | "info";
}

interface WorkspaceSettings {
  reviewerName: string;
  reviewerRole: string;
  autoFlagUnverified: boolean;
  strictClaimsMode: boolean;
  minimumApprovalScore: number;
}

interface IdentiqContextValue {
  reviews: ReviewSubmission[];
  knowledge: KnowledgeEntry[];
  assets: BrandAsset[];
  activities: ActivityEvent[];
  settings: WorkspaceSettings;
  activeReviewId: string;
  setActiveReviewId: (id: string) => void;
  addReview: (review: ReviewSubmission) => void;
  updateReviewStatus: (
    reviewId: string,
    status: ReviewStatus,
    reviewerNotes?: string
  ) => void;
  toggleFindingResolved: (reviewId: string, findingId: string) => void;
  updateFindingCorrection: (
    reviewId: string,
    findingId: string,
    editedText: string,
    applyToCopy?: boolean
  ) => void;
  addFindingComment: (reviewId: string, findingId: string, text: string) => void;
  updateFindingDecision: (
    reviewId: string,
    findingId: string,
    decision: ReviewDecision,
    reason?: string,
  ) => void;
  addManualFinding: (reviewId: string, finding: ReviewFinding) => void;
  upsertKnowledgeEntry: (entry: KnowledgeEntry) => void;
  deleteKnowledgeEntry: (id: string) => void;
  toggleKnowledgeStatus: (id: string) => void;
  addAsset: (asset: BrandAsset) => void;
  deleteAsset: (id: string) => void;
  updateSettings: (next: Partial<WorkspaceSettings>) => void;
  resetDemoWorkspace: () => void;
  notify: (text: string, tone?: "success" | "info") => void;
}

const STORAGE_KEY = "identiq_workspace_v2";

const DEFAULT_SETTINGS: WorkspaceSettings = {
  reviewerName: "Maya Lin",
  reviewerRole: "Brand Governance Lead",
  autoFlagUnverified: true,
  strictClaimsMode: true,
  minimumApprovalScore: 85,
};

const IdentiqContext = createContext<IdentiqContextValue | null>(null);

export function IdentiqProvider({ children }: { children: React.ReactNode }) {
  const [reviews, setReviews] = useState<ReviewSubmission[]>(INITIAL_REVIEWS);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>(INITIAL_KNOWLEDGE);
  const [assets, setAssets] = useState<BrandAsset[]>(INITIAL_ASSETS);
  const [activities, setActivities] = useState<ActivityEvent[]>(INITIAL_ACTIVITY);
  const [settings, setSettings] = useState<WorkspaceSettings>(DEFAULT_SETTINGS);
  const [activeReviewId, setActiveReviewId] = useState<string>(INITIAL_REVIEWS[0].id);
  const [hydrated, setHydrated] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.reviews) && parsed.reviews.length > 0) {
            setReviews(parsed.reviews);
            setActiveReviewId(parsed.reviews[0].id);
          }
          if (Array.isArray(parsed.knowledge)) setKnowledge(parsed.knowledge);
          if (Array.isArray(parsed.assets)) setAssets(parsed.assets);
          if (Array.isArray(parsed.activities)) setActivities(parsed.activities);
          if (parsed.settings) setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
        }
      } catch {
        // Fallback safely to seed state
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ reviews, knowledge, assets, activities, settings })
      );
    } catch {
      // If previewDataUrls exceed localStorage quota, store reviews without heavy image data URLs
      try {
        const compactReviews = reviews.map((rev) => ({
          ...rev,
          visualSummary: rev.visualSummary
            ? {
                ...rev.visualSummary,
                pages: rev.visualSummary.pages.map((p) => ({
                  ...p,
                  previewDataUrl: undefined,
                })),
              }
            : undefined,
        }));
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            reviews: compactReviews,
            knowledge,
            assets,
            activities,
            settings,
          })
        );
      } catch {
        // Ignore quota issues in restricted browsers
      }
    }
  }, [reviews, knowledge, assets, activities, settings, hydrated]);

  const notify = (text: string, tone: "success" | "info" = "success") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  };

  const logActivity = (event: Omit<ActivityEvent, "id" | "timestamp">) => {
    const newEvent: ActivityEvent = {
      ...event,
      id: `act-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    setActivities((prev) => [newEvent, ...prev]);
  };

  const addReview = (review: ReviewSubmission) => {
    setReviews((prev) => [review, ...prev]);
    setActiveReviewId(review.id);
    logActivity({
      reviewId: review.id,
      actor: review.submittedBy,
      action: "submitted content for governance review:",
      target: review.title,
      type: "submitted",
    });
  };

  const recomputeScore = (findings: ReviewFinding[], baseScore: number): number => {
    if (findings.length === 0) return 100;
    const unresolvedPenalty = findings.reduce((sum, f) => {
      if (f.resolved) return sum;
      if (f.severity === "high") return sum + 12;
      if (f.severity === "medium") return sum + 6;
      return sum + 3;
    }, 0);
    return Math.max(40, Math.min(99, Math.max(baseScore, 98 - unresolvedPenalty)));
  };

  const updateReviewStatus = (
    reviewId: string,
    status: ReviewStatus,
    reviewerNotes?: string
  ) => {
    const targetReview = reviews.find((r) => r.id === reviewId);
    if (!targetReview || targetReview.status === status) return;
    const allowedTransitions: Record<ReviewStatus, ReviewStatus[]> = {
      "Pending Approval": ["In Review", "Changes Requested", "Approved"],
      "In Review": ["Changes Requested", "Approved"],
      "Changes Requested": ["In Review", "Approved"],
      Approved: ["In Review"],
    };
    if (!allowedTransitions[targetReview.status].includes(status)) {
      notify(`Cannot move a ${targetReview.status} review to ${status}`, "info");
      return;
    }
    setReviews((prev) =>
      prev.map((r) =>
        r.id === reviewId
          ? {
              ...r,
              status,
              reviewerNotes: reviewerNotes !== undefined ? reviewerNotes : r.reviewerNotes,
            }
          : r
      )
    );
    if (targetReview) {
      logActivity({
        reviewId,
        actor: settings.reviewerName,
        action:
          status === "Approved"
            ? "approved submission:"
            : status === "Changes Requested"
            ? "requested changes on"
            : `moved review status to ${status} for`,
        target: targetReview.title,
        type:
          status === "Approved"
            ? "approved"
            : status === "Changes Requested"
            ? "changes_requested"
            : "resolved",
      });
    }
    notify(`Status updated to ${status}`);
  };

  const updateFindingDecision = (
    reviewId: string,
    findingId: string,
    decision: ReviewDecision,
    reason?: string,
  ) => {
    const targetReview = reviews.find((r) => r.id === reviewId);
    const targetFinding = targetReview?.findings.find((f) => f.id === findingId);
    if (!targetReview || !targetFinding) return;
    const decisionError = getFindingDecisionValidationError(decision, reason);
    if (decisionError) {
      notify(decisionError, "info");
      return;
    }
    if (
      targetFinding.reviewDecision === decision &&
      (!reason?.trim() || targetFinding.reviewDecisionReason === reason.trim())
    ) {
      return;
    }
    const timestamp = new Date().toISOString();
    const nextDecision = buildFindingDecisionPatch(
      decision,
      reason,
      settings.reviewerName,
      timestamp,
    );
    setReviews((prev) =>
      prev.map((review) =>
        review.id !== reviewId
          ? review
          : {
              ...review,
              findings: review.findings.map((finding) =>
                finding.id === findingId ? { ...finding, ...nextDecision } : finding,
              ),
            },
      ),
    );
    logActivity({
      reviewId,
      actor: settings.reviewerName,
      action: `${decision.toLowerCase()} finding "${targetFinding.title}"${
        reason?.trim() ? `: ${reason.trim()}` : ""
      } in`,
      target: targetReview.title,
      type: "finding_decision",
    });
    notify(
      decision === "APPROVE"
        ? "Finding accepted"
        : decision === "REJECT"
          ? "Finding rejected"
          : "Finding marked for human review",
    );
  };

  const toggleFindingResolved = (reviewId: string, findingId: string) => {
    let resolvedNow = false;
    let targetTitle = "";
    setReviews((prev) =>
      prev.map((r) => {
        if (r.id !== reviewId) return r;
        targetTitle = r.title;
        const nextFindings = r.findings.map((f) => {
          if (f.id !== findingId) return f;
          resolvedNow = !f.resolved;
          return {
            ...f,
            resolved: resolvedNow,
            resolvedAt: resolvedNow ? new Date().toISOString() : undefined,
            resolvedBy: resolvedNow ? settings.reviewerName : undefined,
          };
        });
        return {
          ...r,
          findings: nextFindings,
          complianceScore: recomputeScore(nextFindings, r.complianceScore),
        };
      })
    );
    if (targetTitle) {
      logActivity({
        reviewId,
        actor: settings.reviewerName,
        action: resolvedNow ? "marked finding resolved in" : "reopened finding in",
        target: targetTitle,
        type: "resolved",
      });
    }
    notify(resolvedNow ? "Finding marked as resolved" : "Finding reopened");
  };

  const updateFindingCorrection = (
    reviewId: string,
    findingId: string,
    editedText: string,
    applyToCopy = false
  ) => {
    const targetReview = reviews.find((r) => r.id === reviewId);
    const targetFinding = targetReview?.findings.find((f) => f.id === findingId);

    setReviews((prev) =>
      prev.map((r) => {
        if (r.id !== reviewId) return r;
        const finding = r.findings.find((f) => f.id === findingId);
        let updatedTextContent = r.textContent;
        if (applyToCopy && finding?.affectedContent && editedText.trim()) {
          if (updatedTextContent.includes(finding.affectedContent)) {
            updatedTextContent = updatedTextContent.replace(
              finding.affectedContent,
              editedText.trim()
            );
          }
        }
        const nextFindings = r.findings.map((f) =>
          f.id === findingId
            ? {
                ...f,
                editedCorrection: editedText,
                resolved: applyToCopy ? true : f.resolved,
                resolvedAt: applyToCopy
                  ? new Date().toISOString()
                  : f.resolved
                  ? f.resolvedAt
                  : undefined,
                resolvedBy: applyToCopy
                  ? settings.reviewerName
                  : f.resolved
                  ? f.resolvedBy
                  : undefined,
              }
            : f
        );
        return {
          ...r,
          textContent: updatedTextContent,
          findings: nextFindings,
          complianceScore: recomputeScore(nextFindings, r.complianceScore),
        };
      })
    );

    if (applyToCopy && targetReview) {
      logActivity({
        reviewId,
        actor: settings.reviewerName,
        action: `applied correction for "${targetFinding?.title || "finding"}" in`,
        target: targetReview.title,
        type: "correction_applied",
      });
    }

    notify(applyToCopy ? "Correction applied to copy & resolved" : "Correction draft saved");
  };

  const addFindingComment = (reviewId: string, findingId: string, text: string) => {
    if (!text.trim()) return;
    const targetReview = reviews.find((r) => r.id === reviewId);
    const targetFinding = targetReview?.findings.find((f) => f.id === findingId);

    setReviews((prev) =>
      prev.map((r) => {
        if (r.id !== reviewId) return r;
        return {
          ...r,
          findings: r.findings.map((f) =>
            f.id === findingId
              ? {
                  ...f,
                  comments: [
                    ...f.comments,
                    {
                      id: `cmt-${Date.now()}`,
                      author: settings.reviewerName,
                      role: settings.reviewerRole,
                      text: text.trim(),
                      createdAt: new Date().toISOString(),
                    },
                  ],
                }
              : f
          ),
        };
      })
    );

    if (targetReview) {
      logActivity({
        reviewId,
        actor: settings.reviewerName,
        action: `commented on finding "${targetFinding?.title || "issue"}" in`,
        target: targetReview.title,
        type: "comment_added",
      });
    }

    notify("Reviewer comment added");
  };

  const addManualFinding = (reviewId: string, finding: ReviewFinding) => {
    const targetReview = reviews.find((r) => r.id === reviewId);
    setReviews((prev) =>
      prev.map((r) => {
        if (r.id !== reviewId) return r;
        const nextFindings = [finding, ...r.findings];
        return {
          ...r,
          findings: nextFindings,
          complianceScore: recomputeScore(nextFindings, r.complianceScore),
        };
      })
    );

    if (targetReview) {
      logActivity({
        reviewId,
        actor: settings.reviewerName,
        action: `added manual finding "${finding.title}" to`,
        target: targetReview.title,
        type: "manual_finding_added",
      });
    }

    notify("Manual governance finding added");
  };

  const upsertKnowledgeEntry = (entry: KnowledgeEntry) => {
    const exists = knowledge.some((k) => k.id === entry.id);
    setKnowledge((prev) =>
      exists ? prev.map((k) => (k.id === entry.id ? entry : k)) : [entry, ...prev]
    );
    logActivity({
      actor: settings.reviewerName,
      action: exists ? "updated knowledge entry:" : "added knowledge entry:",
      target: entry.title,
      type: "knowledge_updated",
    });
    notify(exists ? "Knowledge entry updated" : "Knowledge entry added");
  };

  const deleteKnowledgeEntry = (id: string) => {
    setKnowledge((prev) => prev.filter((k) => k.id !== id));
    notify("Knowledge entry removed", "info");
  };

  const toggleKnowledgeStatus = (id: string) => {
    setKnowledge((prev) =>
      prev.map((k) =>
        k.id === id
          ? {
              ...k,
              status: k.status === "Approved" ? "Pending Review" : "Approved",
              updatedAt: new Date().toISOString().split("T")[0],
            }
          : k
      )
    );
    notify("Knowledge verification status updated");
  };

  const addAsset = (asset: BrandAsset) => {
    setAssets((prev) => [asset, ...prev]);
    logActivity({
      actor: settings.reviewerName,
      action: "uploaded brand asset:",
      target: asset.name,
      type: "asset_uploaded",
    });
    notify(`Added "${asset.name}" to Asset Library`);
  };

  const deleteAsset = (id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    notify("Asset removed from library", "info");
  };

  const updateSettings = (next: Partial<WorkspaceSettings>) => {
    setSettings((prev) => ({ ...prev, ...next }));
    notify("Governance settings saved");
  };

  const resetDemoWorkspace = () => {
    localStorage.removeItem(STORAGE_KEY);
    setReviews(INITIAL_REVIEWS);
    setKnowledge(INITIAL_KNOWLEDGE);
    setAssets(INITIAL_ASSETS);
    setActivities(INITIAL_ACTIVITY);
    setSettings(DEFAULT_SETTINGS);
    setActiveReviewId(INITIAL_REVIEWS[0].id);
    notify("Demo workspace restored to initial sample data");
  };

  return (
    <IdentiqContext.Provider
      value={{
        reviews,
        knowledge,
        assets,
        activities,
        settings,
        activeReviewId,
        setActiveReviewId,
        addReview,
        updateReviewStatus,
        toggleFindingResolved,
        updateFindingCorrection,
        addFindingComment,
        updateFindingDecision,
        addManualFinding,
        upsertKnowledgeEntry,
        deleteKnowledgeEntry,
        toggleKnowledgeStatus,
        addAsset,
        deleteAsset,
        updateSettings,
        resetDemoWorkspace,
        notify,
      }}
    >
      {children}

      {/* Non-intrusive bottom-right toast stack */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-2.5 bg-[#141414] text-white px-4 py-2.5 rounded-xl shadow-lg border border-white/10 text-xs font-medium"
          >
            {toast.tone === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-[#CDEEE0] shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-[#DDF0FA] shrink-0" />
            )}
            <span>{toast.text}</span>
            <button
              onClick={() => setToasts((p) => p.filter((t) => t.id !== toast.id))}
              aria-label="Dismiss notification"
              className="ml-1 text-white/60 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </IdentiqContext.Provider>
  );
}

export function useIdentiq() {
  const ctx = useContext(IdentiqContext);
  if (!ctx) {
    throw new Error("useIdentiq must be used inside IdentiqProvider");
  }
  return ctx;
}
