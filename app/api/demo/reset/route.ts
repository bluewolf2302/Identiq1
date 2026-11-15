import { NextRequest, NextResponse } from "next/server";
import { checkDemoRateLimit, DEMO_CONFIG } from "@/lib/demo/config";
import { resetDemoWorkspaceRecords } from "@/lib/demo/seed";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "anonymous-demo-client";
}

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);
  const rate = checkDemoRateLimit(clientIp, "reset");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMIT_EXCEEDED", message: "Too many reset attempts. Please wait." },
      { status: 429, headers: { "Retry-After": String(rate.resetSeconds) } }
    );
  }

  try {
    await resetDemoWorkspaceRecords();

    return NextResponse.json({
      success: true,
      message: "Shared demo workspace restored to initial hosted database state.",
      organisationId: DEMO_CONFIG.ORGANISATION_ID,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: err instanceof Error ? err.message : "Failed to reset demo workspace" },
      { status: 500 }
    );
  }
}
