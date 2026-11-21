import { NextRequest, NextResponse } from "next/server";
import { readTeraluneSamplePdf } from "@/lib/demo/teralune-server-samples";

export async function GET(request: NextRequest) {
  try {
    const sampleParam = request.nextUrl.searchParams.get("sample");
    const loaded = await readTeraluneSamplePdf(sampleParam);
    return NextResponse.json(loaded);
  } catch {
    return NextResponse.json(
      { error: "Teralune sample advertisement PDF is unavailable." },
      { status: 404 },
    );
  }
}
