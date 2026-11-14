import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import {
  AnalysisOrchestrator,
  handleAnalysisRequest,
} from "../../lib/analysis";
import {
  BrandContextService,
  MockBrandKnowledgeRepository,
  teraluneKnowledge,
} from "../../lib/brand-context";
import { DeterministicTextGovernanceEngine } from "../../lib/governance";
import {
  analyzeCreativeVisually,
  type GeminiVisionAdapter,
} from "../../lib/visual";

function makeSyntheticAdPng(): Buffer {
  const canvas = createCanvas(900, 600);
  const ctx = canvas.getContext("2d");
  // Unapproved bright orange background block
  ctx.fillStyle = "#E95126";
  ctx.fillRect(0, 0, 900, 260);
  // White lower panel
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 260, 900, 340);

  // Recoloured orange logo text on white
  ctx.fillStyle = "#E95126";
  ctx.font = "bold 46px sans-serif";
  ctx.fillText("TERALUNE", 80, 340);

  // Dark crisp copy with prohibited 500ml unit
  ctx.fillStyle = "#141414";
  ctx.font = "bold 40px sans-serif";
  ctx.fillText("PURE WATER 500ml SPECIAL", 80, 460);
  return canvas.toBuffer("image/png");
}

test("low-resolution creative produces quality warning and uncertain/human-review visual findings", async () => {
  const tinyOrangePng = await sharp({
    create: { width: 120, height: 90, channels: 3, background: { r: 233, g: 81, b: 38 } },
  })
    .png()
    .toBuffer();

  const result = await analyzeCreativeVisually({
    creative: {
      assetId: "tiny-ad",
      fileName: "tiny.png",
      declaredMimeType: "image/png",
      buffer: tinyOrangePng,
    },
    brandKnowledgeRecord: teraluneKnowledge,
    reviewId: "rev-lowres",
    analysisRunId: "run-lowres",
    dependencies: {
      visionAdapter: null,
      ocrRunner: async () => [],
    },
  });

  assert.ok(result.warnings.some((w) => w.toLowerCase().includes("low-resolution")));
  assert.ok(result.visualFindings.length >= 1);
  assert.equal(
    result.visualFindings.some((f) => f.reviewStatus === "candidate"),
    false,
    "Low-res creative must not emit confirmed candidate violations",
  );
});

test("combines OCR text findings and visual findings in the same AnalysisOrchestrator & API response", async () => {
  const pngBuffer = makeSyntheticAdPng();
  const repository = new MockBrandKnowledgeRepository();
  const brandService = new BrandContextService(repository);

  const orchestrator = new AnalysisOrchestrator({
    brandContextService: brandService,
    deterministicEngine: new DeterministicTextGovernanceEngine(),
    aiAnalysisService: {
      analyze: async ({ content }) => {
        assert.ok(content.includes("500ml") || content.includes("TERALUNE"));
        return {
          providerUsed: "test-semantic-stub",
          fallbackUsed: false,
          findings: [
            {
              findingId: "sem-price-note",
              category: "PROMOTIONAL_CLAIM",
              severity: "HIGH",
              status: "UNVERIFIED",
              issue: "Unverified promotional offer wording",
              description: "Promotional pricing requires approved campaign confirmation.",
              detectedValue: "Special ₹19",
              expectedValue: "Approved ₹25 price claim",
              explanation: "Extracted OCR copy includes unapproved pricing.",
              evidenceReferences: [
                {
                  sourceId: "SRC-PROD-01",
                  sourceType: "approved_brand_knowledge",
                  sourceTitle: "Teralune Product Fact Sheet (fictional)",
                  versionId: "1.0",
                },
              ],
              analysisProvider: "test-semantic-stub",
            },
          ],
        };
      },
    },
    getBrandKnowledgeRecord: (brandId) => repository.getBrandKnowledge({ brandId }),
    visualAnalyzer: {
      analyze: ({ creative, brandContext, brandKnowledgeRecord, reviewId, analysisRunId }) =>
        analyzeCreativeVisually({
          creative: {
            assetId: creative.assetId ?? "png-ad",
            fileName: creative.fileName,
            declaredMimeType: creative.mimeType,
            base64Data: creative.base64Data,
          },
          brandContext,
          brandKnowledgeRecord,
          reviewId,
          analysisRunId,
          dependencies: { visionAdapter: null },
        }),
    },
  });

  const apiResult = await handleAnalysisRequest(
    {
      title: "Combined PNG Test",
      contentType: "Social Creative",
      guidelineCollection: "Teralune Brand Identity & AI Guidelines v1.0",
      textContent: "",
      assetName: "ad.png",
      assetMimeType: "image/png",
      assetBase64: pngBuffer.toString("base64"),
      knowledgeSummary: [],
    },
    { orchestrator },
  );

  assert.equal(apiResult.status, 200);
  const adapted = apiResult.body as import("../../lib/types").AnalysisResponsePayload;

  const hasTextFinding = adapted.findings.some(
    (f) =>
      f.sourceDomain === "text" &&
      (f.title.includes("500ml") ||
        f.title.toLowerCase().includes("promotional") ||
        f.affectedContent.includes("500ml")),
  );
  const hasVisualFinding = adapted.findings.some(
    (f) => f.sourceDomain === "visual" && f.category === "Visual Identity",
  );

  assert.equal(hasTextFinding, true, "Expected text/OCR finding in unified response");
  assert.equal(hasVisualFinding, true, "Expected visual finding in unified response");
  assert.ok((adapted.ocrBlocks?.length ?? 0) >= 1);
  assert.equal(adapted.visualSummary?.format, "png");
});

