import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
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
  GeminiVisionError,
  OpenRouterVisionAdapter,
  ResilientVisionAdapter,
  SdkGeminiVisionAdapter,
  type GeminiVisionAdapter,
  type VisionPageInput,
} from "../../lib/visual";

function makeSyntheticTestAd(): Buffer {
  const canvas = createCanvas(800, 600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#E95126"; // Unapproved orange
  ctx.fillRect(0, 0, 800, 300);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 300, 800, 300);
  ctx.fillStyle = "#141414";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText("TERALUNE PURE WATER 500ml", 50, 400);
  return canvas.toBuffer("image/png");
}

const mockBrandVisualContext = {
  brandId: "demo-brand-teralune",
  brandName: "Teralune",
  guidelineVersion: "1.0",
  approved: true,
  approvedPalette: [],
  approvedLogos: [],
  logoRequired: false,
  typographyRequirements: [],
  layoutRequirements: [],
  requiredVisualElements: [],
  prohibitedVisualStyles: [],
  rules: [
    {
      ruleId: "RULE-VIS-01",
      category: "colour" as const,
      description: "Approved Deep Current palette",
      sourceId: "SRC-BRAND-01",
      sourceVersion: "1.0",
      sourceTitle: "Teralune Guidelines",
      excerpt: "Primary color is Deep Current (#163A52)",
    },
  ],
  validSourceIds: ["SRC-BRAND-01"],
  validVersions: ["1.0"],
  hasVisualKnowledge: true,
  warnings: [],
};

const sampleVisionPayload = {
  findings: [
    {
      ruleId: "RULE-VIS-01",
      category: "colour",
      title: "Unapproved background hue detected",
      explanation: "Ad uses bright orange (#E95126) which conflicts with approved palette.",
      expectedValue: "Deep Current (#163A52)",
      observedValue: "#E95126 Orange",
      sourceId: "SRC-BRAND-01",
      sourceVersion: "1.0",
      guidelinePageNumber: 4,
      excerpt: "Primary color is Deep Current",
      boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 },
      evidenceDescription: "Upper ad banner background",
      confidence: 0.95,
      reviewStatus: "candidate",
      severity: "HIGH",
      suggestedCorrection: "Replace orange header with Deep Current (#163A52).",
    },
  ],
};

test("SdkGeminiVisionAdapter succeeds and maps validated findings", async () => {
  const adapter = new SdkGeminiVisionAdapter({
    model: "gemini-test",
    generateFn: async () => JSON.stringify(sampleVisionPayload),
  });

  const pageInput: VisionPageInput = {
    pageNumber: 1,
    imageWidth: 800,
    imageHeight: 600,
    pngBuffer: makeSyntheticTestAd(),
    ocrBlocks: [],
    deterministicObservations: [],
    brandContext: mockBrandVisualContext,
  };

  const result = await adapter.analyzePage(pageInput);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].detector, "gemini_vision");
  assert.equal(result.findings[0].severity, "HIGH");
  assert.equal(result.retryCount, 0);
});

test("OpenRouterVisionAdapter successfully calls chat completions and validates response", async () => {
  let calledUrl = "";
  let requestHeaders: Record<string, string> = {};
  let parsedBody: Record<string, unknown> = {};

  const mockFetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calledUrl = String(url);
    requestHeaders = (init?.headers as Record<string, string>) || {};
    parsedBody = JSON.parse(String(init?.body || "{}"));

    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: "google/gemini-2.0-flash-001",
        choices: [
          {
            message: {
              content: JSON.stringify(sampleVisionPayload),
            },
          },
        ],
      }),
      text: async () => "",
    } as unknown as Response;
  }) as typeof fetch;

  const adapter = new OpenRouterVisionAdapter({
    apiKey: "test-sk-openrouter",
    model: "google/gemini-2.0-flash-001",
    fetcher: mockFetcher,
    timeoutMs: 10_000,
  });

  const pageInput: VisionPageInput = {
    pageNumber: 1,
    imageWidth: 800,
    imageHeight: 600,
    pngBuffer: makeSyntheticTestAd(),
    ocrBlocks: [],
    deterministicObservations: [],
    brandContext: mockBrandVisualContext,
  };

  const result = await adapter.analyzePage(pageInput);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].detector, "openrouter_vision");
  assert.equal(result.modelUsed, "google/gemini-2.0-flash-001");
  assert.ok(calledUrl.includes("openrouter.ai"));
  assert.equal(requestHeaders.Authorization, "Bearer test-sk-openrouter");
  assert.ok(Array.isArray((parsedBody.messages as Array<Record<string, unknown>>)[1]?.content));
});

