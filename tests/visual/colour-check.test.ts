import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { teraluneKnowledge } from "../../lib/brand-context/teralune-brand-fixture";
import {
  adaptBrandKnowledgeToVisualContext,
  ciede2000,
  getVisualPipelineConfig,
  rgbToLab,
  runColourCheck,
  type ProcessedPage,
} from "../../lib/visual";

function buildProcessedPage(
  pngBuffer: Buffer,
  width = 600,
  height = 600,
): ProcessedPage {
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
    originalAssetId: "colour-test-asset",
  };
}

test("CIEDE2000 computes 0 for identical Lab colours and large delta for orange vs teal", () => {
  const teal = rgbToLab({ r: 35, g: 154, b: 139 }); // #239A8B
  const orange = rgbToLab({ r: 233, g: 81, b: 38 }); // #E95126
  assert.equal(ciede2000(teal, teal), 0);
  assert.ok(ciede2000(teal, orange) > 45);
});

test("returns zero colour findings when creative strictly uses approved palette colours", async () => {
  const brandCtx = adaptBrandKnowledgeToVisualContext(teraluneKnowledge);
  // Composite #163A52 (Deep Current) and #239A8B (Spring Teal) over #F4F8F7 (Cloud White)
  const overlayTeal = await sharp({
    create: { width: 280, height: 280, channels: 3, background: { r: 35, g: 154, b: 139 } },
  })
    .png()
    .toBuffer();

  const png = await sharp({
    create: { width: 600, height: 600, channels: 3, background: { r: 22, g: 58, b: 82 } },
  })
    .composite([{ input: overlayTeal, left: 160, top: 160 }])
    .png()
    .toBuffer();

  const result = await runColourCheck(
    buildProcessedPage(png),
    brandCtx,
    getVisualPipelineConfig(),
  );

  assert.equal(result.findings.length, 0);
});

test("flags prominent unapproved colour with observed hex, closest approved hex, CIEDE2000 delta, and bounding box", async () => {
  const brandCtx = adaptBrandKnowledgeToVisualContext(teraluneKnowledge);
  const orangeBanner = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 233, g: 81, b: 38 } },
  })
    .png()
    .toBuffer();

  const png = await sharp({
    create: { width: 600, height: 600, channels: 3, background: { r: 244, g: 248, b: 247 } },
  })
    .composite([{ input: orangeBanner, left: 100, top: 150 }])
    .png()
    .toBuffer();

  const result = await runColourCheck(
    buildProcessedPage(png),
    brandCtx,
    getVisualPipelineConfig(),
  );

  assert.ok(result.findings.length >= 1);
  const finding = result.findings[0]!;
  assert.equal(finding.category, "colour");
  assert.equal(finding.detector, "deterministic");
  assert.ok(finding.observedValue.includes("ΔE00="));
  assert.ok(finding.expectedValue.includes("#163A52"));
  assert.ok(finding.sourceReference.sourceId === "SRC-ASSET-01");
  assert.ok(finding.creativeEvidence.boundingBox !== null);
});

test("ignores high-texture photographic regions instead of false-flagging natural product photos", async () => {
  const brandCtx = adaptBrandKnowledgeToVisualContext(teraluneKnowledge);
  // Create a synthetic 600x600 multi-hue photographic texture with 5x5 patches so 144x144 resampling preserves natural gradient & colour diversity
  const w = 600;
  const h = 600;
  const raw = Buffer.alloc(w * h * 3);
  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };
  const cell = 5;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const patchColors = new Uint8Array(cols * rows * 3);
  for (let i = 0; i < patchColors.length; i++) {
    patchColors[i] = nextRand() % 256;
  }
  for (let y = 0; y < h; y++) {
    const py = Math.floor(y / cell);
    for (let x = 0; x < w; x++) {
      const px = Math.floor(x / cell);
      const pIdx = (py * cols + px) * 3;
      const idx = (y * w + x) * 3;
      raw[idx] = patchColors[pIdx]!;
      raw[idx + 1] = patchColors[pIdx + 1]!;
      raw[idx + 2] = patchColors[pIdx + 2]!;
    }
  }
  const photoPng = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();

  const result = await runColourCheck(
    buildProcessedPage(photoPng, w, h),
    brandCtx,
    getVisualPipelineConfig(),
  );

  assert.equal(result.findings.length, 0);
  assert.ok(
    result.observations.some(
      (o) => Number(o.metrics?.photographicTileCount ?? 0) >= 27,
    ),
  );
});

test("skips colour check gracefully when brand visual context has no approved palette", async () => {
  const brandCtx = adaptBrandKnowledgeToVisualContext(teraluneKnowledge);
  const noPaletteCtx = { ...brandCtx, approvedPalette: [] };
  const png = await sharp({
    create: { width: 400, height: 400, channels: 3, background: { r: 233, g: 81, b: 38 } },
  })
    .png()
    .toBuffer();

  const result = await runColourCheck(
    buildProcessedPage(png, 400, 400),
    noPaletteCtx,
    getVisualPipelineConfig(),
  );

  assert.equal(result.findings.length, 0);
  assert.ok(result.observations.some((o) => o.summary.includes("Skipped brand colour check")));
});