test("Teralune PDF end-to-end completion test processes real sample-data/teralune/test-advertisement.pdf", async () => {
  const pdfPath = path.join(
    process.cwd(),
    "sample-data",
    "teralune",
    "test-advertisement.pdf",
  );
  const pdfBuffer = fs.readFileSync(pdfPath);

  const repository = new MockBrandKnowledgeRepository();
  const brandService = new BrandContextService(repository);

  const stubVision: GeminiVisionAdapter = {
    providerName: "gemini-vision",
    modelName: "gemini-test-vision",
    analyzePage: async () => ({
      retryCount: 0,
      validationFailures: 0,
      findings: [
        {
          id: "vis-gemini-bottle-p1",
          ruleId: "IMG-01",
          category: "visual_consistency",
          title: "Bottle uses orange cap and orange label mark instead of Deep Current / Spring Teal",
          explanation: "Product packaging deviates from clear PET bottle with Deep Current cap and Spring Teal droplet.",
          expectedValue: "Deep Current (#163A52) cap and Spring Teal (#239A8B) droplet mark",
          observedValue: "Orange cap and orange label accent",
          sourceReference: {
            sourceId: "SRC-ASSET-01",
            sourceVersion: "1.0",
            sourceTitle: "Teralune Brand Identity & Design Guidelines (fictional)",
            pageNumber: 5,
            excerpt: "Clear PET bottle with Deep Current cap",
          },
          creativeEvidence: {
            assetId: "teralune-ad-pdf",
            pageNumber: 1,
            boundingBox: { x: 0.58, y: 0.21, width: 0.26, height: 0.49 },
            description: "Product bottle area on page 1",
          },
          confidence: 0.94,
          reviewStatus: "candidate",
          severity: "HIGH",
          detector: "gemini_vision",
          classification: "objective_mismatch",
          suggestedCorrection: "Update bottle cap to Deep Current (#163A52) and label droplet to Spring Teal (#239A8B).",
        },
      ],
    }),
  };

  const orchestrator = new AnalysisOrchestrator({
    brandContextService: brandService,
    deterministicEngine: new DeterministicTextGovernanceEngine(),
    aiAnalysisService: {
      analyze: async ({ content }) => {
        // Verify PDF-extracted text actually reached Shruti's AI analysis workflow
        assert.ok(content.includes("BOOSTS IMMUNITY"));
        assert.ok(content.includes("100% PURE"));
        return {
          providerUsed: "teralune-e2e-semantic",
          fallbackUsed: false,
          findings: [
            {
              findingId: "sem-immunity",
              category: "PROMOTIONAL_CLAIM",
              severity: "HIGH",
              status: "UNVERIFIED",
              issue: "Unsupported health immunity claim",
              description: "BOOSTS IMMUNITY is not backed by approved product claims.",
              detectedValue: "BOOSTS IMMUNITY",
              expectedValue: "Refreshment, Naturally.",
              explanation: "Health/medical claims are unverified against approved brand knowledge.",
              evidenceReferences: [
                {
                  sourceId: "SRC-CLAIM-01",
                  sourceType: "approved_brand_knowledge",
                  sourceTitle: "Teralune Approved Marketing Claims (fictional)",
                  versionId: "1.0",
                },
              ],
              analysisProvider: "teralune-e2e-semantic",
            },
          ],
        };
      },
    },
    getBrandKnowledgeRecord: (brandId) => repository.getBrandKnowledge({ brandId }),
    visualAnalyzer: {
      analyze: ({ creative, brandContext, brandKnowledgeRecord, reviewId, analysisRunId }) =>
        analyzeCreativeVisually({
          creative: {
            assetId: creative.assetId ?? "teralune-ad-pdf",
            fileName: creative.fileName,
            declaredMimeType: creative.mimeType,
            base64Data: creative.base64Data,
          },
          brandContext,
          brandKnowledgeRecord,
          reviewId,
          analysisRunId,
          dependencies: { visionAdapter: stubVision },
        }),
    },
  });

  const apiResult = await handleAnalysisRequest(
    {
      title: "Teralune Summer Advertisement PDF",
      contentType: "Campaign Copy",
      guidelineCollection: "Teralune Brand Identity & AI Guidelines v1.0",
      textContent: "",
      assetName: "test-advertisement.pdf",
      assetMimeType: "application/pdf",
      assetBase64: pdfBuffer.toString("base64"),
      knowledgeSummary: [],
    },
    { orchestrator },
  );

  assert.equal(apiResult.status, 200);
  const adapted = apiResult.body as import("../../lib/types").AnalysisResponsePayload;

  // 1. PDF processed cleanly with 1 page and preview image (and no local fs paths exposed)
  assert.equal(adapted.visualSummary?.format, "pdf");
  assert.equal(adapted.visualSummary?.pageCount, 1);
  assert.equal(adapted.visualSummary?.processedPageCount, 1);
  assert.equal(adapted.visualSummary?.pages[0]?.status, "ok");
  assert.ok(adapted.visualSummary?.pages[0]?.previewDataUrl?.startsWith("data:image/png;base64,"));
  assert.equal(JSON.stringify(adapted).includes("/app/applet"), false);

  // 2. OCR & embedded PDF spans extracted with valid normalized [0,1] bounding boxes
  assert.ok((adapted.ocrBlocks?.length ?? 0) >= 10);
  for (const block of adapted.ocrBlocks ?? []) {
    assert.equal(block.pageNumber, 1);
    assert.ok(block.boundingBox.x >= 0 && block.boundingBox.x <= 1);
    assert.ok(block.boundingBox.y >= 0 && block.boundingBox.y <= 1);
    assert.ok(block.boundingBox.width > 0 && block.boundingBox.width <= 1);
    assert.ok(block.boundingBox.height > 0 && block.boundingBox.height <= 1);
  }

  // 3. Text findings from PDF text + Visual findings (colour, logo, typography, vision) both present
  const textFindings = adapted.findings.filter((f) => f.sourceDomain === "text");
  const visualFindings = adapted.findings.filter((f) => f.sourceDomain === "visual");
  assert.ok(textFindings.some((f) => f.title.includes("500ml")));
  assert.ok(textFindings.some((f) => f.title.includes("immunity") || f.affectedContent.includes("BOOSTS IMMUNITY")));
  assert.ok(visualFindings.some((f) => f.title.includes("#FED49C") || f.title.includes("#E95126")));
  assert.ok(visualFindings.some((f) => f.ruleId === "LOG-02"));
  assert.ok(visualFindings.some((f) => f.detector === "gemini_vision"));

  // 4. Inspect real location.boundingBox, location.pageNumber, and non-fabricated source provenance
  const boxedVisual = visualFindings.find(
    (f) => f.location?.boundingBox && f.location?.pageNumber === 1,
  );
  assert.ok(boxedVisual, "Expected visual finding with normalized boundingBox and pageNumber=1");
  assert.equal(boxedVisual.location?.pageNumber, 1);

  const validSourceIds = new Set(["SRC-BRAND-01", "SRC-PROD-01", "SRC-CLAIM-01", "SRC-ASSET-01"]);
  for (const finding of adapted.findings) {
    assert.ok(
      finding.sourceVersionIds?.every((v) => v === "1.0") ?? true,
      "All source versions must be real version 1.0",
    );
    const idMatch = finding.sourceReference.match(/\((SRC-[A-Z]+-\d+)/);
    if (idMatch) {
      assert.ok(validSourceIds.has(idMatch[1]!), `Unexpected source ID ${idMatch[1]}`);
    }
  }
});