test("ResilientVisionAdapter: Primary succeeds -> fallback is not invoked", async () => {
  let fallbackInvoked = false;

  const mockPrimary: GeminiVisionAdapter = {
    providerName: "gemini-vision",
    modelName: "gemini-3.6-flash",
    analyzePage: async () => ({
      findings: [
        {
          id: "vis-gemini-p1-1",
          ruleId: "RULE-VIS-01",
          category: "colour",
          title: "Gemini finding",
          explanation: "Observed color",
          expectedValue: "Expected",
          observedValue: "Observed",
          sourceReference: { sourceId: "SRC-BRAND-01", sourceVersion: "1.0", pageNumber: 1, excerpt: "Excerpt" },
          creativeEvidence: { assetId: "test-asset", pageNumber: 1, boundingBox: null, description: "Evidence" },
          confidence: 0.9,
          reviewStatus: "candidate",
          severity: "HIGH",
          detector: "gemini_vision",
        },
      ],
      retryCount: 0,
      validationFailures: 0,
    }),
  };

  const mockFallback: GeminiVisionAdapter = {
    providerName: "openrouter-vision",
    modelName: "google/gemini-2.0-flash-001",
    analyzePage: async () => {
      fallbackInvoked = true;
      return { findings: [], retryCount: 0, validationFailures: 0 };
    },
  };

  const resilient = new ResilientVisionAdapter({
    primary: mockPrimary,
    fallback: mockFallback,
  });

  const pageInput: VisionPageInput = {
    pageNumber: 1,
    imageWidth: 800,
    imageHeight: 600,
    pngBuffer: makeSyntheticTestAd(),
    ocrBlocks: [],
    deterministicObservations: [],
    brandContext: mockBrandVisualContext,
  };

  const res = await resilient.analyzePage(pageInput);
  assert.equal(res.fallbackUsed, false);
  assert.equal(res.providerUsed, "gemini-vision:gemini-3.6-flash");
  assert.equal(res.findings.length, 1);
  assert.equal(fallbackInvoked, false);
});

