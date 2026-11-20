import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AnalysisComparisonSchema,
  type AnalysisComparison,
} from "@/lib/analysis/comparison";
import { getUser } from "@/lib/supabase/auth";
import { callServerPostgrest } from "@/lib/supabase/server";

const ComparisonRequestSchema = z
  .object({
    reviewId: z.string().trim().min(1).max(200),
    organisationId: z.string().uuid(),
    comparison: AnalysisComparisonSchema,
  })
  .strict()
  .refine(
    (request) =>
      request.comparison.previousRunId !== request.comparison.currentRunId,
    {
      message: "Previous and current analysis runs must be different.",
      path: ["comparison", "currentRunId"],
    },
  );

type AuthenticatedUser = {
  id: string;
  token: string;
};

type AuthResult =
  | { user: AuthenticatedUser }
  | { response: NextResponse };

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const authorization = req.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

async function authenticate(req: NextRequest): Promise<AuthResult> {
  const token = getBearerToken(req);
  if (!token) {
    return { response: errorResponse("Authentication is required.", 401) };
  }

  const result = await getUser(token);
  if (!result.data?.id || result.error) {
    return {
      response:
        result.error?.status === 0
          ? errorResponse("Authentication service is unavailable.", 503)
          : errorResponse("Authentication is invalid or expired.", 401),
    };
  }

  return { user: { id: result.data.id, token } };
}

function dependencyErrorStatus(status: number): number {
  if (status === 0) return 503;
  if (status === 401) return 401;
  if (status === 403) return 403;
  return 502;
}

async function verifyOrganisationMembership(
  user: AuthenticatedUser,
  organisationId: string,
): Promise<NextResponse | null> {
  const result = await callServerPostgrest<
    Array<{ organisation_id: string; user_id: string }>
  >(
    `/rest/v1/organisation_members?organisation_id=eq.${encodeURIComponent(organisationId)}&user_id=eq.${encodeURIComponent(user.id)}&select=organisation_id,user_id&limit=1`,
    { userToken: user.token },
  );
  if (result.error) {
    return errorResponse(
      "Unable to verify organisation access.",
      dependencyErrorStatus(result.status),
    );
  }
  if (
    !result.data?.some(
      (membership) =>
        membership.organisation_id === organisationId &&
        membership.user_id === user.id,
    )
  ) {
    return errorResponse("You do not have access to this organisation.", 403);
  }
  return null;
}

async function getVisibleReview(
  user: AuthenticatedUser,
  reviewId: string,
): Promise<
  | { review: { id: string; organisation_id: string; analysis_run_id: string | null } }
  | { response: NextResponse }
> {
  const result = await callServerPostgrest<
    Array<{ id: string; organisation_id: string; analysis_run_id: string | null }>
  >(
    `/rest/v1/reviews?id=eq.${encodeURIComponent(reviewId)}&select=id,organisation_id,analysis_run_id&limit=1`,
    { userToken: user.token },
  );
  if (result.error) {
    return {
      response: errorResponse(
        "Unable to verify review access.",
        dependencyErrorStatus(result.status),
      ),
    };
  }
  const review = result.data?.[0];
  if (!review) {
    return {
      response: errorResponse(
        "Review was not found or is not accessible to this user.",
        403,
      ),
    };
  }
  return { review };
}

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;

  const reviewId = req.nextUrl.searchParams.get("reviewId")?.trim();
  if (!reviewId) {
    return errorResponse("reviewId is required.", 400);
  }

  const visibleReview = await getVisibleReview(auth.user, reviewId);
  if ("response" in visibleReview) return visibleReview.response;

  const membershipError = await verifyOrganisationMembership(
    auth.user,
    visibleReview.review.organisation_id,
  );
  if (membershipError) return membershipError;

  const result = await callServerPostgrest<
    Array<{ comparison: unknown }>
  >(
    `/rest/v1/analysis_comparisons?review_id=eq.${encodeURIComponent(reviewId)}&organisation_id=eq.${encodeURIComponent(visibleReview.review.organisation_id)}&select=comparison&order=created_at.desc&limit=1`,
    { userToken: auth.user.token },
  );
  if (result.error) {
    return errorResponse(
      "Unable to load analysis comparison.",
      dependencyErrorStatus(result.status),
    );
  }

  const rawComparison = result.data?.[0]?.comparison;
  if (rawComparison === undefined) {
    return NextResponse.json({ comparison: null });
  }
  const comparison = AnalysisComparisonSchema.safeParse(rawComparison);
  if (!comparison.success) {
    return errorResponse("Stored analysis comparison is invalid.", 502);
  }
  return NextResponse.json({ comparison: comparison.data });
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const parsed = ComparisonRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid analysis comparison payload.", 400);
  }
  const payload = parsed.data;

  const membershipError = await verifyOrganisationMembership(
    auth.user,
    payload.organisationId,
  );
  if (membershipError) return membershipError;

  const currentReviewResult = await callServerPostgrest<
    Array<{
      id: string;
      organisation_id: string;
      analysis_run_id: string | null;
      previous_analysis_run_id: string | null;
    }>
  >(
    `/rest/v1/reviews?id=eq.${encodeURIComponent(payload.reviewId)}&select=id,organisation_id,analysis_run_id,previous_analysis_run_id&limit=1`,
    { userToken: auth.user.token },
  );
  if (currentReviewResult.error) {
    return errorResponse(
      "Unable to verify review ownership.",
      dependencyErrorStatus(currentReviewResult.status),
    );
  }
  const currentReview = currentReviewResult.data?.[0];
  if (!currentReview || currentReview.organisation_id !== payload.organisationId) {
    return errorResponse("Review is not owned by the authorised organisation.", 403);
  }
  if (currentReview.analysis_run_id !== payload.comparison.currentRunId) {
    return errorResponse("Current analysis run does not belong to this review.", 400);
  }
  const previousReviewResult = await callServerPostgrest<
    Array<{ id: string; organisation_id: string }>
  >(
    `/rest/v1/reviews?analysis_run_id=eq.${encodeURIComponent(payload.comparison.previousRunId)}&organisation_id=eq.${encodeURIComponent(payload.organisationId)}&select=id,organisation_id&limit=1`,
    { userToken: auth.user.token },
  );
  if (previousReviewResult.error) {
    return errorResponse(
      "Unable to verify the previous analysis run.",
      dependencyErrorStatus(previousReviewResult.status),
    );
  }
  if (
    !previousReviewResult.data?.some(
      (review) => review.organisation_id === payload.organisationId,
    )
  ) {
    return errorResponse(
      "Previous analysis run is not owned by the authorised organisation.",
      403,
    );
  }
  if (
    !currentReview.previous_analysis_run_id ||
    currentReview.previous_analysis_run_id !== payload.comparison.previousRunId
  ) {
    return errorResponse(
      "Previous analysis run does not match this review's re-analysis lineage.",
      400,
    );
  }

  const comparison: AnalysisComparison = payload.comparison;
  const id = `cmp-${comparison.currentRunId}-${comparison.previousRunId}`;
  const insert = await callServerPostgrest(
    "/rest/v1/analysis_comparisons",
    {
      method: "POST",
      userToken: auth.user.token,
      body: {
        id,
        review_id: payload.reviewId,
        organisation_id: payload.organisationId,
        previous_run_id: comparison.previousRunId,
        current_run_id: comparison.currentRunId,
        comparison,
      },
    },
  );
  if (insert.error) {
    return errorResponse(
      "Unable to save analysis comparison.",
      dependencyErrorStatus(insert.status),
    );
  }
  return NextResponse.json({ comparison });
}
