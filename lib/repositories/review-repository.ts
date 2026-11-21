/**
 * Review Governance Repository
 *
 * Provides typed interface and implementations for review submissions,
 * findings, comments, and decisions. Supports both remote Supabase persistence
 * (via the 7 atomic RPCs) and local prototype/demo fallback.
 */

import { ReviewFinding, ReviewStatus, ReviewSubmission } from "../types";
import { ReviewDecision } from "../contracts/workflow";
import { callPostgrest } from "../supabase/client";
import { generateIdempotencyKey, mapPostgrestError } from "./idempotency";
import { INITIAL_REVIEWS } from "../seed-data";

export interface SubmitReviewParams {
  review: ReviewSubmission;
  organisationId: string;
  brandId: string;
  idempotencyKey?: string;
}

export interface UpdateReviewStatusParams {
  reviewId: string;
  status: ReviewStatus;
  reviewerNotes?: string;
  actorName?: string;
  idempotencyKey?: string;
}

export interface ToggleFindingResolvedParams {
  reviewId: string;
  findingId: string;
  actorName?: string;
  idempotencyKey?: string;
}

export interface ApplyFindingCorrectionParams {
  reviewId: string;
  findingId: string;
  editedText: string;
  applyToCopy?: boolean;
  actorName?: string;
  idempotencyKey?: string;
}

export interface UpdateFindingDecisionParams {
  reviewId: string;
  findingId: string;
  decision: ReviewDecision;
  reason?: string;
  actorName?: string;
  idempotencyKey?: string;
}

export interface AddFindingCommentParams {
  reviewId: string;
  findingId: string;
  commentId: string;
  text: string;
  authorName?: string;
  authorRole?: string;
  parentCommentId?: string;
  idempotencyKey?: string;
}

export interface AddManualFindingParams {
  reviewId: string;
  finding: ReviewFinding;
  brandRuleId?: string;
  actorName?: string;
  idempotencyKey?: string;
}

export interface ReviewRepository {
  fetchReviews(organisationId?: string): Promise<ReviewSubmission[]>;
  submitReview(params: SubmitReviewParams): Promise<{ reviewId: string; complianceScore: number }>;
  updateReviewStatus(params: UpdateReviewStatusParams): Promise<{ reviewId: string; status: ReviewStatus }>;
  toggleFindingResolved(params: ToggleFindingResolvedParams): Promise<{ reviewId: string; findingId: string; resolved: boolean; complianceScore: number }>;
  applyFindingCorrection(params: ApplyFindingCorrectionParams): Promise<{ reviewId: string; findingId: string; appliedToCopy: boolean; complianceScore: number }>;
  updateFindingDecision(params: UpdateFindingDecisionParams): Promise<{ reviewId: string; findingId: string; decision: ReviewDecision }>;
  addFindingComment(params: AddFindingCommentParams): Promise<{ commentId: string; reviewId: string; findingId: string }>;
  addManualFinding(params: AddManualFindingParams): Promise<{ findingId: string; reviewId: string; complianceScore: number }>;
}

/**
 * Supabase-backed implementation invoking the 7 atomic RPCs.
 */