test("ResilientVisionAdapter: Primary rate limits (429) -> falls back to OpenRouter Vision and succeeds", async () => {
  let fallbackInvoked = false;
  let fallbackNotificationRecorded = false;

  const mockPrimary: GeminiVisionAdapter = {
    providerName: "gemini-vision",
    modelName: "gemini-3.6-flash",
    analyzePage: async () => {
      throw new GeminiVisionError("RATE_LIMITED", "Gemini API rate limit exceeded (429)", true);
    },
  };

  const mockFallback: GeminiVisionAdapter = {
    providerName: "openrouter-vision",
    modelName: "google/gemini-2.0-flash-001",
    analyzePage: async () => {
      fallbackInvoked = true;
      return {
        findings: [
          {
            id: "vis-openrouter-p1-1",
            ruleId: "RULE-VIS-01",
            category: "colour",
            title: "OpenRouter fallback finding",
            explanation: "Observed color via OpenRouter",
            expectedValue: "Expected",
            observedValue: "Observed",
            sourceReference: { sourceId: "SRC-BRAND-01", sourceVersion: "1.0", pageNumber: 1, excerpt: "Excerpt" },
            creativeEvidence: { assetId: "test-asset", pageNumber: 1, boundingBox: null, description: "Evidence" },
            confidence: 0.92,
            reviewStatus: "candidate",
            severity: "HIGH",
            detector: "openrouter_vision",
          },
        ],
        retryCount: 0,
        validationFailures: 0,
      };
    },
  };

  const resilient = new ResilientVisionAdapter({
    primary: mockPrimary,
    fallback: mockFallback,
    onFallbackAttempt: ({ reason, fallbackProvider }) => {
      fallbackNotificationRecorded = true;
      assert.ok(reason.includes("rate limit"));
      assert.equal(fallbackProvider, "openrouter-vision");
    },
  });

  const pageInput: VisionPageInput = {
    pageNumber: 1,
    imageWidth: 800,
    imageHeight: 600,
    pngBuffer: makeSyntheticTestAd(),
    ocrBlocks: [],
    deterministicObservations: [],
    brandContext: mockBrandVisualContext,
  };

  const res = await resilient.analyzePage(pageInput);
  assert.equal(fallbackInvoked, true);
  assert.equal(fallbackNotificationRecorded, true);
  assert.equal(res.fallbackUsed, true);
  assert.equal(res.providerUsed, "openrouter-vision:google/gemini-2.0-flash-001");
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].title, "OpenRouter fallback finding");
});

test("ResilientVisionAdapter: Primary times out -> falls back to OpenRouter Vision and succeeds", async () => {
  const mockPrimary: GeminiVisionAdapter = {
    providerName: "gemini-vision",
    modelName: "gemini-3.6-flash",
    analyzePage: async () => {
      throw new GeminiVisionError("TIMEOUT", "Gemini vision request timed out after 22s", true);
    },
  };

  const mockFallback: GeminiVisionAdapter = {
    providerName: "openrouter-vision",
    modelName: "google/gemini-2.0-flash-001",
    analyzePage: async () => ({
      findings: [
        {
          id: "vis-openrouter-p1-1",
          ruleId: "RULE-VIS-01",
          category: "colour",
          title: "Recovered finding after timeout",
          explanation: "Recovered via OpenRouter",
          expectedValue: "Expected",
          observedValue: "Observed",
          sourceReference: { sourceId: "SRC-BRAND-01", sourceVersion: "1.0", pageNumber: 1, excerpt: "Excerpt" },
          creativeEvidence: { assetId: "test-asset", pageNumber: 1, boundingBox: null, description: "Evidence" },
          confidence: 0.88,
          reviewStatus: "candidate",
          severity: "HIGH",
          detector: "openrouter_vision",
        },
      ],
      retryCount: 0,
      validationFailures: 0,
    }),
  };

  const resilient = new ResilientVisionAdapter({
    primary: mockPrimary,
    fallback: mockFallback,
  });

  const pageInput: VisionPageInput = {
    pageNumber: 1,
    imageWidth: 800,
    imageHeight: 600,
    pngBuffer: makeSyntheticTestAd(),
    ocrBlocks: [],
    deterministicObservations: [],
    brandContext: mockBrandVisualContext,
  };

  const res = await resilient.analyzePage(pageInput);
  assert.equal(res.fallbackUsed, true);
  assert.equal(res.findings[0].title, "Recovered finding after timeout");
});

test("ResilientVisionAdapter: Both primary and fallback fail -> throws clean provider error", async () => {
  const mockPrimary: GeminiVisionAdapter = {
    providerName: "gemini-vision",
    modelName: "gemini-3.6-flash",
    analyzePage: async () => {
      throw new GeminiVisionError("RATE_LIMITED", "Gemini 429", true);
    },
  };

  const mockFallback: GeminiVisionAdapter = {
    providerName: "openrouter-vision",
    modelName: "google/gemini-2.0-flash-001",
    analyzePage: async () => {
      throw new GeminiVisionError("RATE_LIMITED", "OpenRouter 429", true);
    },
  };

  const resilient = new ResilientVisionAdapter({
    primary: mockPrimary,
    fallback: mockFallback,
  });

  const pageInput: VisionPageInput = {
    pageNumber: 1,
    imageWidth: 800,
    imageHeight: 600,
    pngBuffer: makeSyntheticTestAd(),
    ocrBlocks: [],
    deterministicObservations: [],
    brandContext: mockBrandVisualContext,
  };

  await assert.rejects(
    resilient.analyzePage(pageInput),
    (err: unknown) =>
      err instanceof GeminiVisionError &&
      err.code === "PROVIDER_ERROR" &&
      err.message.includes("All visual AI providers failed"),
  );
});

