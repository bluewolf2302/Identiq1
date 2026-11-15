/**
 * Server-Side Demo Seeding & Provisioning Helper
 *
 * Ensures the dedicated demo organization, brand, reviews, findings, and activity events
 * exist on the hosted Supabase database without touching customer records.
 */

import { DEMO_CONFIG } from "./config";
import { callServerPostgrest } from "../supabase/server";
import { INITIAL_REVIEWS, INITIAL_ACTIVITY } from "../seed-data";

/**
 * Ensure the demo organization and demo brand exist in the database.
 */
export async function ensureDemoTenancy(): Promise<{ orgId: string; brandId: string }> {
  // Check if demo organization exists
  const orgCheck = await callServerPostgrest<Array<{ id: string }>>(
    `/rest/v1/organisations?id=eq.${DEMO_CONFIG.ORGANISATION_ID}&select=id`,
    { useServiceRole: true }
  );

  if (!orgCheck.data || orgCheck.data.length === 0) {
    // Insert demo organization with fixed ID
    const insertOrgRes = await callServerPostgrest("/rest/v1/organisations", {
      method: "POST",
      useServiceRole: true,
      body: {
        id: DEMO_CONFIG.ORGANISATION_ID,
        name: DEMO_CONFIG.ORGANISATION_NAME,
      },
    });

    if (insertOrgRes.error) {
      throw new Error(
        `Failed to provision demo organisation (${insertOrgRes.status}): ${insertOrgRes.error.message}`
      );
    }
  }

  // Check if demo brand exists
  const brandCheck = await callServerPostgrest<Array<{ id: string }>>(
    `/rest/v1/brands?id=eq.${DEMO_CONFIG.BRAND_ID}&select=id`,
    { useServiceRole: true }
  );

  if (!brandCheck.data || brandCheck.data.length === 0) {
    // Insert demo brand with fixed ID
    const insertBrandRes = await callServerPostgrest("/rest/v1/brands", {
      method: "POST",
      useServiceRole: true,
      body: {
        id: DEMO_CONFIG.BRAND_ID,
        organisation_id: DEMO_CONFIG.ORGANISATION_ID,
        name: DEMO_CONFIG.BRAND_NAME,
        approved: true,
      },
    });

    if (insertBrandRes.error) {
      throw new Error(
        `Failed to provision demo brand (${insertBrandRes.status}): ${insertBrandRes.error.message}`
      );
    }
  }

  return {
    orgId: DEMO_CONFIG.ORGANISATION_ID,
    brandId: DEMO_CONFIG.BRAND_ID,
  };
}

/**
 * Seed initial sample reviews, findings, comments, and activities into demo organisation.
 */
