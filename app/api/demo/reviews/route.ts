import { NextRequest, NextResponse } from "next/server";
import { DEMO_CONFIG, checkDemoRateLimit } from "@/lib/demo/config";
import { callServerPostgrest } from "@/lib/supabase/server";
import { seedDemoRecords } from "@/lib/demo/seed";
import { ReviewSubmission, ReviewFinding, ReviewComment, ContentType, FindingCategory } from "@/lib/types";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "anonymous-demo-client";
}

export async function GET(req: NextRequest) {
  const clientIp = getClientIp(req);
  const rate = checkDemoRateLimit(clientIp, "read");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMIT_EXCEEDED", message: "Too many demo requests. Please wait." },
      { status: 429, headers: { "Retry-After": String(rate.resetSeconds) } }
    );
  }

  try {
    // 1. Fetch demo reviews with nested findings and comments
    const query = `/rest/v1/reviews?organisation_id=eq.${DEMO_CONFIG.ORGANISATION_ID}&select=*,review_findings(*,review_comments(*))&order=submitted_at.desc`;
    let res = await callServerPostgrest<Record<string, unknown>[]>(query, { useServiceRole: true });

    // 2. Auto-seed if demo workspace is uninitialized
    if (!res.data || res.data.length === 0) {
      await seedDemoRecords();
      res = await callServerPostgrest<Record<string, unknown>[]>(query, { useServiceRole: true });
    }

    if (res.error) {
      return NextResponse.json(
        { error: res.error.code, message: res.error.message },
        { status: res.status || 500 }
      );
    }

    const rows = Array.isArray(res.data) ? res.data : [];

    // Map database entities to ReviewSubmission domain objects
    const mappedReviews: ReviewSubmission[] = rows.map((row) => {
      const rawFindings = Array.isArray(row.review_findings)
        ? (row.review_findings as Record<string, unknown>[])
        : [];

      const findings: ReviewFinding[] = rawFindings.map((f) => {
        const rawComments = Array.isArray(f.review_comments)
          ? (f.review_comments as Record<string, unknown>[])
          : [];

        const comments: ReviewComment[] = rawComments.map((c) => ({
          id: String(c.id),
          author: String(c.author || "Reviewer"),
          role: String(c.role || "Reviewer"),
          text: String(c.text || ""),
          createdAt: String(c.created_at || ""),
        }));

        return {
          id: String(f.id),
          ruleId: (f.rule_id as string) || undefined,
          category: (f.category as FindingCategory) || "Brand Claims",
          title: String(f.title || ""),
          description: String(f.description || ""),
          severity: (f.severity as "high" | "medium" | "low") || "medium",
          evidenceStatus: (f.evidence_status as "supported" | "conflicting" | "unverified") || "unverified",
          detectedValue: String(f.detected_value || ""),
          expectedValue: String(f.expected_value || ""),
          sourceReference: String(f.source_reference || ""),
          recommendation: String(f.recommendation || ""),
          affectedContent: String(f.affected_content || ""),
          resolved: Boolean(f.resolved),
          resolvedAt: (f.resolved_at as string) || undefined,
          resolvedBy: (f.resolved_by as string) || undefined,
          editedCorrection: (f.edited_correction as string) || undefined,
          reviewDecision: ["APPROVE", "REQUEST_CHANGES", "REJECT"].includes(f.review_decision as string)
            ? (f.review_decision as "APPROVE" | "REQUEST_CHANGES" | "REJECT")
            : undefined,
          reviewDecisionReason: (f.review_decision_reason as string) || undefined,
          reviewDecisionAt: (f.review_decision_at as string) || undefined,
          reviewDecisionBy: (f.review_decision_by as string) || undefined,
          comments,
        };
      });

      return {
        id: String(row.id),
        title: String(row.title || ""),
        contentType: (row.content_type as ContentType) || "Campaign Copy",
        guidelineCollection: String(row.guideline_collection || "Default Guidelines"),
        submittedBy: String(row.submitted_by || "Demo User"),
        submittedAt: String(row.submitted_at || row.created_at || ""),
        status: (row.status as ReviewSubmission["status"]) || "Pending Approval",
        complianceScore: Number(row.compliance_score ?? 100),
        textContent: String(row.text_content || ""),
        assetUrl: (row.asset_url as string) || undefined,
        assetName: (row.asset_name as string) || undefined,
        pastelTheme: (row.pastel_theme as ReviewSubmission["pastelTheme"]) || "blue",
        reviewerNotes: (row.reviewer_notes as string) || undefined,
        providerUsed: (row.provider_used as ReviewSubmission["providerUsed"]) || undefined,
        findings,
      };
    });

    return NextResponse.json(mappedReviews, {
      headers: {
        "X-Demo-Workspace": "IdentIQ-Shared-Demo",
        "X-Demo-Organisation": DEMO_CONFIG.ORGANISATION_ID,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);
  const rate = checkDemoRateLimit(clientIp, "mutation");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMIT_EXCEEDED", message: "Too many demo mutations. Please wait." },
      { status: 429, headers: { "Retry-After": String(rate.resetSeconds) } }
    );
  }

  try {
    const body = await req.json();
    const reviewId = body.id || `demo-rev-${Date.now()}`;
    const cleanTitle = String(body.title || "").trim();

    if (!cleanTitle) {
      return NextResponse.json({ error: "VALIDATION_ERROR", message: "Title is required" }, { status: 400 });
    }

    // Insert demo review (strictly pinned to DEMO_CONFIG.ORGANISATION_ID)
    const reviewRes = await callServerPostgrest("/rest/v1/reviews", {
      method: "POST",
      useServiceRole: true,
      body: {
        id: reviewId,
        organisation_id: DEMO_CONFIG.ORGANISATION_ID,
        brand_id: DEMO_CONFIG.BRAND_ID,
        title: cleanTitle,
        content_type: body.contentType || "Campaign Copy",
        guideline_collection: body.guidelineCollection || DEMO_CONFIG.BRAND_NAME,
        submitted_by: body.submittedBy || DEMO_CONFIG.DEFAULT_ACTOR,
        submitted_at: new Date().toISOString(),
        status: "Pending Approval",
        compliance_score: typeof body.complianceScore === "number" ? body.complianceScore : 100,
        base_score: typeof body.complianceScore === "number" ? body.complianceScore : 100,
        text_content: body.textContent || "",
        asset_url: body.assetUrl || null,
        asset_name: body.assetName || null,
        pastel_theme: body.pastelTheme || "blue",
      },
    });

    if (reviewRes.error) {
      return NextResponse.json({ error: reviewRes.error.code, message: reviewRes.error.message }, { status: 500 });
    }

    // Insert findings if provided
    if (Array.isArray(body.findings)) {
      for (const f of body.findings) {
        const findingId = f.id || `demo-f-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await callServerPostgrest("/rest/v1/review_findings", {
          method: "POST",
          useServiceRole: true,
          body: {
            id: findingId,
            review_id: reviewId,
            rule_id: f.ruleId || null,
            category: f.category || "General",
            title: f.title || "Review issue",
            description: f.description || "",
            severity: f.severity || "medium",
            evidence_status: f.evidenceStatus || "unverified",
            detected_value: f.detectedValue || "",
            expected_value: f.expectedValue || "",
            source_reference: f.sourceReference || "",
            recommendation: f.recommendation || "",
            affected_content: f.affectedContent || "",
            resolved: Boolean(f.resolved),
          },
        });
      }
    }

    // Log activity event
    await callServerPostgrest("/rest/v1/activity_events", {
      method: "POST",
      useServiceRole: true,
      body: {
        id: `demo-act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        organisation_id: DEMO_CONFIG.ORGANISATION_ID,
        review_id: reviewId,
        actor: body.submittedBy || DEMO_CONFIG.DEFAULT_ACTOR,
        action: "submitted creative review:",
        target: cleanTitle,
        type: "submitted",
        timestamp: new Date().toISOString(),
        metadata: { contentType: body.contentType || "Campaign Copy" },
      },
    });

    return NextResponse.json({
      success: true,
      reviewId,
      organisationId: DEMO_CONFIG.ORGANISATION_ID,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
