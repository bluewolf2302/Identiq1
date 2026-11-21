import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";

import { GET as getDemoReadiness } from "../app/api/demo/readiness/route";
import { GET as getTeraluneSample } from "../app/api/samples/teralune-ad/route";
import { handleAnalysisRequest } from "../lib/analysis/api-handler";
import { createAnalysisOrchestrator } from "../lib/analysis/composition-root";
import { SupabaseBrandKnowledgeRepository } from "../lib/brand-context/supabase-brand-repository";
import { DEMO_CONFIG } from "../lib/demo/config";
import {
  buildCleanResetBeforeSampleLoad,
  partitionWorkspaceAssets,
  resolveDemoPersonaConfig,
  TERALUNE_CURATED_DEMO_ASSETS,
  TERALUNE_DEMO_BRAND_ID,
  TERALUNE_REVIEW_SAMPLE_CARDS,
} from "../lib/demo/teralune-demo-fixtures";
import {
  evaluateDemoReadiness,
  readTeraluneSamplePdf,
  resolveTeraluneSampleSpec,
} from "../lib/demo/teralune-server-samples";
import type { BrandAsset } from "../lib/types";

describe("Phase 5: Teralune Judge-Ready Demo Experience", () => {
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

  describe("1. Demo Asset Fixtures & Customer Isolation", () => {
    it("all curated Teralune SVG assets exist on disk and render valid SVG markup", async () => {
      const svgAssets = TERALUNE_CURATED_DEMO_ASSETS.filter(
        (asset) => asset.format === "SVG" && asset.previewUrl,
      );
      assert.equal(svgAssets.length, 4);

      for (const asset of svgAssets) {
        assert.equal(asset.isDemoFixture, true);
        assert.equal(asset.brandId, TERALUNE_DEMO_BRAND_ID);
        const rel = asset.previewUrl!.replace(/^\/+/, "");
        const content = await fs.readFile(
          path.join(process.cwd(), "public", rel),
          "utf8",
        );
        assert.ok(content.includes("<svg"), `${rel} should be valid SVG markup`);
        assert.ok(content.includes("Teralune") || content.includes("TERALUNE"));
      }
    });

    it("partitionWorkspaceAssets isolates demo fixtures strictly to the demo workspace", () => {
      const customAsset: BrandAsset = {
        id: "cust-asset-1",
        name: "Acme Customer Logo",
        category: "Logos",
        format: "PNG",
        dimensions: "512x512",
        status: "Approved",
        colorTone: "mint",
        usageNote: "Customer organisation only.",
        updatedAt: "2026-11-20",
      };

      const mixed = [...TERALUNE_CURATED_DEMO_ASSETS, customAsset];

      const demoPartition = partitionWorkspaceAssets(mixed, {
        isDemoWorkspace: true,
      });
      assert.equal(demoPartition.demoAssets.length, TERALUNE_CURATED_DEMO_ASSETS.length);
      assert.equal(demoPartition.workspaceAssets.length, 1);
      assert.equal(demoPartition.workspaceAssets[0]!.id, "cust-asset-1");

      const customerPartition = partitionWorkspaceAssets(mixed, {
        isDemoWorkspace: false,
      });
      assert.equal(customerPartition.demoAssets.length, 0);
      assert.equal(customerPartition.workspaceAssets.length, 1);
      assert.equal(customerPartition.workspaceAssets[0]!.id, "cust-asset-1");
    });

    it("resolveDemoPersonaConfig maps Brand Manager and Reviewer without auth authority", () => {
      const manager = resolveDemoPersonaConfig("Brand Manager");
      const reviewer = resolveDemoPersonaConfig("Reviewer");
      const fallback = resolveDemoPersonaConfig("ArbitraryUnknownValue");

      assert.equal(manager.persona, "Brand Manager");
      assert.equal(manager.roleTitle, "Brand Manager");
      assert.equal(reviewer.persona, "Reviewer");
      assert.equal(reviewer.roleTitle, "Reviewer");
      assert.equal(fallback.persona, "Brand Manager");
    });
  });

  describe("2. Supplied Source PDFs & /api/samples/teralune-ad", () => {
    it("resolves compliant, risky, and guidelines variants cleanly to supplied PDFs", async () => {
      assert.equal(resolveTeraluneSampleSpec("compliant").variant, "compliant");
      assert.equal(resolveTeraluneSampleSpec("risky").variant, "risky");
      assert.equal(resolveTeraluneSampleSpec("guidelines").variant, "guidelines");
      assert.equal(resolveTeraluneSampleSpec(null).variant, "legacy");

      const [compliant, risky, guidelines] = await Promise.all([
        readTeraluneSamplePdf("compliant"),
        readTeraluneSamplePdf("risky"),
        readTeraluneSamplePdf("guidelines"),
      ]);

      for (const sample of [compliant, risky, guidelines]) {
        assert.equal(sample.mimeType, "application/pdf");
        assert.ok(sample.sizeBytes > 1000, `${sample.variant} PDF should be non-empty`);
        const header = Buffer.from(sample.base64Data, "base64")
          .subarray(0, 5)
          .toString("latin1");
        assert.equal(header, "%PDF-");
      }

      assert.notEqual(compliant.base64Data, risky.base64Data);
      assert.notEqual(compliant.fileName, risky.fileName);
    });

    it("GET /api/samples/teralune-ad returns requested variant JSON", async () => {
      const compliantReq = new NextRequest(
        "http://localhost:3000/api/samples/teralune-ad?sample=compliant",
      );
      const compliantRes = await getTeraluneSample(compliantReq);
      assert.equal(compliantRes.status, 200);
      const compliantJson = (await compliantRes.json()) as {
        variant: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
      };
      assert.equal(compliantJson.variant, "compliant");
      assert.equal(compliantJson.mimeType, "application/pdf");
      assert.ok(compliantJson.fileName.includes("Compliant"));

      const riskyReq = new NextRequest(
        "http://localhost:3000/api/samples/teralune-ad?sample=risky",
      );
      const riskyRes = await getTeraluneSample(riskyReq);
      assert.equal(riskyRes.status, 200);
      const riskyJson = (await riskyRes.json()) as {
        variant: string;
        fileName: string;
      };
      assert.equal(riskyJson.variant, "risky");
      assert.ok(riskyJson.fileName.includes("0_Percent"));
    });
  });

  describe("3. Clean Review Form Reset Before Sample Load", () => {
    it("clears previous text, file attachment, and errors when switching samples", () => {
      const riskyCard = TERALUNE_REVIEW_SAMPLE_CARDS.find((c) => c.key === "risky")!;
      const reset = buildCleanResetBeforeSampleLoad(riskyCard);

      assert.equal(reset.title, riskyCard.prefillTitle);
      assert.equal(reset.contentType, "Campaign Copy");
      assert.equal(reset.textContent, "");
      assert.equal(reset.errorMessage, "");
      assert.equal(reset.fileError, "");
      assert.equal(reset.assetName, undefined);
      assert.equal(reset.assetBase64, undefined);
      assert.equal(reset.assetMimeType, undefined);
      assert.equal(reset.assetPreviewUrl, undefined);
      assert.equal(reset.assetSizeBytes, undefined);
    });
  });

  describe("4. Server Readiness Endpoint (/api/demo/readiness)", () => {
    it("reports readiness accurately without ever leaking API keys or secrets", async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      const sentinelGemini = "AIzaSy-SUPER-SECRET-GEMINI-KEY-DO-NOT-LEAK";
      const sentinelOpenRouter = "sk-or-v1-SUPER-SECRET-OPENROUTER-DO-NOT-LEAK";
      const sentinelServiceRole = "sb_secret_SUPER-SECRET-SUPABASE-ROLE-KEY";
      process.env.GEMINI_API_KEY = sentinelGemini;
      process.env.OPENROUTER_API_KEY = sentinelOpenRouter;
      process.env.SUPABASE_SERVICE_ROLE_KEY = sentinelServiceRole;

      const report = await evaluateDemoReadiness();
      assert.equal(report.status, "ready");
      assert.equal(report.geminiConfigured, true);
      assert.equal(report.openrouterConfigured, true);
      assert.equal(report.aiProviderReady, true);
      assert.equal(report.serviceRoleConfigured, true);
      assert.equal(report.sampleFilesAvailable, true);
      assert.equal(report.sampleFiles.guidelinesPdf, true);
      assert.equal(report.sampleFiles.compliantAdPdf, true);
      assert.equal(report.sampleFiles.riskyAdPdf, true);
      assert.equal(report.teraluneBrandReady, true);
      assert.ok(report.publishedRuleCount > 0);
      assert.equal(report.latestPublishedVersion, "1.0");

      const res = await getDemoReadiness();
      assert.equal(res.status, 200);
      const rawText = await res.text();
      assert.equal(rawText.includes(sentinelGemini), false);
      assert.equal(rawText.includes(sentinelOpenRouter), false);
      assert.equal(rawText.includes(sentinelServiceRole), false);
    });
  });

  describe("5. SupabaseBrandKnowledgeRepository Demo Brand Non-Crash", () => {
    it("appends demo-brand-teralune only for demo/global listings and serves it cleanly without UUID errors", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-demo.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_mock";

      const queries: string[] = [];
      globalThis.fetch = (async (url: RequestInfo | URL) => {
        queries.push(String(url));
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const repo = new SupabaseBrandKnowledgeRepository();
      const demoBrands = await repo.listBrands(DEMO_CONFIG.ORGANISATION_ID);
      assert.ok(
        demoBrands.some((b) => b.brandId === TERALUNE_DEMO_BRAND_ID),
        "Demo org should list demo-brand-teralune",
      );

      const customerBrands = await repo.listBrands("11111111-1111-1111-1111-111111111111");
      assert.equal(
        customerBrands.some((b) => b.brandId === TERALUNE_DEMO_BRAND_ID),
        false,
        "Customer org listing must not include demo-brand-teralune",
      );

      const teraluneBrand = await repo.getBrand(TERALUNE_DEMO_BRAND_ID);
      const teraluneEntries = await repo.listKnowledgeEntries({
        brandId: TERALUNE_DEMO_BRAND_ID,
      });
      const teraluneSnapshots = await repo.listVersionSnapshots(TERALUNE_DEMO_BRAND_ID);
      assert.equal(teraluneBrand?.brandId, TERALUNE_DEMO_BRAND_ID);
      assert.ok(teraluneEntries.length > 0);
      assert.equal(teraluneSnapshots.length, 1);

      // Verify zero PostgREST UUID queries targeted "demo-brand-teralune" directly
      assert.equal(
        queries.some((u) => u.includes("demo-brand-teralune")),
        false,
      );
    });
  });

  describe("6. Real End-to-End Analysis Contrast (Compliant vs Risky PDFs)", () => {
    it("analyzes real compliant vs risky Teralune PDFs through the live pipeline without hardcoded scores", async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      const [compliantPdf, riskyPdf] = await Promise.all([
        readTeraluneSamplePdf("compliant"),
        readTeraluneSamplePdf("risky"),
      ]);

      const orchestrator = createAnalysisOrchestrator();

      const compliantResult = await handleAnalysisRequest(
        {
          title: "Teralune Compliant Campaign Test",
          contentType: "Campaign Copy",
          guidelineCollection: "Teralune Brand Identity & AI Guidelines v1.0",
          brandId: TERALUNE_DEMO_BRAND_ID,
          textContent: "",
          assetName: compliantPdf.fileName,
          assetBase64: compliantPdf.base64Data,
          assetMimeType: compliantPdf.mimeType,
        },
        { orchestrator },
      );

      const riskyResult = await handleAnalysisRequest(
        {
          title: "Teralune Risky Campaign Test",
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

      assert.equal(compliantResult.status, 200);
      assert.equal(riskyResult.status, 200);

      const compliantBody = compliantResult.body as {
        brandId: string;
        brandVersionId: string;
        complianceScore: number;
        findings: Array<{ ruleId?: string; status: string; issue: string; sourceTitle?: string }>;
        visualSummary?: { extractedText?: string; pageCount: number };
      };
      const riskyBody = riskyResult.body as {
        brandId: string;
        brandVersionId: string;
        complianceScore: number;
        findings: Array<{ ruleId?: string; status: string; issue: string; sourceTitle?: string }>;
        visualSummary?: { extractedText?: string; pageCount: number };
      };

      assert.equal(compliantBody.brandId, TERALUNE_DEMO_BRAND_ID);
      assert.equal(riskyBody.brandId, TERALUNE_DEMO_BRAND_ID);
      assert.equal(compliantBody.brandVersionId, "1.0");
      assert.equal(riskyBody.brandVersionId, "1.0");
      assert.ok((riskyBody.visualSummary?.extractedText || "").length > 20);
      assert.ok((compliantBody.visualSummary?.extractedText || "").length > 20);
      assert.ok(
        riskyBody.findings.length > compliantBody.findings.length,
        `Expected risky PDF (${riskyBody.findings.length} findings) to have more findings than compliant PDF (${compliantBody.findings.length} findings)`,
      );
      assert.ok(
        compliantBody.complianceScore > riskyBody.complianceScore,
        `Expected compliant score (${compliantBody.complianceScore}) > risky score (${riskyBody.complianceScore})`,
      );
    });
  });
});
