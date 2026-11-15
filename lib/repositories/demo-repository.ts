/**
 * Shared Demo Repositories for IdentIQ
 *
 * Provides ReviewRepository and ActivityRepository implementations that interact
 * with the hosted Supabase database strictly through secure server-side API routes.
 * Never calls PostgREST directly from client code and never requires customer auth tokens.
 */

import { ActivityEvent, ReviewStatus, ReviewSubmission } from "../types";
import { ReviewDecision } from "../contracts/workflow";
import {
  ReviewRepository,
  SubmitReviewParams,
  UpdateReviewStatusParams,
  ToggleFindingResolvedParams,
  ApplyFindingCorrectionParams,
  UpdateFindingDecisionParams,
  AddFindingCommentParams,
  AddManualFindingParams,
} from "./review-repository";
import { ActivityRepository } from "./activity-repository";

export class DemoReviewRepository implements ReviewRepository {
  async fetchReviews(): Promise<ReviewSubmission[]> {
    const res = await fetch("/api/demo/reviews", {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to fetch demo reviews (${res.status})`);
    }

    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async submitReview(params: SubmitReviewParams): Promise<{ reviewId: string; complianceScore: number }> {
    const res = await fetch("/api/demo/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.review),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to submit demo review");
    }

    const data = await res.json();
    return {
      reviewId: data.reviewId,
      complianceScore: params.review.complianceScore,
    };
  }

  async updateReviewStatus(params: UpdateReviewStatusParams): Promise<{ reviewId: string; status: ReviewStatus }> {
    const res = await fetch("/api/demo/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_status",
        reviewId: params.reviewId,
        status: params.status,
        reviewerNotes: params.reviewerNotes,
        actorName: params.actorName,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to update demo review status");
    }

    const data = await res.json();
    return { reviewId: data.reviewId, status: data.status };
  }

  async toggleFindingResolved(
    params: ToggleFindingResolvedParams
  ): Promise<{ reviewId: string; findingId: string; resolved: boolean; complianceScore: number }> {
    const res = await fetch("/api/demo/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "toggle_finding",
        reviewId: params.reviewId,
        findingId: params.findingId,
        actorName: params.actorName,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to toggle demo finding resolution");
    }

    const data = await res.json();
    return {
      reviewId: data.reviewId,
      findingId: data.findingId,
      resolved: data.resolved,
      complianceScore: data.complianceScore,
    };
  }

  async applyFindingCorrection(
    params: ApplyFindingCorrectionParams
  ): Promise<{ reviewId: string; findingId: string; appliedToCopy: boolean; complianceScore: number }> {
    const res = await fetch("/api/demo/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "apply_correction",
        reviewId: params.reviewId,
        findingId: params.findingId,
        editedText: params.editedText,
        applyToCopy: params.applyToCopy,
        actorName: params.actorName,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to apply demo finding correction");
    }

    const data = await res.json();
    return {
      reviewId: data.reviewId,
      findingId: data.findingId,
      appliedToCopy: Boolean(params.applyToCopy),
      complianceScore: data.complianceScore,
    };
  }

  async updateFindingDecision(
    params: UpdateFindingDecisionParams
  ): Promise<{ reviewId: string; findingId: string; decision: ReviewDecision }> {
    const res = await fetch("/api/demo/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_decision",
        reviewId: params.reviewId,
        findingId: params.findingId,
        decision: params.decision,
        reason: params.reason,
        actorName: params.actorName,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to update demo finding decision");
    }

    const data = await res.json();
    return {
      reviewId: data.reviewId,
      findingId: data.findingId,
      decision: data.decision,
    };
  }

  async addFindingComment(
    params: AddFindingCommentParams
  ): Promise<{ commentId: string; reviewId: string; findingId: string }> {
    const res = await fetch("/api/demo/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_comment",
        reviewId: params.reviewId,
        findingId: params.findingId,
        commentId: params.commentId,
        text: params.text,
        authorName: params.authorName,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to add demo finding comment");
    }

    const data = await res.json();
    return {
      commentId: data.commentId,
      reviewId: data.reviewId,
      findingId: data.findingId,
    };
  }

  async addManualFinding(
    params: AddManualFindingParams
  ): Promise<{ findingId: string; reviewId: string; complianceScore: number }> {
    const res = await fetch("/api/demo/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_manual_finding",
        reviewId: params.reviewId,
        findingId: params.finding.id,
        ruleId: params.finding.ruleId,
        category: params.finding.category,
        title: params.finding.title,
        description: params.finding.description,
        severity: params.finding.severity,
        evidenceStatus: params.finding.evidenceStatus,
        detectedValue: params.finding.detectedValue,
        expectedValue: params.finding.expectedValue,
        sourceReference: params.finding.sourceReference,
        recommendation: params.finding.recommendation,
        affectedContent: params.finding.affectedContent,
        actorName: params.actorName,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to add demo manual finding");
    }

    const data = await res.json();
    return {
      findingId: data.findingId,
      reviewId: data.reviewId,
      complianceScore: data.complianceScore,
    };
  }
}

export class DemoActivityRepository implements ActivityRepository {
  async fetchActivities(): Promise<ActivityEvent[]> {
    const res = await fetch("/api/demo/activities", {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to fetch demo activities (${res.status})`);
    }

    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async recordActivity(event: ActivityEvent): Promise<void> {
    const res = await fetch("/api/demo/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to record demo activity");
    }
  }
}