export async function seedDemoRecords(): Promise<void> {
  await ensureDemoTenancy();

  // Check if reviews already exist
  const existingReviews = await callServerPostgrest<Array<{ id: string }>>(
    `/rest/v1/reviews?organisation_id=eq.${DEMO_CONFIG.ORGANISATION_ID}&select=id&limit=1`,
    { useServiceRole: true }
  );

  if (existingReviews.data && existingReviews.data.length > 0) {
    return; // Already seeded
  }

  // Insert standard seed reviews
  for (const rev of INITIAL_REVIEWS) {
    const demoRevId = `demo-${rev.id}`;
    const insertReviewRes = await callServerPostgrest("/rest/v1/reviews", {
      method: "POST",
      useServiceRole: true,
      body: {
        id: demoRevId,
        organisation_id: DEMO_CONFIG.ORGANISATION_ID,
        brand_id: DEMO_CONFIG.BRAND_ID,
        title: rev.title,
        content_type: rev.contentType,
        guideline_collection: rev.guidelineCollection,
        submitted_by: rev.submittedBy,
        submitted_at: rev.submittedAt ? new Date(rev.submittedAt).toISOString() : new Date().toISOString(),
        status: rev.status,
        compliance_score: rev.complianceScore,
        base_score: rev.complianceScore,
        text_content: rev.textContent || "",
        asset_url: rev.assetUrl || null,
        asset_name: rev.assetName || null,
        pastel_theme: rev.pastelTheme || "blue",
        reviewer_notes: rev.reviewerNotes || null,
        provider_used: rev.providerUsed || "demo",
        analysis_status: "COMPLETED",
      },
    });

    if (insertReviewRes.error) {
      throw new Error(
        `Failed to seed demo review "${demoRevId}" (${insertReviewRes.status}): ${insertReviewRes.error.message}`
      );
    }

    // Insert findings
    for (const f of rev.findings) {
      const demoFindingId = `demo-${f.id}`;
      await callServerPostgrest("/rest/v1/review_findings", {
        method: "POST",
        useServiceRole: true,
        body: {
          id: demoFindingId,
          review_id: demoRevId,
          rule_id: f.ruleId || null,
          category: f.category,
          title: f.title,
          description: f.description || "",
          severity: f.severity,
          evidence_status: f.evidenceStatus || "unverified",
          detected_value: f.detectedValue || "",
          expected_value: f.expectedValue || "",
          source_reference: f.sourceReference || "",
          recommendation: f.recommendation || "",
          affected_content: f.affectedContent || "",
          resolved: f.resolved || false,
          resolved_at: f.resolvedAt || null,
          resolved_by: f.resolvedBy || null,
          edited_correction: f.editedCorrection || null,
          review_decision: f.reviewDecision || null,
          review_decision_reason: f.reviewDecisionReason || null,
          review_decision_at: f.reviewDecisionAt || null,
          review_decision_by: f.reviewDecisionBy || null,
        },
      });

      // Insert comments
      for (const c of f.comments) {
        await callServerPostgrest("/rest/v1/review_comments", {
          method: "POST",
          useServiceRole: true,
          body: {
            id: `demo-${c.id}`,
            review_id: demoRevId,
            finding_id: demoFindingId,
            author: c.author,
            role: c.role,
            text: c.text,
            created_at: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
          },
        });
      }
    }
  }

  // Insert initial activities
  for (const act of INITIAL_ACTIVITY) {
    const demoActId = `demo-${act.id}`;
    const mappedRevId = act.reviewId ? `demo-${act.reviewId}` : null;
    await callServerPostgrest("/rest/v1/activity_events", {
      method: "POST",
      useServiceRole: true,
      body: {
        id: demoActId,
        organisation_id: DEMO_CONFIG.ORGANISATION_ID,
        review_id: mappedRevId,
        actor: act.actor,
        action: act.action,
        target: act.target,
        type: act.type,
        timestamp: act.timestamp ? new Date(act.timestamp).toISOString() : new Date().toISOString(),
        metadata: (act as unknown as { metadata?: Record<string, unknown> }).metadata || {},
      },
    });
  }
}

/**
 * Strictly reset ONLY demo workspace records.
 * Leaves all customer / non-demo organizations completely untouched.
 */
export async function resetDemoWorkspaceRecords(): Promise<void> {
  const orgFilter = `organisation_id=eq.${DEMO_CONFIG.ORGANISATION_ID}`;

  // 1. Delete demo activity events
  await callServerPostgrest(`/rest/v1/activity_events?${orgFilter}`, {
    method: "DELETE",
    useServiceRole: true,
  });

  // 2. Fetch demo review IDs to cascade delete comments and findings cleanly
  const demoReviews = await callServerPostgrest<Array<{ id: string }>>(
    `/rest/v1/reviews?${orgFilter}&select=id`,
    { useServiceRole: true }
  );

  if (demoReviews.data && demoReviews.data.length > 0) {
    const reviewIds = demoReviews.data.map((r) => `"${r.id}"`).join(",");

    // Delete comments for demo reviews
    await callServerPostgrest(`/rest/v1/review_comments?review_id=in.(${reviewIds})`, {
      method: "DELETE",
      useServiceRole: true,
    });

    // Delete findings for demo reviews
    await callServerPostgrest(`/rest/v1/review_findings?review_id=in.(${reviewIds})`, {
      method: "DELETE",
      useServiceRole: true,
    });

    // Delete demo reviews
    await callServerPostgrest(`/rest/v1/reviews?${orgFilter}`, {
      method: "DELETE",
      useServiceRole: true,
    });
  }

  // 3. Re-seed fresh demo data
  await seedDemoRecords();
}
