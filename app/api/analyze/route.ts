import { NextRequest, NextResponse } from "next/server";
import { createAnalysisOrchestrator } from "@/lib/analysis/composition-root";
import { handleAnalysisRequest } from "@/lib/analysis/api-handler";
import { resolveServerApiTenantContext } from "@/lib/brand-context/server-api-auth";

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "The analysis request body must be valid JSON." },
        { status: 400 },
      );
    }

    const bodyRecord =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    const requestedOrgId =
      bodyRecord && typeof bodyRecord.organisationId === "string"
        ? bodyRecord.organisationId
        : null;

    const authHeader = req.headers.get("authorization");
    let effectiveBody = body;
    if (authHeader || requestedOrgId) {
      const tenant = await resolveServerApiTenantContext(req, {
        requestedOrganisationId: requestedOrgId,
        isMutation: false,
      });
      if (!tenant.ok) {
        return NextResponse.json(
          { error: tenant.error },
          { status: tenant.status },
        );
      }
      if (bodyRecord) {
        effectiveBody = {
          ...bodyRecord,
          organisationId: tenant.organisationId,
        };
      }
    }

    const result = await handleAnalysisRequest(effectiveBody, {
      orchestrator: createAnalysisOrchestrator(),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error(
      "Unhandled API analysis error:",
      err instanceof Error ? err.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "Unable to complete brand governance analysis." },
      { status: 500 },
    );
  }
}
