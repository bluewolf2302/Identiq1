import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import { teraluneKnowledge } from "../../lib/brand-context/teralune-brand-fixture";
import {
  adaptBrandKnowledgeToVisualContext,
  getVisualPipelineConfig,
  runLogoCheck,
  type OcrBlock,
  type ProcessedPage,
} from "../../lib/visual";

function makeWordmarkPng(bgHex: string, fgHex: string, width = 800, height = 500): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = fgHex;
  ctx.fillRect(80, 60, 40, 40);
  ctx.font = "bold 42px sans-serif";
  ctx.fillText("TERALUNE", 135, 95);
  return canvas.toBuffer("image/png");
}

function makeProcessedPage(pngBuffer: Buffer, width = 800, height = 500): ProcessedPage {
  return {
    pageNumber: 1,
    width,
    height,
    rotation: 0,
    imageWidth: width,
    imageHeight: height,
    pngBuffer,
    embeddedText: "",
    embeddedSpans: [],
    status: "ok",
    warnings: [],
    originalAssetId: "logo-test-asset",
  };
}

test("passes logo colour check when wordmark & mark use approved Deep Current (#163A52)", async () => {
  const brandCtx = adaptBrandKnowledgeToVisualContext(teraluneKnowledge);
  const png = makeWordmarkPng("#F4F8F7", "#163A52");
  const ocrBlocks: OcrBlock[] = [
    {
      text: "TERALUNE",
      pageNumber: 1,
      boundingBox: { x: 0.16, y: 0.11, width: 0.28, height: 0.09 },
      confidence: 0.95,
      source: "ocr",
      uncertain: false,
      reviewStatus: "candidate",
    },
  ];

  const result = await runLogoCheck(
    makeProcessedPage(png),
    ocrBlocks,
    brandCtx,
    getVisualPipelineConfig(),
  );

  assert.equal(
    result.findings.some((f) => f.ruleId === "LOG-02"),
    false,
  );
  assert.ok(result.detectedLogoBoxes.length >= 1);
});

test("detects recoloured orange logo (#E95126) against approved Deep Current / Spring Teal logo colours", async () => {
  const brandCtx = adaptBrandKnowledgeToVisualContext(teraluneKnowledge);
  const png = makeWordmarkPng("#FFFFFF", "#E95126");
  const ocrBlocks: OcrBlock[] = [
    {
      text: "TERALUNE",
      pageNumber: 1,
      boundingBox: { x: 0.16, y: 0.11, width: 0.28, height: 0.09 },
      confidence: 0.94,
      source: "ocr",
      uncertain: false,
      reviewStatus: "candidate",
    },
  ];

  const result = await runLogoCheck(
    makeProcessedPage(png),
    ocrBlocks,
    brandCtx,
    getVisualPipelineConfig(),
  );

  const recolourFinding = result.findings.find((f) => f.ruleId === "LOG-02");
  assert.ok(recolourFinding, "Expected LOG-02 recoloured logo finding");
  assert.equal(recolourFinding.category, "logo");
  assert.equal(recolourFinding.sourceReference.sourceId, "SRC-ASSET-01");
  assert.ok(recolourFinding.creativeEvidence.boundingBox !== null);
});

test("only emits missing-logo finding when brandContext.logoRequired is true", async () => {
  const brandCtx = adaptBrandKnowledgeToVisualContext(teraluneKnowledge);
  const blankPng = await sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 244, g: 248, b: 247 } },
  })
    .png()
    .toBuffer();

  const resNotRequired = await runLogoCheck(
    makeProcessedPage(blankPng, 600, 400),
    [],
    { ...brandCtx, logoRequired: false },
    getVisualPipelineConfig(),
  );
  assert.equal(resNotRequired.findings.length, 0);

  const resRequired = await runLogoCheck(
    makeProcessedPage(blankPng, 600, 400),
    [],
    { ...brandCtx, logoRequired: true },
    getVisualPipelineConfig(),
  );
  assert.equal(resRequired.findings.length, 1);
  assert.equal(resRequired.findings[0]!.reviewStatus, "needs_human_review");
});

test("flags low-resolution or partial template-matching logos as needs_human_review instead of confirmed violations", async () => {
  const refLogo = makeWordmarkPng("#FFFFFF", "#163A52", 240, 100);
  const brandCtx = adaptBrandKnowledgeToVisualContext(teraluneKnowledge, {
    referenceLogoBuffers: new Map([["logo-ref-1", refLogo]]),
  });

  // Low-res canvas with recoloured logo
  const lowResPng = makeWordmarkPng("#FFFFFF", "#E95126", 200, 120);
  const ocrBlocks: OcrBlock[] = [
    {
      text: "TERALUNE",
      pageNumber: 1,
      boundingBox: { x: 0.16, y: 0.11, width: 0.28, height: 0.09 },
      confidence: 0.72,
      source: "ocr",
      uncertain: false,
      reviewStatus: "candidate",
    },
  ];

  const result = await runLogoCheck(
    makeProcessedPage(lowResPng, 200, 120),
    ocrBlocks,
    brandCtx,
    getVisualPipelineConfig(),
  );

  for (const finding of result.findings) {
    assert.notEqual(
      finding.reviewStatus,
      "candidate",
      "Low-res logo check should remain uncertain / needs_human_review",
    );
  }
});

test("skips logo check safely when no approved logo assets exist", async () => {
  const brandCtx = adaptBrandKnowledgeToVisualContext(teraluneKnowledge);
  const noLogosCtx = { ...brandCtx, approvedLogos: [] };
  const png = makeWordmarkPng("#FFFFFF", "#E95126");

  const result = await runLogoCheck(
    makeProcessedPage(png),
    [],
    noLogosCtx,
    getVisualPipelineConfig(),
  );

  assert.equal(result.findings.length, 0);
  assert.ok(result.observations.some((o) => o.summary.includes("Skipped logo check")));
});