test("analyzeCreativeVisually preserves OCR and deterministic findings when ALL AI vision fails", async () => {
  const adPng = makeSyntheticTestAd();

  const failingVisionAdapter: GeminiVisionAdapter = {
    providerName: "resilient-vision",
    modelName: "mock-both-failed",
    analyzePage: async () => {
      throw new GeminiVisionError("PROVIDER_ERROR", "All visual AI providers failed.", false);
    },
  };

  const result = await analyzeCreativeVisually({
    creative: {
      assetId: "fail-test-creative",
      fileName: "ad.png",
      declaredMimeType: "image/png",
      buffer: adPng,
    },
    brandKnowledgeRecord: teraluneKnowledge,
    reviewId: "rev-fail-test",
    analysisRunId: "run-fail-test",
    dependencies: {
      visionAdapter: failingVisionAdapter,
      ocrRunner: async () => [
        {
          text: "TERALUNE PURE WATER 500ml",
          pageNumber: 1,
          boundingBox: { x: 0.1, y: 0.6, width: 0.8, height: 0.1 },
          confidence: 0.95,
          source: "ocr",
          uncertain: false,
          reviewStatus: "candidate",
        },
      ],
    },
  });

  // Verify result is PARTIAL (not FAILED!)
  assert.equal(result.status, "PARTIAL");
  // OCR blocks survived completely
  assert.equal(result.ocrBlocks.length, 1);
  assert.equal(result.ocrBlocks[0].text, "TERALUNE PURE WATER 500ml");
  // Deterministic color / logo checks survived
  assert.ok(result.visualFindings.length >= 1, "Deterministic visual findings must survive AI failure");
  // Warning recorded explaining graceful preservation
  assert.ok(result.warnings.some((w) => w.includes("Deterministic visual checks and OCR results were preserved")));
});