export class SupabaseReviewRepository implements ReviewRepository {
  async fetchReviews(organisationId?: string): Promise<ReviewSubmission[]> {
    const query = organisationId
      ? `/rest/v1/reviews?organisation_id=eq.${organisationId}&select=*,review_findings(*,review_comments(*))&order=submitted_at.desc`
      : `/rest/v1/reviews?select=*,review_findings(*,review_comments(*))&order=submitted_at.desc`;

    const res = await callPostgrest<Record<string, unknown>[]>(query);
    if (res.error) {
      throw mapPostgrestError(res.error);
    }

    if (!Array.isArray(res.data)) {
      return [];
    }

    // Map database entities to ReviewSubmission domain objects
    return res.data.map((row) => {
      const rawFindings = Array.isArray(row.review_findings)
        ? (row.review_findings as Record<string, unknown>[])
        : [];

      const findings: ReviewFinding[] = rawFindings.map((f) => {
        const rawComments = Array.isArray(f.review_comments)
          ? (f.review_comments as Record<string, unknown>[])
          : [];

        return {
          id: String(f.id),
          category: (f.category as ReviewFinding["category"]) || "Brand Claims",
          title: String(f.title || ""),
          description: String(f.description || ""),
          severity: (f.severity as ReviewFinding["severity"]) || "medium",
          evidenceStatus: (f.evidence_status as ReviewFinding["evidenceStatus"]) || "unverified",
          detectedValue: String(f.detected_value || ""),
          expectedValue: String(f.expected_value || ""),
          sourceReference: String(f.source_reference || ""),
          recommendation: String(f.recommendation || ""),
          affectedContent: String(f.affected_content || ""),
          resolved: Boolean(f.resolved),
          resolvedAt: f.resolved_at ? String(f.resolved_at) : undefined,
          resolvedBy: f.resolved_by ? String(f.resolved_by) : undefined,
          editedCorrection: f.edited_correction ? String(f.edited_correction) : undefined,
          ruleId: f.rule_id ? String(f.rule_id) : undefined,
          reviewDecision: f.review_decision ? (f.review_decision as ReviewDecision) : undefined,
          reviewDecisionReason: f.review_decision_reason ? String(f.review_decision_reason) : undefined,
          reviewDecisionAt: f.review_decision_at ? String(f.review_decision_at) : undefined,
          reviewDecisionBy: f.review_decision_by ? String(f.review_decision_by) : undefined,
          comments: rawComments.map((c) => ({
            id: String(c.id),
            author: String(c.author),
            role: String(c.role),
            text: String(c.text),
            createdAt: String(c.created_at),
          })),
        };
      });

      return {
        id: String(row.id),
        title: String(row.title),
        contentType: (row.content_type as ReviewSubmission["contentType"]) || "Campaign Copy",
        guidelineCollection: String(row.guideline_collection),
        submittedBy: String(row.submitted_by),
        submittedAt: String(row.submitted_at),
        status: (row.status as ReviewStatus) || "Pending Approval",
        complianceScore: Number(row.compliance_score || 100),
        textContent: String(row.text_content || ""),
        assetUrl: row.asset_url ? String(row.asset_url) : undefined,
        assetName: row.asset_name ? String(row.asset_name) : undefined,
        pastelTheme: (row.pastel_theme as ReviewSubmission["pastelTheme"]) || "blue",
        reviewerNotes: row.reviewer_notes ? String(row.reviewer_notes) : undefined,
        providerUsed: row.provider_used ? String(row.provider_used) : undefined,
        fallbackUsed: Boolean(row.fallback_used),
        analysisStatus: row.analysis_status as ReviewSubmission["analysisStatus"],
        analysisRunId: row.analysis_run_id ? String(row.analysis_run_id) : undefined,
        findings,
      };
    });
  }

  async submitReview(params: SubmitReviewParams): Promise<{ reviewId: string; complianceScore: number }> {
    const key = params.idempotencyKey || generateIdempotencyKey("submit_review");
    const payload = {
      p_idempotency_key: key,
      p_review_id: params.review.id,
      p_organisation_id: params.organisationId,
      p_brand_id: params.brandId,
      p_title: params.review.title,
      p_content_type: params.review.contentType,
      p_guideline_collection: params.review.guidelineCollection || "Brand Guidelines",
      p_text_content: params.review.textContent || "",
      p_compliance_score: params.review.complianceScore ?? 100,
      p_pastel_theme: params.review.pastelTheme || "blue",
      p_submitted_by: params.review.submittedBy || "Reviewer",
      p_asset_url: params.review.assetUrl || null,
      p_asset_name: params.review.assetName || null,
      p_reviewer_notes: params.review.reviewerNotes || null,
      p_provider_used: params.review.providerUsed || null,
      p_fallback_used: Boolean(params.review.fallbackUsed),
      p_analysis_status: params.review.analysisStatus || "COMPLETED",
      p_analysis_run_id: params.review.analysisRunId || null,
      p_visual_summary: params.review.visualSummary || null,
      p_ocr_blocks: params.review.ocrBlocks || null,
      p_findings: params.review.findings || [],
    };

    const res = await callPostgrest<{ review_id: string; compliance_score: number }>(
      "/rest/v1/rpc/submit_review_atomic",
      {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": key },
      }
    );

    if (res.error) throw mapPostgrestError(res.error);
    return {
      reviewId: res.data?.review_id || params.review.id,
      complianceScore: res.data?.compliance_score ?? params.review.complianceScore,
    };
  }

