import { NextRequest, NextResponse } from "next/server";
import { DEMO_CONFIG, checkDemoRateLimit } from "@/lib/demo/config";
import { callServerPostgrest } from "@/lib/supabase/server";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "anonymous-demo-client";
}

/**
 * Recomputes the compliance score for a demo review.
 */
async function recomputeDemoReviewScore(reviewId: string): Promise<number> {
  const reviewRes = await callServerPostgrest<Array<{ base_score: number }>>(
    `/rest/v1/reviews?id=eq.${reviewId}&organisation_id=eq.${DEMO_CONFIG.ORGANISATION_ID}&select=base_score`,
    { useServiceRole: true }
  );

  const baseScore = reviewRes.data?.[0]?.base_score ?? 100;

  const findingsRes = await callServerPostgrest<Array<{ severity: string; resolved: boolean }>>(
    `/rest/v1/review_findings?review_id=eq.${reviewId}&select=severity,resolved`,
    { useServiceRole: true }
  );

  const findings = findingsRes.data || [];
  if (findings.length === 0) {
    await callServerPostgrest(`/rest/v1/reviews?id=eq.${reviewId}&organisation_id=eq.${DEMO_CONFIG.ORGANISATION_ID}`, {
      method: "PATCH",
      useServiceRole: true,
      body: { compliance_score: 100, updated_at: new Date().toISOString() },
    });
    return 100;
  }

  let penalty = 0;
  for (const f of findings) {
    if (!f.resolved) {
      if (f.severity === "high") penalty += 12;
      else if (f.severity === "medium") penalty += 6;
      else penalty += 3;
    }
  }

  const rawComputed = 98 - penalty;
  const newScore = Math.max(40, Math.min(99, Math.max(baseScore, rawComputed)));

  await callServerPostgrest(`/rest/v1/reviews?id=eq.${reviewId}&organisation_id=eq.${DEMO_CONFIG.ORGANISATION_ID}`, {
    method: "PATCH",
    useServiceRole: true,
    body: { compliance_score: newScore, updated_at: new Date().toISOString() },
  });

  return newScore;
}

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);
  const rate = checkDemoRateLimit(clientIp, "mutation");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMIT_EXCEEDED", message: "Too many demo operations. Please wait." },
      { status: 429, headers: { "Retry-After": String(rate.resetSeconds) } }
    );
  }

  try {
    const payload = await req.json();
    const action = String(payload.action || "");
    const reviewId = String(payload.reviewId || "");

    if (!reviewId) {
      return NextResponse.json({ error: "VALIDATION_ERROR", message: "reviewId is required" }, { status: 400 });
    }

    // 1. Verify target review belongs strictly to demo organisation
    const checkReview = await callServerPostgrest<Array<{ id: string; title: string }>>(
      `/rest/v1/reviews?id=eq.${reviewId}&organisation_id=eq.${DEMO_CONFIG.ORGANISATION_ID}&select=id,title`,
      { useServiceRole: true }
    );

    if (!checkReview.data || checkReview.data.length === 0) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: `Demo review "${reviewId}" not found or not in demo organisation` },
        { status: 404 }
      );
    }

    const reviewTitle = checkReview.data[0].title;
    const actorName = String(payload.actorName || DEMO_CONFIG.DEFAULT_ACTOR);

    switch (action) {
      case "update_status": {
        const nextStatus = String(payload.status || "Pending Approval");
        const reviewerNotes = payload.reviewerNotes ? String(payload.reviewerNotes) : null;

        await callServerPostgrest(
          `/rest/v1/reviews?id=eq.${reviewId}&organisation_id=eq.${DEMO_CONFIG.ORGANISATION_ID}`,
          {
            method: "PATCH",
            useServiceRole: true,
            body: {
              status: nextStatus,
              reviewer_notes: reviewerNotes,
              updated_at: new Date().toISOString(),
            },
          }
        );

        // Log activity
        await callServerPostgrest("/rest/v1/activity_events", {
          method: "POST",
          useServiceRole: true,
          body: {
            id: `demo-act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            organisation_id: DEMO_CONFIG.ORGANISATION_ID,
            review_id: reviewId,
            actor: actorName,
            action: `updated status to ${nextStatus} for`,
            target: reviewTitle,
            type: nextStatus === "Approved" ? "approved" : "changes_requested",
            timestamp: new Date().toISOString(),
          },
        });

        return NextResponse.json({ success: true, reviewId, status: nextStatus });
      }

      case "toggle_finding": {
        const findingId = String(payload.findingId || "");
        if (!findingId) {
          return NextResponse.json({ error: "VALIDATION_ERROR", message: "findingId is required" }, { status: 400 });
        }

        const findingRes = await callServerPostgrest<Array<{ resolved: boolean; title: string }>>(
          `/rest/v1/review_findings?id=eq.${findingId}&review_id=eq.${reviewId}&select=resolved,title`,
          { useServiceRole: true }
        );

        if (!findingRes.data || findingRes.data.length === 0) {
          return NextResponse.json({ error: "NOT_FOUND", message: "Finding not found" }, { status: 404 });
        }

        const nextResolved = !findingRes.data[0].resolved;
        const findingTitle = findingRes.data[0].title;

        await callServerPostgrest(`/rest/v1/review_findings?id=eq.${findingId}&review_id=eq.${reviewId}`, {
          method: "PATCH",
          useServiceRole: true,
          body: {
            resolved: nextResolved,
            resolved_at: nextResolved ? new Date().toISOString() : null,
            resolved_by: nextResolved ? actorName : null,
            updated_at: new Date().toISOString(),
          },
        });

        const newScore = await recomputeDemoReviewScore(reviewId);

        // Log activity
        await callServerPostgrest("/rest/v1/activity_events", {
          method: "POST",
          useServiceRole: true,
          body: {
            id: `demo-act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            organisation_id: DEMO_CONFIG.ORGANISATION_ID,
            review_id: reviewId,
            actor: actorName,
            action: `${nextResolved ? "resolved" : "reopened"} finding "${findingTitle}" in`,
            target: reviewTitle,
            type: nextResolved ? "resolved" : "submitted",
            timestamp: new Date().toISOString(),
          },
        });

        return NextResponse.json({
          success: true,
          reviewId,
          findingId,
          resolved: nextResolved,
          complianceScore: newScore,
        });
      }

      case "apply_correction": {
        const findingId = String(payload.findingId || "");
        const editedText = String(payload.editedText || "").trim();

        if (!findingId || !editedText) {
          return NextResponse.json(
            { error: "VALIDATION_ERROR", message: "findingId and editedText are required" },
            { status: 400 }
          );
        }

        await callServerPostgrest(`/rest/v1/review_findings?id=eq.${findingId}&review_id=eq.${reviewId}`, {
          method: "PATCH",
          useServiceRole: true,
          body: {
            edited_correction: editedText,
            resolved: true,
            resolved_at: new Date().toISOString(),
            resolved_by: actorName,
            updated_at: new Date().toISOString(),
          },
        });

        const newScore = await recomputeDemoReviewScore(reviewId);

        // Log activity
        await callServerPostgrest("/rest/v1/activity_events", {
          method: "POST",
          useServiceRole: true,
          body: {
            id: `demo-act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            organisation_id: DEMO_CONFIG.ORGANISATION_ID,
            review_id: reviewId,
            actor: actorName,
            action: "applied text correction to finding in",
            target: reviewTitle,
            type: "correction_applied",
            timestamp: new Date().toISOString(),
          },
        });

        return NextResponse.json({
          success: true,
          reviewId,
          findingId,
          complianceScore: newScore,
        });
      }

      case "update_decision": {
        const findingId = String(payload.findingId || "");
        const decision = String(payload.decision || "");
        const reason = payload.reason ? String(payload.reason).trim() : null;

        if (!findingId || !decision) {
          return NextResponse.json(
            { error: "VALIDATION_ERROR", message: "findingId and decision are required" },
            { status: 400 }
          );
        }

        if (decision === "REJECT" && !reason) {
          return NextResponse.json(
            { error: "VALIDATION_ERROR", message: "Reason is required when rejecting a finding" },
            { status: 400 }
          );
        }

        await callServerPostgrest(`/rest/v1/review_findings?id=eq.${findingId}&review_id=eq.${reviewId}`, {
          method: "PATCH",
          useServiceRole: true,
          body: {
            review_decision: decision,
            review_decision_reason: reason,
            review_decision_at: new Date().toISOString(),
            review_decision_by: actorName,
            updated_at: new Date().toISOString(),
          },
        });

        // Log activity
        await callServerPostgrest("/rest/v1/activity_events", {
          method: "POST",
          useServiceRole: true,
          body: {
            id: `demo-act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            organisation_id: DEMO_CONFIG.ORGANISATION_ID,
            review_id: reviewId,
            actor: actorName,
            action: `${decision.toLowerCase()} finding in`,
            target: reviewTitle,
            type: "finding_decision",
            timestamp: new Date().toISOString(),
            metadata: { decision, reason },
          },
        });

        return NextResponse.json({ success: true, reviewId, findingId, decision });
      }

      case "add_comment": {
        const findingId = String(payload.findingId || "");
        const commentId = payload.commentId || `demo-cmt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const text = String(payload.text || "").trim();

        if (!findingId || !text) {
          return NextResponse.json(
            { error: "VALIDATION_ERROR", message: "findingId and text are required" },
            { status: 400 }
          );
        }

        await callServerPostgrest("/rest/v1/review_comments", {
          method: "POST",
          useServiceRole: true,
          body: {
            id: commentId,
            review_id: reviewId,
            finding_id: findingId,
            author: actorName,
            role: DEMO_CONFIG.DEFAULT_ROLE,
            text,
            created_at: new Date().toISOString(),
          },
        });

        // Log activity
        await callServerPostgrest("/rest/v1/activity_events", {
          method: "POST",
          useServiceRole: true,
          body: {
            id: `demo-act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            organisation_id: DEMO_CONFIG.ORGANISATION_ID,
            review_id: reviewId,
            actor: actorName,
            action: "commented on finding in",
            target: reviewTitle,
            type: "comment_added",
            timestamp: new Date().toISOString(),
          },
        });

        return NextResponse.json({ success: true, commentId, reviewId, findingId });
      }

      case "add_manual_finding": {
        const findingId = payload.findingId || `demo-f-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const cleanFindingTitle = String(payload.title || "").trim();

        if (!cleanFindingTitle) {
          return NextResponse.json(
            { error: "VALIDATION_ERROR", message: "Finding title is required" },
            { status: 400 }
          );
        }

        await callServerPostgrest("/rest/v1/review_findings", {
          method: "POST",
          useServiceRole: true,
          body: {
            id: findingId,
            review_id: reviewId,
            rule_id: payload.ruleId || null,
            category: payload.category || "Manual Governance",
            title: cleanFindingTitle,
            description: payload.description || "",
            severity: payload.severity || "medium",
            evidence_status: payload.evidenceStatus || "unverified",
            detected_value: payload.detectedValue || "",
            expected_value: payload.expectedValue || "",
            source_reference: payload.sourceReference || "",
            recommendation: payload.recommendation || "",
            affected_content: payload.affectedContent || "",
            resolved: false,
          },
        });

        const newScore = await recomputeDemoReviewScore(reviewId);

        // Log activity
        await callServerPostgrest("/rest/v1/activity_events", {
          method: "POST",
          useServiceRole: true,
          body: {
            id: `demo-act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            organisation_id: DEMO_CONFIG.ORGANISATION_ID,
            review_id: reviewId,
            actor: actorName,
            action: `added manual finding "${cleanFindingTitle}" to`,
            target: reviewTitle,
            type: "manual_finding_added",
            timestamp: new Date().toISOString(),
          },
        });

        return NextResponse.json({
          success: true,
          findingId,
          reviewId,
          complianceScore: newScore,
        });
      }

      default:
        return NextResponse.json({ error: "BAD_ACTION", message: `Unknown demo action "${action}"` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