test("AnalysisOrchestrator preserves deterministic and visual findings when text AI fails", async () => {
  const repository = new MockBrandKnowledgeRepository();
  const brandService = new BrandContextService(repository);

  const orchestrator = new AnalysisOrchestrator({
    brandContextService: brandService,
    deterministicEngine: new DeterministicTextGovernanceEngine(),
    aiAnalysisService: {
      analyze: async () => {
        throw new Error("Text AI rate limit (429) across all providers");
      },
    },
    visualAnalyzer: {
      analyze: async () => ({
        status: "COMPLETED",
        creativeMetadata: {
          assetId: "vis-asset",
          fileName: "test.pdf",
          format: "pdf",
          mimeType: "application/pdf",
          sizeBytes: 1000,
          pageCount: 1,
          processedPageCount: 1,
        },
        pages: [
          {
            pageNumber: 1,
            width: 800,
            height: 600,
            rotation: 0,
            imageWidth: 800,
            imageHeight: 600,
            status: "ok",
            originalAssetId: "vis-asset",
          },
        ],
        ocrBlocks: [
          {
            text: "TERALUNE PURE WATER 500ml",
            pageNumber: 1,
            boundingBox: { x: 0.1, y: 0.6, width: 0.8, height: 0.1 },
            confidence: 0.95,
            source: "ocr",
            uncertain: false,
            reviewStatus: "candidate",
          },
        ],
        extractedText: "TERALUNE PURE WATER 500ml",
        observations: [],
        visualFindings: [],
        canonicalFindings: [
          {
            findingId: "vis-can-1",
            category: "VISUAL_COMPLIANCE",
            severity: "HIGH",
            status: "CONFLICTING",
            issue: "Visual color violation",
            description: "Unapproved color detected",
            explanation: "Orange background conflicts with approved guidelines.",
            evidenceReferences: [
              {
                sourceId: "SRC-BRAND-01",
                sourceType: "approved_brand_knowledge",
                sourceTitle: "Teralune Guidelines",
                versionId: "1.0",
              },
            ],
            analysisProvider: "visual-deterministic",
          },
        ],
        warnings: [],
        errors: [],
        visionProviderUsed: "gemini-vision:gemini-3.6-flash",
        diagnostics: {
          reviewId: "rev-1",
          analysisRunId: "run-1",
          creativeId: "vis-asset",
          fileFormat: "pdf",
          fileSizeBytes: 1000,
          pageCount: 1,
          processedPageCount: 1,
          ocrBlockCount: 1,
          ocrDurationMs: 100,
          deterministicDurationMs: 50,
          geminiDurationMs: 0,
          geminiRetryCount: 0,
          candidateFindingCount: 1,
          uncertainFindingCount: 0,
          validationFailureCount: 0,
          partialPageFailureCount: 0,
          finalStatus: "COMPLETED",
        },
      }),
    },
  });

  const response = await orchestrator.analyze({
    submissionId: "sub-resilience-1",
    brandId: "demo-brand-teralune",
    campaignName: "Resilience Test",
    contentText: "TERALUNE PURE WATER 500ml",
    creativePayload: {
      assetId: "vis-asset",
      fileName: "test.pdf",
      mimeType: "application/pdf",
      base64Data: "JVBERi0xLjQK...",
    },
  });

  // Must succeed with PARTIAL status (NOT throw 503!)
  assert.equal(response.analysisStatus, "PARTIAL");
  assert.ok(response.findings.length >= 1, "Findings must be preserved");
  assert.ok(response.findings.some((f) => f.findingId === "vis-can-1"));
  assert.equal(response.ocrBlocks?.length, 1);
  assert.equal(response.ocrBlocks?.[0].text, "TERALUNE PURE WATER 500ml");
});

test("Regression Reproduction Scenario 1: Gemini succeeds in normal time -> returns HTTP 200 COMPLETED", async () => {
  const repository = new MockBrandKnowledgeRepository();
  const brandService = new BrandContextService(repository);

  const orchestrator = new AnalysisOrchestrator({
    brandContextService: brandService,
    deterministicEngine: new DeterministicTextGovernanceEngine(),
    aiAnalysisService: {
      analyze: async () => ({
        findings: [],
        providerUsed: "openrouter:google/gemini-3.6-flash",
        fallbackUsed: false,
      }),
    },
    visualAnalyzer: {
      analyze: async () => ({
        status: "COMPLETED",
        creativeMetadata: {
          assetId: "scen-1",
          fileName: "aether.pdf",
          format: "pdf",
          mimeType: "application/pdf",
          sizeBytes: 131702,
          pageCount: 1,
          processedPageCount: 1,
        },
        pages: [{ pageNumber: 1, width: 800, height: 600, rotation: 0, imageWidth: 800, imageHeight: 600, status: "ok", originalAssetId: "scen-1" }],
        ocrBlocks: [{ text: "Aether Tea", pageNumber: 1, boundingBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, confidence: 0.98, source: "ocr", uncertain: false, reviewStatus: "candidate" }],
        extractedText: "Aether Tea",
        observations: [],
        visualFindings: [],
        canonicalFindings: [],
        warnings: [],
        errors: [],
        visionProviderUsed: "gemini-vision:gemini-3.6-flash",
        diagnostics: {
          reviewId: "rev-s1",
          analysisRunId: "run-s1",
          creativeId: "scen-1",
          fileFormat: "pdf",
          fileSizeBytes: 131702,
          pageCount: 1,
          processedPageCount: 1,
          ocrBlockCount: 1,
          ocrDurationMs: 2346,
          deterministicDurationMs: 191,
          geminiDurationMs: 2000,
          geminiRetryCount: 0,
          candidateFindingCount: 0,
          uncertainFindingCount: 0,
          validationFailureCount: 0,
          partialPageFailureCount: 0,
          finalStatus: "COMPLETED",
        },
      }),
    },
  });

  const res = await handleAnalysisRequest(
    {
      title: "Aether Tea Campaign",
      contentType: "Campaign Copy",
      guidelineCollection: "Teralune Brand Identity & AI Guidelines v1.0",
      textContent: "Aether Tea",
    },
    { orchestrator },
  );

  assert.equal(res.status, 200);
  const body = res.body as { analysisStatus: string; fallbackUsed: boolean };
  assert.equal(body.analysisStatus, "COMPLETED");
  assert.equal(body.fallbackUsed, false);
});

