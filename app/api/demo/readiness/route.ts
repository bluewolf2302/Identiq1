import { connection, NextResponse } from "next/server";
import { evaluateDemoReadiness } from "@/lib/demo/teralune-server-samples";

export async function GET() {
  try {
    await connection();
  } catch {
    // Allow direct test invocation outside Next request storage
  }
  const report = await evaluateDemoReadiness();
  return NextResponse.json(report, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