  async updateReviewStatus(params: UpdateReviewStatusParams): Promise<{ reviewId: string; status: ReviewStatus }> {
    const key = params.idempotencyKey || generateIdempotencyKey("update_review_status");
    const payload = {
      p_idempotency_key: key,
      p_review_id: params.reviewId,
      p_status: params.status,
      p_reviewer_notes: params.reviewerNotes,
      p_actor_name: params.actorName,
    };

    const res = await callPostgrest<{ review_id: string; status: ReviewStatus }>(
      "/rest/v1/rpc/update_review_status_atomic",
      {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": key },
      }
    );

    if (res.error) throw mapPostgrestError(res.error);
    return {
      reviewId: res.data?.review_id || params.reviewId,
      status: res.data?.status || params.status,
    };
  }

  async toggleFindingResolved(params: ToggleFindingResolvedParams): Promise<{ reviewId: string; findingId: string; resolved: boolean; complianceScore: number }> {
    const key = params.idempotencyKey || generateIdempotencyKey("toggle_finding_resolved");
    const payload = {
      p_idempotency_key: key,
      p_review_id: params.reviewId,
      p_finding_id: params.findingId,
      p_actor_name: params.actorName,
    };

    const res = await callPostgrest<{ review_id: string; finding_id: string; resolved: boolean; compliance_score: number }>(
      "/rest/v1/rpc/toggle_finding_resolved_atomic",
      {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": key },
      }
    );

    if (res.error) throw mapPostgrestError(res.error);
    return {
      reviewId: res.data?.review_id || params.reviewId,
      findingId: res.data?.finding_id || params.findingId,
      resolved: Boolean(res.data?.resolved),
      complianceScore: Number(res.data?.compliance_score || 100),
    };
  }

  async applyFindingCorrection(params: ApplyFindingCorrectionParams): Promise<{ reviewId: string; findingId: string; appliedToCopy: boolean; complianceScore: number }> {
    const key = params.idempotencyKey || generateIdempotencyKey("apply_finding_correction");
    const payload = {
      p_idempotency_key: key,
      p_review_id: params.reviewId,
      p_finding_id: params.findingId,
      p_edited_text: params.editedText,
      p_apply_to_copy: params.applyToCopy ?? false,
      p_actor_name: params.actorName,
    };

    const res = await callPostgrest<{ review_id: string; finding_id: string; applied_to_copy: boolean; compliance_score: number }>(
      "/rest/v1/rpc/apply_finding_correction_atomic",
      {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": key },
      }
    );

    if (res.error) throw mapPostgrestError(res.error);
    return {
      reviewId: res.data?.review_id || params.reviewId,
      findingId: res.data?.finding_id || params.findingId,
      appliedToCopy: Boolean(res.data?.applied_to_copy),
      complianceScore: Number(res.data?.compliance_score || 100),
    };
  }

  async updateFindingDecision(params: UpdateFindingDecisionParams): Promise<{ reviewId: string; findingId: string; decision: ReviewDecision }> {
    const key = params.idempotencyKey || generateIdempotencyKey("update_finding_decision");
    const payload = {
      p_idempotency_key: key,
      p_review_id: params.reviewId,
      p_finding_id: params.findingId,
      p_decision: params.decision,
      p_reason: params.reason,
      p_actor_name: params.actorName,
    };

    const res = await callPostgrest<{ review_id: string; finding_id: string; decision: ReviewDecision }>(
      "/rest/v1/rpc/update_finding_decision_atomic",
      {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": key },
      }
    );

    if (res.error) throw mapPostgrestError(res.error);
    return {
      reviewId: res.data?.review_id || params.reviewId,
      findingId: res.data?.finding_id || params.findingId,
      decision: res.data?.decision || params.decision,
    };
  }

