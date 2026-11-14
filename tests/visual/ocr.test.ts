import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import {
  extractPageTextWithOcr,
  getVisualPipelineConfig,
  mergeAndDeduplicatePageTextBlocks,
  type OcrBlock,
} from "../../lib/visual";

function renderTextCanvasPng(
  width: number,
  height: number,
  draw: (ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>) => void,
): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  draw(ctx);
  return canvas.toBuffer("image/png");
}

test("extracts multiple text regions with normalized [0, 1] bounding boxes via Tesseract OCR", async () => {
  const pngBuffer = renderTextCanvasPng(900, 500, (ctx) => {
    ctx.fillStyle = "#163A52";
    ctx.font = "bold 44px sans-serif";
    ctx.fillText("REFRESHMENT NATURALLY", 60, 110);

    ctx.fillStyle = "#141414";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText("PURE SPRING WATER 750ML", 60, 340);
  });

  const result = await extractPageTextWithOcr({
    pageNumber: 1,
    imageWidth: 900,
    imageHeight: 500,
    pngBuffer,
  });

  assert.ok(result.blocks.length >= 2, `Expected >= 2 OCR blocks, got ${result.blocks.length}`);
  assert.ok(result.combinedText.toUpperCase().includes("REFRESHMENT"));
  assert.ok(result.combinedText.toUpperCase().includes("SPRING WATER"));

  for (const block of result.blocks) {
    assert.equal(block.pageNumber, 1);
    assert.ok(block.boundingBox.x >= 0 && block.boundingBox.x <= 1);
    assert.ok(block.boundingBox.y >= 0 && block.boundingBox.y <= 1);
    assert.ok(block.boundingBox.width > 0 && block.boundingBox.width <= 1);
    assert.ok(block.boundingBox.height > 0 && block.boundingBox.height <= 1);
  }
});

test("handles rotated text images without crashing", async () => {
  const upright = renderTextCanvasPng(700, 320, (ctx) => {
    ctx.fillStyle = "#141414";
    ctx.font = "bold 44px sans-serif";
    ctx.fillText("TERALUNE SPRING", 80, 180);
  });
  const rotated90 = await sharp(upright).rotate(90).png().toBuffer();
  const meta = await sharp(rotated90).metadata();

  const result = await extractPageTextWithOcr({
    pageNumber: 1,
    imageWidth: meta.width ?? 320,
    imageHeight: meta.height ?? 700,
    pngBuffer: rotated90,
  });

  assert.ok(Array.isArray(result.blocks));
  assert.ok(result.blocks.length >= 1);
  assert.ok(result.combinedText.toUpperCase().includes("TERALUNE"));
});

test("returns empty OCR blocks cleanly for blank images with no readable text", async () => {
  const blankPng = await sharp({
    create: {
      width: 500,
      height: 400,
      channels: 3,
      background: { r: 223, g: 241, b: 237 },
    },
  })
    .png()
    .toBuffer();

  const result = await extractPageTextWithOcr({
    pageNumber: 1,
    imageWidth: 500,
    imageHeight: 400,
    pngBuffer: blankPng,
  });

  assert.deepEqual(result.blocks, []);
  assert.equal(result.combinedText, "");
});

test("flags low-confidence OCR blocks as uncertain and never presents them as verified", async () => {
  const pngBuffer = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();

  const config = getVisualPipelineConfig({ ocrConfidenceThreshold: 0.65 });
  const result = await extractPageTextWithOcr(
    {
      pageNumber: 1,
      imageWidth: 400,
      imageHeight: 300,
      pngBuffer,
    },
    {
      config,
      ocrRunner: async () => [
        {
          text: "blurry text",
          pageNumber: 1,
          boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
          confidence: 0.42,
          source: "ocr",
          uncertain: true,
          reviewStatus: "uncertain",
        },
        {
          text: "CLEAR HEADLINE",
          pageNumber: 1,
          boundingBox: { x: 0.1, y: 0.5, width: 0.4, height: 0.06 },
          confidence: 0.93,
          source: "ocr",
          uncertain: false,
          reviewStatus: "candidate",
        },
      ],
    },
  );

  assert.equal(result.uncertainBlockCount, 1);
  assert.equal(result.blocks[0]!.uncertain, true);
  assert.equal(result.blocks[0]!.reviewStatus, "uncertain");
  assert.equal(result.blocks[1]!.uncertain, false);
  assert.ok(result.warnings.some((w) => w.includes("marked uncertain")));
});

test("deduplicates overlapping OCR blocks against PDF embedded text layer while keeping unique raster-only text", () => {
  const embedded: OcrBlock[] = [
    {
      text: "Refreshment, Naturally.",
      pageNumber: 1,
      boundingBox: { x: 0.1, y: 0.12, width: 0.4, height: 0.05 },
      confidence: 1,
      source: "pdf_text_layer",
      uncertain: false,
      reviewStatus: "candidate",
    },
  ];
  const ocr: OcrBlock[] = [
    {
      text: "Refreshment Naturally",
      pageNumber: 1,
      boundingBox: { x: 0.1, y: 0.12, width: 0.41, height: 0.05 },
      confidence: 0.92,
      source: "ocr",
      uncertain: false,
      reviewStatus: "candidate",
    },
    {
      text: "BOTTLE LABEL 500ML",
      pageNumber: 1,
      boundingBox: { x: 0.65, y: 0.45, width: 0.2, height: 0.04 },
      confidence: 0.88,
      source: "ocr",
      uncertain: false,
      reviewStatus: "candidate",
    },
  ];

  const merged = mergeAndDeduplicatePageTextBlocks(embedded, ocr);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]!.source, "pdf_text_layer");
  assert.equal(merged[1]!.text, "BOTTLE LABEL 500ML");
});
