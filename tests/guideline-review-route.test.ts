import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { POST } from "../app/api/guideline-review/extract/route";
import { PdfExtractionResultSchema } from "../lib/guidelines/types";

const samplePdfPath = path.join(
  process.cwd(),
  "sample-data",
  "teralune",
  "brand-identity-guidelines.pdf",
);

function makeUploadRequest(file: File): Request {
  const formData = new FormData();
  formData.set("file", file);
  return new Request("http://localhost/api/guideline-review/extract", {
    method: "POST",
    body: formData,
  });
}

test("extracts the real sample guideline PDF through the upload route", async () => {
  const bytes = await readFile(samplePdfPath);
  const file = new File([bytes], "brand-identity-guidelines.pdf", {
    type: "application/pdf",
  });
  const response = await POST(makeUploadRequest(file));
  const body: unknown = await response.json();
  const parsedBody = z
    .object({ extraction: PdfExtractionResultSchema })
    .strict()
    .parse(body);
  const extraction = parsedBody.extraction;

  assert.equal(response.status, 200);
  assert.ok(extraction.totalPageCount > 1);
  assert.ok(extraction.pages.some((page) => page.text.includes("Teralune")));
  assert.ok(
    extraction.pages.every((page, index) => page.pageNumber === index + 1),
  );
});

test("returns a validation error for a non-PDF upload", async () => {
  const file = new File(["not a PDF"], "notes.txt", { type: "text/plain" });
  const response = await POST(makeUploadRequest(file));
  const body: unknown = await response.json();
  const parsedBody = z
    .object({
      error: z.object({ code: z.string() }).passthrough(),
    })
    .passthrough()
    .parse(body);

  assert.equal(response.status, 400);
  assert.equal(parsedBody.error.code, "INVALID_FILE_TYPE");
});
