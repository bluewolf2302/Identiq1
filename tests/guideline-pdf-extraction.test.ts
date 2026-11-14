import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  extractGuidelinePdfText,
  MAX_GUIDELINE_PDF_SIZE_BYTES,
} from "../lib/guidelines/pdf-extraction";
import { GuidelinePdfExtractionError } from "../lib/guidelines/types";

const samplePdfPath = path.join(
  process.cwd(),
  "sample-data",
  "teralune",
  "brand-identity-guidelines.pdf",
);

function extractionInput(
  data: Uint8Array | ArrayBuffer,
  overrides: Partial<{
    fileName: string;
    mimeType: string;
  }> = {},
) {
  return {
    fileName: overrides.fileName ?? "guidelines.pdf",
    mimeType: overrides.mimeType ?? "application/pdf",
    data,
  };
}

function createPdf(objects: string[], trailerEntries = ""): Uint8Array {
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerEntries} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "ascii"));
}

function createBlankOnePagePdf(): Uint8Array {
  return createPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ]);
}

function createPasswordProtectedOnePagePdf(): Uint8Array {
  const identifier = "11".repeat(16);
  return createPdf(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>",
      "<< /Length 0 >>\nstream\n\nendstream",
      `<< /Filter /Standard /V 1 /R 2 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> /P -4 >>`,
    ],
    `/Encrypt 5 0 R /ID [<${identifier}> <${identifier}>]`,
  );
}

function createTextOnePagePdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  return createPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}

test("extracts real sample guideline PDF text page by page", async () => {
  const bytes = new Uint8Array(await readFile(samplePdfPath));
  const result = await extractGuidelinePdfText(extractionInput(bytes, {
    fileName: "brand-identity-guidelines.pdf",
  }));

  assert.equal(result.fileName, "brand-identity-guidelines.pdf");
  assert.equal(result.status, "TEXT_EXTRACTED");
  assert.ok(result.totalPageCount > 1, "sample guideline should span multiple pages");
  assert.equal(result.pages.length, result.totalPageCount);
  assert.ok(result.pages.some((page) => page.text.includes("Teralune")));
  assert.ok(
    result.pages.every((page, index) => page.pageNumber === index + 1),
    "page numbers should be accurate and 1-based",
  );
  assert.ok(result.pages.every((page) => page.status === "TEXT_EXTRACTED"));
});

test("returns PDF.js page text without additional normalization", async () => {
  const result = await extractGuidelinePdfText(
    extractionInput(createTextOnePagePdf("  Exact source text  ")),
  );

  assert.equal(result.pages[0]?.text, "Exact source text");
});

test("rejects empty files and incorrect media types", async () => {
  await assert.rejects(
    extractGuidelinePdfText(extractionInput(new Uint8Array())),
    (error: unknown) =>
      error instanceof GuidelinePdfExtractionError && error.code === "EMPTY_FILE",
  );
  await assert.rejects(
    extractGuidelinePdfText(
      extractionInput(new Uint8Array(Buffer.from("%PDF-1.4")), {
        mimeType: "text/plain",
      }),
    ),
    (error: unknown) =>
      error instanceof GuidelinePdfExtractionError &&
      error.code === "INVALID_FILE_TYPE",
  );
});

test("rejects files that exceed the maximum size before parsing", async () => {
  const oversized = new Uint8Array(MAX_GUIDELINE_PDF_SIZE_BYTES + 1);
  await assert.rejects(
    extractGuidelinePdfText(extractionInput(oversized)),
    (error: unknown) =>
      error instanceof GuidelinePdfExtractionError &&
      error.code === "FILE_TOO_LARGE",
  );
});

test("rejects invalid signatures and malformed PDFs", async () => {
  await assert.rejects(
    extractGuidelinePdfText(
      extractionInput(new Uint8Array(Buffer.from("not a PDF"))),
    ),
    (error: unknown) =>
      error instanceof GuidelinePdfExtractionError &&
      error.code === "INVALID_PDF_SIGNATURE",
  );
  await assert.rejects(
    extractGuidelinePdfText(
      extractionInput(
        new Uint8Array(Buffer.from("%PDF-1.4\nnot a valid PDF\n%%EOF")),
      ),
    ),
    (error: unknown) =>
      error instanceof GuidelinePdfExtractionError &&
      error.code === "MALFORMED_PDF",
  );
});

test("reports password-protected PDFs that require a password", async () => {
  await assert.rejects(
    extractGuidelinePdfText(
      extractionInput(createPasswordProtectedOnePagePdf()),
    ),
    (error: unknown) =>
      error instanceof GuidelinePdfExtractionError &&
      error.code === "ENCRYPTED_PDF",
  );
});

test("returns a valid no-text result for a PDF without a text layer", async () => {
  const result = await extractGuidelinePdfText(
    extractionInput(createBlankOnePagePdf()),
  );

  assert.equal(result.totalPageCount, 1);
  assert.equal(result.status, "NO_EXTRACTABLE_TEXT");
  assert.deepEqual(result.pages, [
    { pageNumber: 1, text: "", status: "NO_EXTRACTABLE_TEXT" },
  ]);
  assert.match(result.notice ?? "", /OCR was not performed/u);
});
