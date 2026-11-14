import assert from "node:assert/strict";
import test from "node:test";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  getVisualPipelineConfig,
  processPdfCreative,
  validateCreativeFile,
} from "../../lib/visual";

async function createSamplePdf(options: {
  pages: Array<{ width: number; height: number; rotate?: number; text: string }>;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const spec of options.pages) {
    const page = doc.addPage([spec.width, spec.height]);
    if (spec.rotate) {
      page.setRotation(degrees(spec.rotate));
    }
    page.drawText(spec.text, {
      x: 40,
      y: spec.height - 80,
      size: 18,
      font,
      color: rgb(0.08, 0.22, 0.32),
    });
  }

  return Buffer.from(await doc.save());
}

test("processes single-page and multi-page PDFs preserving page number, dimensions, rotation, and embedded text", async () => {
  const pdfBuffer = await createSamplePdf({
    pages: [
      { width: 595, height: 842, text: "Page One Teralune Headline" },
      { width: 800, height: 600, rotate: 90, text: "Page Two Rotated Landscape" },
    ],
  });

  const validated = await validateCreativeFile({
    assetId: "pdf-multi",
    fileName: "multi.pdf",
    declaredMimeType: "application/pdf",
    buffer: pdfBuffer,
  });

  const config = getVisualPipelineConfig({ maxPdfPages: 5, pdfRenderDpi: 96 });
  const result = await processPdfCreative(validated, config);

  assert.equal(result.totalPageCount, 2);
  assert.equal(result.pages.length, 2);

  const p1 = result.pages[0]!;
  assert.equal(p1.pageNumber, 1);
  assert.equal(p1.status, "ok");
  assert.equal(p1.rotation, 0);
  assert.ok(p1.imageWidth > 300 && p1.imageHeight > 300);
  assert.ok(p1.pngBuffer.length > 0);
  assert.ok(p1.embeddedText.includes("Page One Teralune Headline"));
  assert.ok(p1.embeddedSpans.length >= 1);
  assert.equal(p1.originalAssetId, "pdf-multi");

  const p2 = result.pages[1]!;
  assert.equal(p2.pageNumber, 2);
  assert.equal(p2.status, "ok");
  assert.equal(p2.rotation, 90);
  assert.ok(p2.warnings.some((w) => w.includes("native rotation 90")));
  assert.ok(p2.embeddedText.includes("Page Two Rotated Landscape"));
});

test("enforces maxPdfPages limit and emits a clear warning when exceeded", async () => {
  const pdfBuffer = await createSamplePdf({
    pages: [
      { width: 400, height: 500, text: "Page 1" },
      { width: 400, height: 500, text: "Page 2" },
      { width: 400, height: 500, text: "Page 3" },
      { width: 400, height: 500, text: "Page 4" },
    ],
  });

  const validated = await validateCreativeFile({
    assetId: "pdf-limit",
    fileName: "four-pages.pdf",
    declaredMimeType: "application/pdf",
    buffer: pdfBuffer,
  });

  const config = getVisualPipelineConfig({ maxPdfPages: 2, pdfRenderDpi: 72 });
  const result = await processPdfCreative(validated, config);

  assert.equal(result.totalPageCount, 4);
  assert.equal(result.pages.length, 2);
  assert.ok(
    result.warnings.some((w) => w.includes("exceeding the configured limit of 2")),
  );
});

test("handles partial page render failure without losing successfully processed pages", async () => {
  const pdfBuffer = await createSamplePdf({
    pages: [
      { width: 400, height: 500, text: "Healthy Page 1" },
      { width: 400, height: 500, text: "Broken Page 2" },
      { width: 400, height: 500, text: "Healthy Page 3" },
    ],
  });

  const validated = await validateCreativeFile({
    assetId: "pdf-partial",
    fileName: "partial.pdf",
    declaredMimeType: "application/pdf",
    buffer: pdfBuffer,
  });

  const config = getVisualPipelineConfig({ maxPdfPages: 5, pdfRenderDpi: 72 });
  const sharp = (await import("sharp")).default;
  const fallbackPng = await sharp({
    create: { width: 400, height: 500, channels: 3, background: { r: 244, g: 248, b: 247 } },
  })
    .png()
    .toBuffer();

  const result = await processPdfCreative(validated, config, {
    pageRenderer: async (_buf, pageNumber) => {
      if (pageNumber === 2) {
        throw new Error("Simulated rasterizer failure on page 2");
      }
      return fallbackPng;
    },
  });

  assert.equal(result.pages.length, 3);
  assert.equal(result.pages[0]!.status, "ok");
  assert.equal(result.pages[1]!.status, "failed");
  assert.ok(result.pages[1]!.error?.includes("Simulated rasterizer failure"));
  assert.equal(result.pages[2]!.status, "ok");
});
