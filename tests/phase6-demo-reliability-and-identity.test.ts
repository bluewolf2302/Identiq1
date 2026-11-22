import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";

import {
  GET as getGuidelineDocuments,
  POST as postGuidelineDocument,
} from "../app/api/guidelines/documents/route";
import {
  AnalysisOrchestrator,
  handleAnalysisRequest,
} from "../lib/analysis";
import {
  formatContextWarning,
  formatDisplayGovernanceEngine,
  sanitizeClientDiagnosticMessage,
} from "../lib/analysis/error-sanitizer";
import {
  BrandContextService,
  BrandKnowledgeRepositoryError,
  SupabaseBrandKnowledgeRepository,
} from "../lib/brand-context";
import {
  DEMO_PERSONA_OPTIONS,
  TERALUNE_DEMO_BRAND_ID,
} from "../lib/demo/teralune-demo-fixtures";
import { readTeraluneSamplePdf } from "../lib/demo/teralune-server-samples";
import { DeterministicTextGovernanceEngine } from "../lib/governance";
import { SupabaseGuidelineDocumentRepository } from "../lib/guidelines/document-repository";
import { analyzeCreativeVisually, OpenRouterVisionAdapter } from "../lib/visual";

describe("Phase 6: Core Demo Reliability, Identity & Error Sanitization", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  describe("1. Non-UUID Sample Brand Guards (Guideline PDFs & Ad Reviews)", () => {
    it("SupabaseGuidelineDocumentRepository avoids PostgREST UUID errors for demo-brand-teralune", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-phase6.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_mock";

      const calledUrls: string[] = [];
      globalThis.fetch = (async (url: RequestInfo | URL) => {
        calledUrls.push(String(url));
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const repo = new SupabaseGuidelineDocumentRepository();
      const sessions = await repo.listDocumentSessions({
        brandId: TERALUNE_DEMO_BRAND_ID,
        organisationId: "11111111-1111-1111-1111-111111111111",
      });
      assert.deepEqual(sessions, []);

      const nonUuidSessions = await repo.listDocumentSessions({
        brandId: "not-a-uuid-string",
        organisationId: "11111111-1111-1111-1111-111111111111",
      });
      assert.deepEqual(nonUuidSessions, []);
      assert.equal(calledUrls.length, 0);

      await assert.rejects(
        () =>
          repo.saveDocumentSession({
            documentId: "gdoc-1",
            brandId: TERALUNE_DEMO_BRAND_ID,
            organisationId: "11111111-1111-1111-1111-111111111111",
            title: "Sample",
            fileName: "sample.pdf",
            mimeType: "application/pdf",
            fileSizeBytes: 100,
            sha256: "a".repeat(64),
            sourceDocumentVersion: "v1",
            storageKey: "k",
            storageBackend: "local_file",
            status: "ready_for_review",
            totalPageCount: 1,
            ocrUsed: false,
            ocrPageCount: 0,
            failedPageCount: 0,
            pages: [],
            warnings: [],
            proposals: [],
            uploadedBy: "Reviewer",
            createdAt: "2026-11-21T00:00:00.000Z",
            updatedAt: "2026-11-21T00:00:00.000Z",
          }),
        BrandKnowledgeRepositoryError,
      );
      assert.equal(calledUrls.length, 0);
    });

    it("GET and POST /api/guidelines/documents handle demo-brand-teralune cleanly without 500 or UUID crashes", async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      const getReq = new NextRequest(
        `http://localhost:3000/api/guidelines/documents?brandId=${TERALUNE_DEMO_BRAND_ID}`,
      );
      const getRes = await getGuidelineDocuments(getReq);
      assert.equal(getRes.status, 200);
      const getBody = (await getRes.json()) as {
        sessions: unknown[];
        brand: { brandId: string; isSample?: boolean };
        sampleGuidelineDocument?: { readOnly: boolean; version: string };
      };
      assert.deepEqual(getBody.sessions, []);
      assert.equal(getBody.brand.brandId, TERALUNE_DEMO_BRAND_ID);
      assert.equal(getBody.sampleGuidelineDocument?.readOnly, true);

      const form = new FormData();
      form.set("brandId", TERALUNE_DEMO_BRAND_ID);
      const postReq = new NextRequest(
        "http://localhost:3000/api/guidelines/documents",
        {
          method: "POST",
          body: form,
        },
      );
      const postRes = await postGuidelineDocument(postReq);
      assert.equal(postRes.status, 400);
    });

    it("analyzes Teralune compliant & risky PDFs cleanly under simulated customer org context without UUID failure", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-phase6.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_mock";
      delete process.env.GEMINI_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      const postgrestCalls: string[] = [];
      globalThis.fetch = (async (url: RequestInfo | URL) => {
        postgrestCalls.push(String(url));
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const orchestrator = new AnalysisOrchestrator({
        brandContextService: new BrandContextService(
          new SupabaseBrandKnowledgeRepository(),
        ),
        deterministicEngine: new DeterministicTextGovernanceEngine(),
        aiAnalysisService: {
          analyze: async () => ({
            findings: [],
            providerUsed: "deterministic-fallback",
            fallbackUsed: true,
          }),
        },
        visualAnalyzer: {
          analyze: (input) =>
            analyzeCreativeVisually({
              creative: {
                assetId: input.creative.assetId ?? "asset-test",
                fileName: input.creative.fileName,
                declaredMimeType: input.creative.mimeType,
                base64Data: input.creative.base64Data,
              },
              brandContext: input.brandContext,
              reviewId: input.reviewId,
              analysisRunId: input.analysisRunId,
            }),
        },
      });

      const [compliantPdf, riskyPdf] = await Promise.all([
        readTeraluneSamplePdf("compliant"),
        readTeraluneSamplePdf("risky"),
      ]);

      const compliantRes = await handleAnalysisRequest(
        {
          title: "Sample Compliant PDF Review",
          contentType: "Campaign Copy",
          guidelineCollection: "Teralune Brand Identity & AI Guidelines v1.0",
          brandId: TERALUNE_DEMO_BRAND_ID,
          organisationId: "11111111-1111-1111-1111-111111111111",
          textContent: "",
          assetName: compliantPdf.fileName,
          assetBase64: compliantPdf.base64Data,
          assetMimeType: compliantPdf.mimeType,
        },
        { orchestrator },
      );

      const riskyRes = await handleAnalysisRequest(
        {
          title: "Sample Risky PDF Review",
          contentType: "Campaign Copy",
          guidelineCollection: "Teralune Brand Identity & AI Guidelines v1.0",
          brandId: TERALUNE_DEMO_BRAND_ID,
          organisationId: "11111111-1111-1111-1111-111111111111",
          textContent: "",
          assetName: riskyPdf.fileName,
          assetBase64: riskyPdf.base64Data,
          assetMimeType: riskyPdf.mimeType,
        },
        { orchestrator },
      );

      assert.equal(compliantRes.status, 200);
      assert.equal(riskyRes.status, 200);
      assert.equal(
        postgrestCalls.some((u) => u.includes("demo-brand-teralune")),
        false,
      );
    });
  });

  describe("2. Landing CTA, Demo Persona & Guided Tour Contracts", () => {
    it("DEMO_PERSONA_OPTIONS never includes hardcoded Maya Lin or Daniel Brooks names", () => {
      const serialized = JSON.stringify(DEMO_PERSONA_OPTIONS);
      assert.equal(/Maya Lin|Daniel Brooks|displayName/i.test(serialized), false);
    });

    it("LandingView renders single primary Enter IdentIQ CTA and AppShell/Dashboard remove Demo Workspace chrome", () => {
      const landingSrc = fs.readFileSync(
        path.join(process.cwd(), "components/onboarding/LandingView.tsx"),
        "utf8",
      );
      assert.equal(landingSrc.includes("Enter IdentIQ"), true);
      assert.equal(landingSrc.includes("Explore the Teralune Demo"), false);

      const appShellSrc = fs.readFileSync(
        path.join(process.cwd(), "components/AppShell.tsx"),
        "utf8",
      );
      assert.equal(appShellSrc.includes("Demo Workspace"), false);

      const dashboardSrc = fs.readFileSync(
        path.join(process.cwd(), "app/page.tsx"),
        "utf8",
      );
      assert.equal(dashboardSrc.includes("Demo Environment Notice"), false);
      assert.equal(dashboardSrc.includes("Demo Workspace ·"), false);
    });
  });

  describe("3. AI Provider Error & Warning Sanitization", () => {
    it("strips OpenRouter 402 JSON, Gemini/OpenRouter names, and env keys while preserving fallback copy", () => {
      const sanitized402 = sanitizeClientDiagnosticMessage(
        'OpenRouter vision HTTP 402: {"error":{"message":"Insufficient credits","code":402}}',
      );
      assert.equal(sanitized402.includes("OpenRouter"), false);
      assert.equal(sanitized402.includes("402"), false);
      assert.equal(sanitized402.includes("Insufficient credits"), false);
      assert.equal(sanitized402.includes("{"), false);
      assert.equal(
        sanitized402.includes("Deterministic visual checks and OCR results were preserved."),
        true,
      );

      const sanitizedKey = sanitizeClientDiagnosticMessage(
        "GEMINI_API_KEY is not configured; OPENROUTER_API_KEY fallback unavailable",
      );
      assert.equal(/GEMINI|OPENROUTER|API_KEY/i.test(sanitizedKey), false);

      assert.equal(
        formatContextWarning("NO_PUBLISHED_KNOWLEDGE").includes("NO_PUBLISHED_KNOWLEDGE"),
        false,
      );
      assert.equal(
        formatDisplayGovernanceEngine("openrouter-vision:qwen/qwen2.5-vl-72b").includes(
          "OpenRouter",
        ),
        false,
      );
      assert.equal(
        formatDisplayGovernanceEngine("gemini-vision:gemini-2.5-flash").includes("Gemini"),
        false,
      );
    });

    it("sanitizes OpenRouter 402 failure through AnalysisOrchestrator while keeping PARTIAL status", async () => {
      const riskyPdf = await readTeraluneSamplePdf("risky");
      const openRouterFailing402 = new OpenRouterVisionAdapter({
        apiKey: "sk-or-test-key",
        model: "qwen/qwen2.5-vl-72b-instruct",
        fetcher: async () =>
          new Response(
            JSON.stringify({
              error: { message: "Insufficient credits on OpenRouter account", code: 402 },
            }),
            { status: 402, headers: { "Content-Type": "application/json" } },
          ),
      });

      const orchestrator = new AnalysisOrchestrator({
        brandContextService: new BrandContextService(
          new SupabaseBrandKnowledgeRepository(),
        ),
        deterministicEngine: new DeterministicTextGovernanceEngine(),
        aiAnalysisService: {
          analyze: async () => ({
            findings: [],
            providerUsed: "deterministic-fallback",
            fallbackUsed: true,
          }),
        },
        visualAnalyzer: {
          analyze: (input) =>
            analyzeCreativeVisually({
              creative: {
                assetId: input.creative.assetId ?? "asset-test",
                fileName: input.creative.fileName,
                declaredMimeType: input.creative.mimeType,
                base64Data: input.creative.base64Data,
              },
              brandContext: input.brandContext,
              reviewId: input.reviewId,
              analysisRunId: input.analysisRunId,
              dependencies: {
                visionAdapter: openRouterFailing402,
              },
            }),
        },
      });

      const res = await handleAnalysisRequest(
        {
          title: "OpenRouter 402 Sanitization Check",
          contentType: "Campaign Copy",
          guidelineCollection: "Teralune Brand Identity & AI Guidelines v1.0",
          brandId: TERALUNE_DEMO_BRAND_ID,
          textContent: "",
          assetName: riskyPdf.fileName,
          assetBase64: riskyPdf.base64Data,
          assetMimeType: riskyPdf.mimeType,
        },
        { orchestrator },
      );

      assert.equal(res.status, 200);
      const body = res.body as {
        analysisStatus: string;
        visualSummary?: {
          warnings: string[];
          errors: string[];
          pages: Array<{ error?: string }>;
        };
      };
      assert.equal(body.analysisStatus, "PARTIAL");

      const allClientMessages = [
        ...(body.visualSummary?.warnings ?? []),
        ...(body.visualSummary?.errors ?? []),
        ...(body.visualSummary?.pages.map((p) => p.error || "") ?? []),
      ].join(" ");

      assert.equal(/openrouter|gemini|402|insufficient credits|\{"error"/i.test(allClientMessages), false);
      assert.equal(
        allClientMessages.includes("Deterministic visual checks and OCR results were preserved."),
        true,
      );
    });
  });
});