test("Regression Reproduction Scenario 2: Gemini takes long/fails -> OpenRouter fallback completes -> HTTP 200 COMPLETED with fallbackUsed: true", async () => {
  const repository = new MockBrandKnowledgeRepository();
  const brandService = new BrandContextService(repository);

  const orchestrator = new AnalysisOrchestrator({
    brandContextService: brandService,
    deterministicEngine: new DeterministicTextGovernanceEngine(),
    aiAnalysisService: {
      analyze: async () => ({
        findings: [],
        providerUsed: "openrouter:google/gemini-3.6-flash",
        fallbackUsed: false,
      }),
    },
    visualAnalyzer: {
      analyze: async () => ({
        status: "COMPLETED",
        creativeMetadata: {
          assetId: "scen-2",
          fileName: "teralune.pdf",
          format: "pdf",
          mimeType: "application/pdf",
          sizeBytes: 213975,
          pageCount: 1,
          processedPageCount: 1,
        },
        pages: [{ pageNumber: 1, width: 800, height: 600, rotation: 0, imageWidth: 800, imageHeight: 600, status: "ok", originalAssetId: "scen-2" }],
        ocrBlocks: [{ text: "Teralune Summer Refreshment", pageNumber: 1, boundingBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, confidence: 0.95, source: "ocr", uncertain: false, reviewStatus: "candidate" }],
        extractedText: "Teralune Summer Refreshment",
        observations: [],
        visualFindings: [],
        canonicalFindings: [],
        warnings: ["Page 1: Primary vision provider failed; recovered using fallback vision provider (openrouter-vision)."],
        errors: [],
        visionProviderUsed: "openrouter-vision:google/gemini-2.0-flash-001",
        diagnostics: {
          reviewId: "rev-s2",
          analysisRunId: "run-s2",
          creativeId: "scen-2",
          fileFormat: "pdf",
          fileSizeBytes: 213975,
          pageCount: 1,
          processedPageCount: 1,
          ocrBlockCount: 1,
          ocrDurationMs: 2600,
          deterministicDurationMs: 500,
          geminiDurationMs: 12000,
          geminiRetryCount: 1,
          candidateFindingCount: 0,
          uncertainFindingCount: 0,
          validationFailureCount: 0,
          partialPageFailureCount: 0,
          finalStatus: "COMPLETED",
        },
      }),
    },
  });

  const res = await handleAnalysisRequest(
    {
      title: "Teralune Summer",
      contentType: "Campaign Copy",
      guidelineCollection: "Teralune Brand Identity & AI Guidelines v1.0",
      textContent: "Teralune Summer Refreshment",
      assetName: "teralune.pdf",
      assetBase64: "JVBERi0xLjQK...",
    },
    { orchestrator },
  );

  assert.equal(res.status, 200);
  const body = res.body as { analysisStatus: string; fallbackUsed: boolean; providerUsed: string };
  assert.equal(body.analysisStatus, "COMPLETED");
  assert.equal(body.fallbackUsed, true);
});

