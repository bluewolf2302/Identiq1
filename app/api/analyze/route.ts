import { NextRequest, NextResponse } from "next/server";
import { createAnalysisOrchestrator } from "@/lib/analysis/composition-root";
import { handleAnalysisRequest } from "@/lib/analysis/api-handler";

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

    const result = await handleAnalysisRequest(body, {
      orchestrator: createAnalysisOrchestrator(),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("Unhandled API analysis error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error during analysis." },
      { status: 500 },
    );
  }
}
