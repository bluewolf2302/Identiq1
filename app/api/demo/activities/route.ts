import { NextRequest, NextResponse } from "next/server";
import { DEMO_CONFIG, checkDemoRateLimit } from "@/lib/demo/config";
import { callServerPostgrest } from "@/lib/supabase/server";
import { ActivityEvent } from "@/lib/types";

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
    const query = `/rest/v1/activity_events?organisation_id=eq.${DEMO_CONFIG.ORGANISATION_ID}&order=timestamp.desc&limit=100`;
    const res = await callServerPostgrest<Record<string, unknown>[]>(query, { useServiceRole: true });

    if (res.error) {
      return NextResponse.json(
        { error: res.error.code, message: res.error.message },
        { status: res.status || 500 }
      );
    }

    const rows = Array.isArray(res.data) ? res.data : [];

    const activities: ActivityEvent[] = rows.map((r) => ({
      id: String(r.id),
      reviewId: (r.review_id as string) || undefined,
      actor: String(r.actor || DEMO_CONFIG.DEFAULT_ACTOR),
      action: String(r.action || ""),
      target: String(r.target || ""),
      timestamp: String(r.timestamp || new Date().toISOString()),
      type: (r.type as ActivityEvent["type"]) || "submitted",
      metadata: (r.metadata as Record<string, unknown>) || undefined,
    }));

    return NextResponse.json(activities, {
      headers: {
        "X-Demo-Workspace": "IdentIQ-Shared-Demo",
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
    const eventId = body.id || `demo-act-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const res = await callServerPostgrest("/rest/v1/activity_events", {
      method: "POST",
      useServiceRole: true,
      body: {
        id: eventId,
        organisation_id: DEMO_CONFIG.ORGANISATION_ID,
        review_id: body.reviewId || null,
        actor: body.actor || DEMO_CONFIG.DEFAULT_ACTOR,
        action: body.action || "performed demo action:",
        target: body.target || "Demo Asset",
        type: body.type || "submitted",
        timestamp: new Date().toISOString(),
        metadata: body.metadata || {},
      },
    });

    if (res.error) {
      return NextResponse.json({ error: res.error.code, message: res.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, eventId });
  } catch (err) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
