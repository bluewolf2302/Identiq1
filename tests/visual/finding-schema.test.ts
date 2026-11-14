import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { teraluneKnowledge } from "../../lib/brand-context/teralune-brand-fixture";
import { ReviewFindingSchema } from "../../lib/contracts";
import {
  adaptBrandKnowledgeToVisualContext,
  analyzeCreativeVisually,
  deduplicateVisualFindings,
  GeminiVisionError,
  mapVisualFindingsToCanonical,
  SdkGeminiVisionAdapter,
  validateAndMapGeminiVisionResponse,
  VisualFindingSchema,
  type VisualFinding,
} from "../../lib/visual";

test("BrandVisualContext adapter keeps real source IDs and skips unapproved visual records", () => {
  const modifiedKnowledge = {
    ...teraluneKnowledge,
    visualAssets: [
      ...teraluneKnowledge.visualAssets,
      {
        id: "unapproved-draft-colour",
        brandId: "demo-brand-teralune",
        kind: "COLOUR" as const,
        value: "Unapproved Draft Neon Pink (#FF00AA)",
        approved: false as unknown as true,
        source: {
          sourceDocumentId: "SRC-DRAFT-99",
          sourceTitle: "Unapproved Draft",
          versionId: "0.1",
        },
      },
    ],
  };

  const ctx = adaptBrandKnowledgeToVisualContext(modifiedKnowledge);
  assert.equal(ctx.approved, true);
  assert.equal(ctx.hasVisualKnowledge, true);
  assert.equal(
    ctx.approvedPalette.some((c) => c.hex === "#FF00AA"),
    false,
    "Unapproved draft colour must be excluded",
  );
  assert.ok(ctx.validSourceIds.includes("SRC-ASSET-01"));
  assert.ok(ctx.validVersions.includes("1.0"));
});

test("VisualFindingSchema and canonical ReviewFinding mapping validate without losing bounding boxes", () => {
  const sampleFinding: VisualFinding = {
    id: "vis-sample-1",
    ruleId: "IMG-03",
    category: "colour",
    title: "Unapproved dominant orange colour #E95126",
    explanation: "Graphic CTA uses orange instead of approved palette.",
    expectedValue: "#163A52 or #239A8B",
    observedValue: "#E95126 (ΔE00=48.2)",
    sourceReference: {
      sourceId: "SRC-ASSET-01",
      sourceVersion: "1.0",
      sourceTitle: "Teralune Brand Identity & Design Guidelines (fictional)",
      pageNumber: 5,
      excerpt: "Deep Current #163A52, Spring Teal #239A8B",
    },
    creativeEvidence: {
      assetId: "asset-1",
      pageNumber: 1,
      boundingBox: { x: 0.1, y: 0.8, width: 0.3, height: 0.1 },
      description: "CTA button region",
    },
    confidence: 0.91,
    reviewStatus: "candidate",
    severity: "HIGH",
    detector: "deterministic",
    classification: "objective_mismatch",
    suggestedCorrection: "Use Deep Current #163A52.",
  };

  assert.equal(VisualFindingSchema.safeParse(sampleFinding).success, true);
  const canonical = mapVisualFindingsToCanonical([sampleFinding]);
  assert.equal(canonical.length, 1);
  assert.equal(ReviewFindingSchema.safeParse(canonical[0]).success, true);
  assert.equal(canonical[0]!.location?.pageNumber, 1);
  assert.deepEqual(canonical[0]!.location?.boundingBox, {
    x: 0.1,
    y: 0.8,
    width: 0.3,
    height: 0.1,
  });
  assert.equal(canonical[0]!.ruleId, "IMG-03");
  assert.equal(canonical[0]!.detector, "deterministic");
});

test("Gemini Vision response validator rejects fabricated sourceId or sourceVersion", () => {
  const brandCtx = adaptBrandKnowledgeToVisualContext(teraluneKnowledge);
  const result = validateAndMapGeminiVisionResponse(
    {
      findings: [
        {
          ruleId: "LOG-99",
          category: "logo",
          title: "Fabricated source finding",
          explanation: "Claims non-existent guideline.",
          expectedValue: "Fake",
          observedValue: "Fake",
          sourceId: "SRC-INVENTED-999",
          sourceVersion: "9.9",
          evidenceDescription: "Top left",
          confidence: 0.9,
          reviewStatus: "candidate",
          severity: "HIGH",
        },
        {
          ruleId: "IMG-01",
          category: "visual_consistency",
          title: "Bottle cap mismatch",
          explanation: "Cap appears orange instead of Deep Current.",
          expectedValue: "Deep Current (#163A52) cap",
          observedValue: "Orange cap",
          sourceId: "SRC-ASSET-01",
          sourceVersion: "1.0",
          boundingBox: { x: 0.6, y: 0.2, width: 0.2, height: 0.4 },
          evidenceDescription: "Product bottle region",
          confidence: 0.9,
          reviewStatus: "candidate",
          severity: "HIGH",
        },
      ],
    },
    brandCtx,
    "asset-1",
    1,
  );

  assert.equal(result.validationFailures, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.sourceReference.sourceId, "SRC-ASSET-01");
});