  async addFindingComment(params: AddFindingCommentParams): Promise<{ commentId: string; reviewId: string; findingId: string }> {
    const key = params.idempotencyKey || generateIdempotencyKey("add_finding_comment");
    const payload = {
      p_idempotency_key: key,
      p_comment_id: params.commentId,
      p_review_id: params.reviewId,
      p_finding_id: params.findingId,
      p_text: params.text,
      p_author_name: params.authorName,
      p_author_role: params.authorRole,
      p_parent_comment_id: params.parentCommentId,
    };

    const res = await callPostgrest<{ comment_id: string; review_id: string; finding_id: string }>(
      "/rest/v1/rpc/add_finding_comment_atomic",
      {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": key },
      }
    );

    if (res.error) throw mapPostgrestError(res.error);
    return {
      commentId: res.data?.comment_id || params.commentId,
      reviewId: res.data?.review_id || params.reviewId,
      findingId: res.data?.finding_id || params.findingId,
    };
  }

  async addManualFinding(params: AddManualFindingParams): Promise<{ findingId: string; reviewId: string; complianceScore: number }> {
    const key = params.idempotencyKey || generateIdempotencyKey("add_manual_finding");
    const payload = {
      p_idempotency_key: key,
      p_finding_id: params.finding.id,
      p_review_id: params.reviewId,
      p_category: params.finding.category,
      p_title: params.finding.title,
      p_description: params.finding.description,
      p_severity: params.finding.severity,
      p_evidence_status: params.finding.evidenceStatus,
      p_detected_value: params.finding.detectedValue,
      p_expected_value: params.finding.expectedValue,
      p_source_reference: params.finding.sourceReference,
      p_recommendation: params.finding.recommendation,
      p_affected_content: params.finding.affectedContent,
      p_brand_rule_id: (params.brandRuleId && /^[0-9a-fA-F-]{36}$/.test(params.brandRuleId)) ? params.brandRuleId : null,
      p_rule_id: params.finding.ruleId || null,
      p_actor_name: params.actorName,
    };

    const res = await callPostgrest<{ finding_id: string; review_id: string; compliance_score: number }>(
      "/rest/v1/rpc/add_manual_finding_atomic",
      {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": key },
      }
    );

    if (res.error) throw mapPostgrestError(res.error);
    return {
      findingId: res.data?.finding_id || params.finding.id,
      reviewId: res.data?.review_id || params.reviewId,
      complianceScore: Number(res.data?.compliance_score || 100),
    };
  }
}

/**
 * Local prototype implementation preserving offline and demo functionality.
 */
export class LocalReviewRepository implements ReviewRepository {
  private reviews: ReviewSubmission[];

  constructor(initialReviews: ReviewSubmission[] = INITIAL_REVIEWS) {
    this.reviews = [...initialReviews];
  }

  async fetchReviews(): Promise<ReviewSubmission[]> {
    return [...this.reviews];
  }

  async submitReview(params: SubmitReviewParams): Promise<{ reviewId: string; complianceScore: number }> {
    this.reviews = [params.review, ...this.reviews];
    return { reviewId: params.review.id, complianceScore: params.review.complianceScore };
  }

  async updateReviewStatus(params: UpdateReviewStatusParams): Promise<{ reviewId: string; status: ReviewStatus }> {
    this.reviews = this.reviews.map((r) =>
      r.id === params.reviewId
        ? { ...r, status: params.status, reviewerNotes: params.reviewerNotes ?? r.reviewerNotes }
        : r
    );
    return { reviewId: params.reviewId, status: params.status };
  }

  async toggleFindingResolved(params: ToggleFindingResolvedParams): Promise<{ reviewId: string; findingId: string; resolved: boolean; complianceScore: number }> {
    let resolved = false;
    let newScore = 100;
    this.reviews = this.reviews.map((r) => {
      if (r.id !== params.reviewId) return r;
      const findings = r.findings.map((f) => {
        if (f.id !== params.findingId) return f;
        resolved = !f.resolved;
        return {
          ...f,
          resolved,
          resolvedAt: resolved ? new Date().toISOString() : undefined,
          resolvedBy: resolved ? params.actorName : undefined,
        };
      });
      const penalty = findings.reduce((sum, f) => {
        if (f.resolved) return sum;
        if (f.severity === "high") return sum + 12;
        if (f.severity === "medium") return sum + 6;
        return sum + 3;
      }, 0);
      newScore = Math.max(40, Math.min(99, Math.max(r.complianceScore, 98 - penalty)));
      return { ...r, findings, complianceScore: newScore };
    });
    return { reviewId: params.reviewId, findingId: params.findingId, resolved, complianceScore: newScore };
  }

