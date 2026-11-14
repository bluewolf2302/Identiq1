import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const filePath = path.join(
      process.cwd(),
      "sample-data",
      "teralune",
      "test-advertisement.pdf",
    );
    const buffer = await fs.readFile(filePath);
    return NextResponse.json({
      fileName: "test-advertisement.pdf",
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      base64Data: buffer.toString("base64"),
    });
  } catch {
    return NextResponse.json(
      { error: "Teralune sample advertisement PDF is unavailable." },
      { status: 404 },
    );
  }
}