test("Gemini Vision handles malformed JSON, empty output, and timeout without fabricating mock success", async () => {
  const brandCtx = adaptBrandKnowledgeToVisualContext(teraluneKnowledge);
  const pngBuffer = await sharp({
    create: { width: 450, height: 350, channels: 3, background: { r: 244, g: 248, b: 247 } },
  })
    .png()
    .toBuffer();

  const malformedAdapter = new SdkGeminiVisionAdapter({
    apiKey: "test-key",
    model: "gemini-test",
    maxRetries: 0,
    generateFn: async () => "{not-valid-json",
  });

  await assert.rejects(
    () =>
      malformedAdapter.analyzePage({
        pageNumber: 1,
        imageWidth: 450,
        imageHeight: 350,
        pngBuffer,
        ocrBlocks: [],
        deterministicObservations: [],
        brandContext: brandCtx,
      }),
    (err: unknown) => err instanceof GeminiVisionError && err.code === "MALFORMED_JSON",
  );

  const emptyAdapter = new SdkGeminiVisionAdapter({
    apiKey: "test-key",
    model: "gemini-test",
    maxRetries: 0,
    generateFn: async () => "   ",
  });

  await assert.rejects(
    () =>
      emptyAdapter.analyzePage({
        pageNumber: 1,
        imageWidth: 450,
        imageHeight: 350,
        pngBuffer,
        ocrBlocks: [],
        deterministicObservations: [],
        brandContext: brandCtx,
      }),
    (err: unknown) => err instanceof GeminiVisionError && err.code === "EMPTY_OUTPUT",
  );

  const timeoutAdapter = new SdkGeminiVisionAdapter({
    apiKey: "test-key",
    model: "gemini-test",
    timeoutMs: 25,
    maxRetries: 0,
    generateFn: async ({ signal }) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });

  // When integrated via analyzeCreativeVisually, a Gemini failure yields PARTIAL status + preserved deterministic/OCR results + explicit error
  const partialRes = await analyzeCreativeVisually({
    creative: {
      assetId: "asset-timeout",
      fileName: "creative.png",
      declaredMimeType: "image/png",
      buffer: pngBuffer,
    },
    brandKnowledgeRecord: teraluneKnowledge,
    reviewId: "rev-timeout",
    analysisRunId: "run-timeout",
    dependencies: {
      visionAdapter: timeoutAdapter,
      ocrRunner: async () => [],
    },
  });

  assert.equal(partialRes.status, "PARTIAL");
  assert.ok(partialRes.errors.some((e) => e.includes("TIMEOUT")));
});

test("deduplicates overlapping findings across detectors while keeping distinct non-overlapping colour regions", () => {
  const base: Omit<VisualFinding, "id" | "detector" | "title" | "creativeEvidence" | "ruleId"> = {
    category: "colour",
    explanation: "Test",
    expectedValue: "#163A52",
    observedValue: "#E95126",
    sourceReference: {
      sourceId: "SRC-ASSET-01",
      sourceVersion: "1.0",
      sourceTitle: "Teralune",
      pageNumber: 5,
      excerpt: null,
    },
    confidence: 0.9,
    reviewStatus: "candidate",
    severity: "HIGH",
    classification: "objective_mismatch",
  };

  const deduped = deduplicateVisualFindings([
    {
      ...base,
      id: "det-1",
      ruleId: "IMG-03",
      detector: "deterministic",
      title: "Unapproved dominant colour #FED49C",
      creativeEvidence: {
        assetId: "a1",
        pageNumber: 1,
        boundingBox: { x: 0.0, y: 0.05, width: 0.9, height: 0.5 },
        description: "Background",
      },
    },
    {
      ...base,
      id: "gem-dup",
      ruleId: "IMG-03",
      detector: "gemini_vision",
      title: "Peach background outside palette",
      creativeEvidence: {
        assetId: "a1",
        pageNumber: 1,
        boundingBox: { x: 0.02, y: 0.06, width: 0.85, height: 0.48 },
        description: "Same region",
      },
    },
    {
      ...base,
      id: "det-2",
      ruleId: "IMG-03",
      detector: "deterministic",
      title: "Unapproved dominant colour #E95126",
      creativeEvidence: {
        assetId: "a1",
        pageNumber: 1,
        boundingBox: { x: 0.1, y: 0.8, width: 0.2, height: 0.08 },
        description: "CTA button",
      },
    },
  ]);

  assert.equal(deduped.length, 2);
  assert.ok(deduped.some((f) => f.id === "det-1"));
  assert.ok(deduped.some((f) => f.id === "det-2"));
});