test("Regression Reproduction Scenario 3: Gemini rate limited (429) & text AI rate limited -> HTTP 200 PARTIAL with OCR and deterministic checks preserved", async () => {
  const repository = new MockBrandKnowledgeRepository();
  const brandService = new BrandContextService(repository);

  const orchestrator = new AnalysisOrchestrator({
    brandContextService: brandService,
    deterministicEngine: new DeterministicTextGovernanceEngine(),
    aiAnalysisService: {
      analyze: async () => {
        throw new Error("Rate limit exceeded across all providers (429)");
      },
    },
    visualAnalyzer: {
      analyze: async () => ({
        status: "PARTIAL",
        creativeMetadata: {
          assetId: "scen-3",
          fileName: "teralune-3.pdf",
          format: "pdf",
          mimeType: "application/pdf",
          sizeBytes: 213975,
          pageCount: 1,
          processedPageCount: 1,
        },
        pages: [{ pageNumber: 1, width: 800, height: 600, rotation: 0, imageWidth: 800, imageHeight: 600, status: "ok", originalAssetId: "scen-3" }],
        ocrBlocks: [
          {
            text: "TERALUNE 500ml",
            pageNumber: 1,
            boundingBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 },
            confidence: 0.95,
            source: "ocr",
            uncertain: false,
            reviewStatus: "candidate",
          },
        ],
        extractedText: "TERALUNE 500ml",
        observations: [],
        visualFindings: [],
        canonicalFindings: [
          {
            findingId: "vis-det-color",
            category: "VISUAL_COMPLIANCE",
            severity: "HIGH",
            status: "CONFLICTING",
            issue: "Deterministic color conflict",
            description: "Orange color detected",
            explanation: "Detected orange hue #E95126.",
            evidenceReferences: [
              {
                sourceId: "SRC-BRAND-01",
                sourceType: "approved_brand_knowledge",
                sourceTitle: "Teralune Guidelines",
                versionId: "1.0",
              },
            ],
            analysisProvider: "visual-deterministic",
          },
        ],
        warnings: ["AI visual interpretation unavailable (RATE_LIMITED)"],
        errors: ["AI visual interpretation unavailable (RATE_LIMITED)"],
        visionProviderUsed: undefined,
        diagnostics: {
          reviewId: "rev-s3",
          analysisRunId: "run-s3",
          creativeId: "scen-3",
          fileFormat: "pdf",
          fileSizeBytes: 213975,
          pageCount: 1,
          processedPageCount: 1,
          ocrBlockCount: 1,
          ocrDurationMs: 2500,
          deterministicDurationMs: 400,
          geminiDurationMs: 592,
          geminiRetryCount: 0,
          candidateFindingCount: 1,
          uncertainFindingCount: 0,
          validationFailureCount: 0,
          partialPageFailureCount: 0,
          finalStatus: "PARTIAL",
        },
      }),
    },
  });

  const res = await handleAnalysisRequest(
    {
      title: "Teralune Attempt 3",
      contentType: "Campaign Copy",
      guidelineCollection: "Teralune Brand Identity & AI Guidelines v1.0",
      textContent: "TERALUNE 500ml",
      assetName: "teralune-3.pdf",
      assetBase64: "JVBERi0xLjQK...",
    },
    { orchestrator },
  );

  // MUST return 200 (NOT 503!)
  assert.equal(res.status, 200, "Must return HTTP 200 for partial results instead of failing with 503");
  const body = res.body as {
    analysisStatus: string;
    findings: Array<{ id: string; title: string }>;
    ocrBlocks?: Array<{ text: string }>;
  };
  assert.equal(body.analysisStatus, "PARTIAL");
  assert.ok(body.findings.length >= 1, "Deterministic and visual findings must be returned");
  assert.ok(body.ocrBlocks && body.ocrBlocks.length >= 1, "OCR blocks must be returned");
  assert.equal(body.ocrBlocks[0].text, "TERALUNE 500ml");
});