  async applyFindingCorrection(params: ApplyFindingCorrectionParams): Promise<{ reviewId: string; findingId: string; appliedToCopy: boolean; complianceScore: number }> {
    let newScore = 100;
    this.reviews = this.reviews.map((r) => {
      if (r.id !== params.reviewId) return r;
      const finding = r.findings.find((f) => f.id === params.findingId);
      let textContent = r.textContent;
      if (params.applyToCopy && finding?.affectedContent && params.editedText.trim()) {
        if (textContent.includes(finding.affectedContent)) {
          textContent = textContent.replace(finding.affectedContent, params.editedText.trim());
        }
      }
      const findings = r.findings.map((f) =>
        f.id === params.findingId
          ? {
              ...f,
              editedCorrection: params.editedText,
              resolved: params.applyToCopy ? true : f.resolved,
              resolvedAt: params.applyToCopy ? new Date().toISOString() : f.resolvedAt,
              resolvedBy: params.applyToCopy ? params.actorName : f.resolvedBy,
            }
          : f
      );
      const penalty = findings.reduce((sum, f) => {
        if (f.resolved) return sum;
        if (f.severity === "high") return sum + 12;
        if (f.severity === "medium") return sum + 6;
        return sum + 3;
      }, 0);
      newScore = Math.max(40, Math.min(99, Math.max(r.complianceScore, 98 - penalty)));
      return { ...r, textContent, findings, complianceScore: newScore };
    });
    return { reviewId: params.reviewId, findingId: params.findingId, appliedToCopy: Boolean(params.applyToCopy), complianceScore: newScore };
  }

  async updateFindingDecision(params: UpdateFindingDecisionParams): Promise<{ reviewId: string; findingId: string; decision: ReviewDecision }> {
    this.reviews = this.reviews.map((r) =>
      r.id === params.reviewId
        ? {
            ...r,
            findings: r.findings.map((f) =>
              f.id === params.findingId
                ? {
                    ...f,
                    reviewDecision: params.decision,
                    reviewDecisionReason: params.reason,
                    reviewDecisionAt: new Date().toISOString(),
                    reviewDecisionBy: params.actorName,
                  }
                : f
            ),
          }
        : r
    );
    return { reviewId: params.reviewId, findingId: params.findingId, decision: params.decision };
  }

  async addFindingComment(params: AddFindingCommentParams): Promise<{ commentId: string; reviewId: string; findingId: string }> {
    this.reviews = this.reviews.map((r) =>
      r.id === params.reviewId
        ? {
            ...r,
            findings: r.findings.map((f) =>
              f.id === params.findingId
                ? {
                    ...f,
                    comments: [
                      ...f.comments,
                      {
                        id: params.commentId,
                        author: params.authorName || "Reviewer",
                        role: params.authorRole || "Brand Governance Lead",
                        text: params.text,
                        createdAt: new Date().toISOString(),
                      },
                    ],
                  }
                : f
            ),
          }
        : r
    );
    return { commentId: params.commentId, reviewId: params.reviewId, findingId: params.findingId };
  }

  async addManualFinding(params: AddManualFindingParams): Promise<{ findingId: string; reviewId: string; complianceScore: number }> {
    let newScore = 100;
    this.reviews = this.reviews.map((r) => {
      if (r.id !== params.reviewId) return r;
      const findings = [params.finding, ...r.findings];
      const penalty = findings.reduce((sum, f) => {
        if (f.resolved) return sum;
        if (f.severity === "high") return sum + 12;
        if (f.severity === "medium") return sum + 6;
        return sum + 3;
      }, 0);
      newScore = Math.max(40, Math.min(99, Math.max(r.complianceScore, 98 - penalty)));
      return { ...r, findings, complianceScore: newScore };
    });
    return { findingId: params.finding.id, reviewId: params.reviewId, complianceScore: newScore };
  }
}
