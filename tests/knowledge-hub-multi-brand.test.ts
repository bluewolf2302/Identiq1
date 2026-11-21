import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { GET as brandsGet, POST as brandsPost } from "../app/api/brands/route";
import {
  GET as knowledgeGet,
  POST as knowledgePost,
} from "../app/api/knowledge/route";
import {
  AnalysisOrchestrator,
  handleAnalysisRequest,
} from "../lib/analysis";
import {
  BrandContextService,
  CrossTenantBrandAccessError,
  FileBackedBrandKnowledgeRepository,
} from "../lib/brand-context";
import { DeterministicTextGovernanceEngine } from "../lib/governance";
import { analyzeCreativeVisually } from "../lib/visual";

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "identiq-kb-multibrand-"),
);
let testCounter = 0;

function nextStorePath(): string {
  testCounter += 1;
  return path.join(tempDir, `store-${testCounter}.json`);
}

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.IDENTIQ_KNOWLEDGE_STORE_PATH;
  delete process.env.IDENTIQ_FORCE_LOCAL_KNOWLEDGE_STORE;
});

function createTestOrchestrator(repo: FileBackedBrandKnowledgeRepository) {
  return new AnalysisOrchestrator({
    brandContextService: new BrandContextService(repo),
    deterministicEngine: new DeterministicTextGovernanceEngine(),
    aiAnalysisService: {
      analyze: async () => ({
        findings: [],
        providerUsed: "test-stub",
        fallbackUsed: false,
      }),
    },
    getBrandKnowledgeRecord: (brandId: string) => repo.getBrandKnowledge({ brandId }),
    visualAnalyzer: {
      analyze: async ({
        creative,
        brandContext,
        brandKnowledgeRecord,
        reviewId,
        analysisRunId,
      }) =>
        analyzeCreativeVisually({
          creative: {
            assetId: creative.assetId ?? `${reviewId}-creative`,
            fileName: creative.fileName,
            declaredMimeType: creative.mimeType,
            base64Data: creative.base64Data,
          },
          brandContext,
          brandKnowledgeRecord,
          reviewId,
          analysisRunId,
        }),
    },
  });
}

async function createSolidPngBase64(rgb: {
  r: number;
  g: number;
  b: number;
}): Promise<string> {
  const buf = await sharp({
    create: { width: 400, height: 400, channels: 3, background: rgb },
  })
    .png()
    .toBuffer();
  return buf.toString("base64");
}

describe("Live Multi-Brand Knowledge Hub & Analysis Integration", () => {
  beforeEach(() => {
    delete process.env.IDENTIQ_KNOWLEDGE_STORE_PATH;
    delete process.env.IDENTIQ_FORCE_LOCAL_KNOWLEDGE_STORE;
  });

  it("1. Isolates brands and tenants: Brand A knowledge and findings never leak to Brand B or another org", async () => {
    const storePath = nextStorePath();
    const repo = new FileBackedBrandKnowledgeRepository({ storePath });

    const brandA = await repo.createBrand({
      brandId: "brand-alpha",
      organisationId: "org-one",
      brandName: "Alpha Skin",
    });
    const brandB = await repo.createBrand({
      brandId: "brand-beta",
      organisationId: "org-two",
      brandName: "Beta Bank",
    });

    await repo.saveKnowledgeEntry({
      brandId: brandA.brandId,
      organisationId: "org-one",
      section: "prohibited",
      title: "No Alpha Cure Claims",
      content: "Do not claim instant wrinkle erasure.",
      avoidTerm: "instant erasure",
      publicationStatus: "published",
      sourceDocumentId: "DOC-ALPHA-1",
      sourceTitle: "Alpha Claims Bible",
    });

    const orgOneBrands = await repo.listBrands("org-one");
    assert.ok(orgOneBrands.some((b) => b.brandId === "brand-alpha"));
    assert.equal(
      orgOneBrands.some((b) => b.brandId === "brand-beta"),
      false,
    );

    const betaEntries = await repo.listKnowledgeEntries({
      brandId: brandB.brandId,
      organisationId: "org-two",
    });
    assert.equal(betaEntries.length, 0);

    await assert.rejects(
      () =>
        repo.listKnowledgeEntries({
          brandId: brandA.brandId,
          organisationId: "org-two",
        }),
      (err) => err instanceof CrossTenantBrandAccessError,
    );
  });

  it("2. Enforces Draft vs Published vs Archived lifecycle in live analysis", async () => {
    const storePath = nextStorePath();
    const repo = new FileBackedBrandKnowledgeRepository({ storePath });

    const brand = await repo.createBrand({
      brandId: "brand-lifecycle",
      organisationId: "local-org",
      brandName: "Solstice Beverage",
    });

    // Save as DRAFT
    const draftRule = await repo.saveKnowledgeEntry({
      brandId: brand.brandId,
      organisationId: "local-org",
      section: "prohibited",
      title: "Prohibit Guaranteed Energy",
      content: "Never use the phrase guaranteed energy boost.",
      avoidTerm: "guaranteed energy",
      publicationStatus: "draft",
      sourceDocumentId: "SRC-SOL-01",
      sourceTitle: "Solstice Rules",
    });

    const orchestrator = createTestOrchestrator(repo);

    // Run analysis while rule is DRAFT -> should NOT enforce draft rule, and warn NO_PUBLISHED_KNOWLEDGE
    const draftRun = await orchestrator.analyze({
      submissionId: "sub-draft",
      brandId: brand.brandId,
      organisationId: "local-org",
      campaignName: "Draft Check",
      contentText: "Try Solstice today for a guaranteed energy lift!",
      contentPlatform: "web",
    });
    assert.equal(draftRun.analysisStatus, "PARTIAL");
    assert.ok(draftRun.contextWarnings?.includes("NO_PUBLISHED_KNOWLEDGE"));
    assert.equal(
      draftRun.findings.some((f) =>
        f.issue.toLowerCase().includes("guaranteed energy"),
      ),
      false,
    );

    // PUBLISH the rule -> now active analysis MUST detect it with exact provenance
    await repo.publishKnowledgeEntry({
      entryId: draftRule.id,
      brandId: brand.brandId,
      organisationId: "local-org",
      actor: "Harsh Kumar",
    });

    const publishedRun = await orchestrator.analyze({
      submissionId: "sub-published",
      brandId: brand.brandId,
      organisationId: "local-org",
      campaignName: "Published Check",
      contentText: "Try Solstice today for a guaranteed energy lift!",
      contentPlatform: "web",
    });
    const flagged = publishedRun.findings.find(
      (f) =>
        f.status === "CONFLICTING" &&
        f.issue.toLowerCase().includes("guaranteed energy"),
    );
    assert.ok(flagged, "Published prohibited term must be flagged");
    assert.equal(flagged?.evidenceReferences[0]?.sourceId, "SRC-SOL-01");
    assert.equal(flagged?.evidenceReferences[0]?.versionId, "v1");

    // ARCHIVE the rule -> subsequent analysis must stop enforcing it
    await repo.archiveKnowledgeEntry({
      entryId: draftRule.id,
      brandId: brand.brandId,
      organisationId: "local-org",
    });

    const archivedRun = await orchestrator.analyze({
      submissionId: "sub-archived",
      brandId: brand.brandId,
      organisationId: "local-org",
      campaignName: "Archived Check",
      contentText: "Try Solstice today for a guaranteed energy lift!",
      contentPlatform: "web",
    });
    assert.equal(
      archivedRun.findings.some((f) =>
        f.issue.toLowerCase().includes("guaranteed energy"),
      ),
      false,
    );
  });

  it("3. Supports Knowledge Hub versioning: v2 updates active runs while v1 snapshot stays resolvable", async () => {
    const storePath = nextStorePath();
    const repo = new FileBackedBrandKnowledgeRepository({ storePath });

    const brand = await repo.createBrand({
      brandId: "brand-versioned",
      organisationId: "local-org",
      brandName: "Veloce Audio",
    });

    const v1Entry = await repo.saveKnowledgeEntry({
      brandId: brand.brandId,
      organisationId: "local-org",
      section: "facts",
      kind: "PRODUCT_PRICE",
      title: "PRODUCT_PRICE: Flagship Headphones",
      content: "$199 USD",
      publicationStatus: "published",
      sourceDocumentId: "SRC-VEL-PRICING",
      sourceTitle: "Veloce Pricing Sheet",
    });
    assert.equal(v1Entry.versionId, "v1");

    // Publish an update to $249 USD (creates v2)
    const v2Entry = await repo.saveKnowledgeEntry({
      id: v1Entry.id,
      brandId: brand.brandId,
      organisationId: "local-org",
      section: "facts",
      kind: "PRODUCT_PRICE",
      title: "PRODUCT_PRICE: Flagship Headphones",
      content: "$249 USD",
      publicationStatus: "published",
      sourceDocumentId: "SRC-VEL-PRICING",
      sourceTitle: "Veloce Pricing Sheet",
    });
    assert.equal(v2Entry.versionNumber, 2);
    assert.equal(v2Entry.versionId, "v2");

    const snapshots = await repo.listVersionSnapshots(brand.brandId);
    assert.equal(snapshots.length, 2);
    assert.deepEqual(
      snapshots.map((s) => s.versionId),
      ["v2", "v1"],
    );

    const orchestrator = createTestOrchestrator(repo);

    // Latest active version (v2: $249 USD) conflicts with $199 USD copy
    const latestRun = await orchestrator.analyze({
      submissionId: "sub-v2",
      brandId: brand.brandId,
      organisationId: "local-org",
      campaignName: "Latest Price Check",
      contentText: "Order Veloce headphones now for $199.",
      contentPlatform: "web",
    });
    assert.equal(latestRun.brandVersionId, "v2");
    assert.ok(
      latestRun.findings.some((f) => f.status === "CONFLICTING"),
      "Latest v2 ($249) must conflict with $199 ad copy",
    );

    // Pinning historical versionId "v1" resolves $199 USD without conflict
    const pinnedV1Run = await orchestrator.analyze({
      submissionId: "sub-v1",
      brandId: brand.brandId,
      organisationId: "local-org",
      brandVersionId: "v1",
      campaignName: "Historical Price Check",
      contentText: "Order Veloce headphones now for $199.",
      contentPlatform: "web",
    });
    assert.equal(pinnedV1Run.brandVersionId, "v1");
    assert.equal(
      pinnedV1Run.findings.some((f) => f.status === "CONFLICTING"),
      false,
    );
  });

  it("4. Persists brands, entries, and snapshots across repository restarts and handles concurrent writes", async () => {
    const storePath = nextStorePath();
    const repo1 = new FileBackedBrandKnowledgeRepository({ storePath });

    const created = await repo1.createBrand({
      brandId: "brand-persist",
      organisationId: "local-org",
      brandName: "Nimbus Cloud",
    });

    await Promise.all([
      repo1.saveKnowledgeEntry({
        brandId: created.brandId,
        organisationId: "local-org",
        section: "guidelines",
        title: "Tone Clarity",
        content: "Keep onboarding instructions concise and jargon-free.",
        publicationStatus: "published",
      }),
      repo1.saveKnowledgeEntry({
        brandId: created.brandId,
        organisationId: "local-org",
        section: "prohibited",
        title: "No Zero-Downtime Guarantees",
        content: "Never promise 100% uptime.",
        avoidTerm: "100% uptime",
        publicationStatus: "published",
      }),
    ]);

    // Simulate fresh server boot / reload with new repository instance
    const repo2 = new FileBackedBrandKnowledgeRepository({ storePath });
    const reloadedBrand = await repo2.getBrand(created.brandId);
    assert.ok(reloadedBrand);
    assert.equal(reloadedBrand?.publishedEntryCount, 2);

    const reloadedEntries = await repo2.listKnowledgeEntries({
      brandId: created.brandId,
    });
    assert.equal(reloadedEntries.length, 2);

    const snapshots = await repo2.listVersionSnapshots(created.brandId);
    assert.equal(snapshots.length, 2);
    assert.deepEqual(
      snapshots.map((s) => s.versionId),
      ["v2", "v1"],
    );
  });

  it("5. Two-Brand End-to-End Acceptance Test: Brand A (Crimson #DC2626 / miracle cure / $49) vs Brand B (Emerald #10B981 / instant detox / $79)", async () => {
    const storePath = nextStorePath();
    const repo = new FileBackedBrandKnowledgeRepository({ storePath });

    // Create Brand A: Crimson Studio
    const brandA = await repo.createBrand({
      brandId: "brand-crimson-studio",
      organisationId: "local-org",
      brandName: "Crimson Studio",
      voiceAndToneSummary: "Bold, architectural, design-focused.",
    });
    await repo.saveKnowledgeEntry({
      brandId: brandA.brandId,
      section: "prohibited",
      title: "Prohibit Medical Miracle Language",
      content: "Never use the unsubstantiated phrase miracle cure.",
      avoidTerm: "miracle cure",
      publicationStatus: "published",
      sourceDocumentId: "SRC-CRIMSON-CLAIMS",
      sourceTitle: "Crimson Studio Legal Claims Policy",
      sectionRef: "Section 4.1",
      pageNumber: 7,
    });
    await repo.saveKnowledgeEntry({
      brandId: brandA.brandId,
      section: "facts",
      kind: "PRODUCT_PRICE",
      title: "PRODUCT_PRICE: Crimson Starter Kit",
      content: "$49",
      publicationStatus: "published",
      sourceDocumentId: "SRC-CRIMSON-PROD",
      sourceTitle: "Crimson Studio Product Catalog",
    });
    await repo.saveKnowledgeEntry({
      brandId: brandA.brandId,
      section: "visual",
      title: "Crimson Primary Palette",
      content: "Use Crimson Red #DC2626 as the primary surface colour.",
      hexCodes: ["#DC2626"],
      publicationStatus: "published",
      sourceDocumentId: "SRC-CRIMSON-VIS",
      sourceTitle: "Crimson Studio Visual Standards",
      pageNumber: 2,
    });

    // Create Brand B: Emerald Bio
    const brandB = await repo.createBrand({
      brandId: "brand-emerald-bio",
      organisationId: "local-org",
      brandName: "Emerald Bio",
      voiceAndToneSummary: "Clinical, calm, evidence-backed.",
    });
    await repo.saveKnowledgeEntry({
      brandId: brandB.brandId,
      section: "prohibited",
      title: "Prohibit Detox Superlatives",
      content: "Never promise instant detox results.",
      avoidTerm: "instant detox",
      publicationStatus: "published",
      sourceDocumentId: "SRC-EMERALD-CLAIMS",
      sourceTitle: "Emerald Bio Compliance Handbook",
      sectionRef: "Section 2.3",
      pageNumber: 4,
    });
    await repo.saveKnowledgeEntry({
      brandId: brandB.brandId,
      section: "facts",
      kind: "PRODUCT_PRICE",
      title: "PRODUCT_PRICE: Emerald Bio Serum",
      content: "$79",
      publicationStatus: "published",
      sourceDocumentId: "SRC-EMERALD-PROD",
      sourceTitle: "Emerald Bio Price Ledger",
    });
    await repo.saveKnowledgeEntry({
      brandId: brandB.brandId,
      section: "visual",
      title: "Emerald Primary Palette",
      content: "Use Emerald Green #10B981 for all approved creative surfaces.",
      hexCodes: ["#10B981"],
      publicationStatus: "published",
      sourceDocumentId: "SRC-EMERALD-VIS",
      sourceTitle: "Emerald Bio Identity Guide",
      pageNumber: 3,
    });

    const crimsonPngBase64 = await createSolidPngBase64({
      r: 220,
      g: 38,
      b: 38,
    }); // #DC2626
    const emeraldPngBase64 = await createSolidPngBase64({
      r: 16,
      g: 185,
      b: 129,
    }); // #10B981

    const orchestrator = createTestOrchestrator(repo);

    // Run Creative A (#DC2626 PNG + "miracle cure" + "$49") against Brand A
    const runAinA = await orchestrator.analyze({
      submissionId: "sub-a-in-a",
      brandId: brandA.brandId,
      campaignName: "Crimson Campaign",
      contentText: "Experience the miracle cure aesthetic for just $49.",
      contentPlatform: "web",
      creativePayload: {
        fileName: "crimson-banner.png",
        mimeType: "image/png",
        base64Data: crimsonPngBase64,
      },
    });
    assert.equal(runAinA.brandName, "Crimson Studio");
    const crimsonTermConflict = runAinA.findings.find(
      (f) =>
        f.status === "CONFLICTING" &&
        f.issue.toLowerCase().includes("miracle cure"),
    );
    assert.ok(crimsonTermConflict, "Brand A must flag 'miracle cure'");
    assert.equal(
      crimsonTermConflict?.evidenceReferences[0]?.sourceId,
      "SRC-CRIMSON-CLAIMS",
    );
    assert.equal(
      runAinA.findings.some((f) => f.category === "VISUAL_COMPLIANCE"),
      false,
      "Crimson #DC2626 PNG should match Brand A palette without colour conflict",
    );

    // Run SAME Creative A (#DC2626 PNG + "miracle cure" + "$49") against Brand B (Emerald Bio)
    const runAinB = await orchestrator.analyze({
      submissionId: "sub-a-in-b",
      brandId: brandB.brandId,
      campaignName: "Crimson Asset Checked Against Emerald",
      contentText: "Experience the miracle cure aesthetic for just $49.",
      contentPlatform: "web",
      creativePayload: {
        fileName: "crimson-banner.png",
        mimeType: "image/png",
        base64Data: crimsonPngBase64,
      },
    });
    assert.equal(runAinB.brandName, "Emerald Bio");
    // Must NOT contain Crimson's prohibited term rule
    assert.equal(
      runAinB.findings.some((f) =>
        f.evidenceReferences.some((r) => r.sourceId === "SRC-CRIMSON-CLAIMS"),
      ),
      false,
    );
    // Must flag Brand B's price conflict ($49 vs $79) AND Brand B's visual colour conflict (#DC2626 vs #10B981)
    assert.ok(
      runAinB.findings.some(
        (f) =>
          f.category === "FACT_VERIFICATION" &&
          f.status === "CONFLICTING" &&
          f.evidenceReferences.some((r) => r.sourceId === "SRC-EMERALD-PROD"),
      ),
      "Brand B must detect price conflict ($49 vs $79) cited to SRC-EMERALD-PROD",
    );
    assert.ok(
      runAinB.findings.some(
        (f) =>
          f.category === "VISUAL_COMPLIANCE" &&
          f.evidenceReferences.some((r) => r.sourceId === "SRC-EMERALD-VIS"),
      ),
      "Brand B must detect #DC2626 off-brand colour conflict against Emerald #10B981 with SRC-EMERALD-VIS",
    );

    // Run Creative B (#10B981 PNG + "instant detox" + "$79") against Brand B
    const runBinB = await orchestrator.analyze({
      submissionId: "sub-b-in-b",
      brandId: brandB.brandId,
      campaignName: "Emerald Campaign",
      contentText: "Discover our instant detox serum priced at $79.",
      contentPlatform: "web",
      creativePayload: {
        fileName: "emerald-banner.png",
        mimeType: "image/png",
        base64Data: emeraldPngBase64,
      },
    });
    const emeraldTermConflict = runBinB.findings.find(
      (f) =>
        f.status === "CONFLICTING" &&
        f.issue.toLowerCase().includes("instant detox"),
    );
    assert.ok(emeraldTermConflict, "Brand B must flag 'instant detox'");
    assert.equal(
      emeraldTermConflict?.evidenceReferences[0]?.sourceId,
      "SRC-EMERALD-CLAIMS",
    );
    assert.equal(
      runBinB.findings.some((f) => f.category === "VISUAL_COMPLIANCE"),
      false,
      "Emerald #10B981 PNG should match Brand B palette without colour conflict",
    );
  });

  it("6. Handles empty published brand gracefully without Teralune fallback and exercises HTTP API routes", async () => {
    const storePath = nextStorePath();
    process.env.IDENTIQ_KNOWLEDGE_STORE_PATH = storePath;
    process.env.IDENTIQ_FORCE_LOCAL_KNOWLEDGE_STORE = "1";

    // POST /api/brands
    const createBrandReq = new NextRequest("http://localhost:3000/api/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brandName: "Polaris Labs",
        organisationId: "local-org",
        description: "Deep-tech hardware brand",
      }),
    });
    const createRes = await brandsPost(createBrandReq);
    assert.equal(createRes.status, 201);
    const { brand } = (await createRes.json()) as {
      brand: { brandId: string; brandName: string };
    };
    assert.equal(brand.brandName, "Polaris Labs");

    // GET /api/brands
    const listBrandsReq = new NextRequest(
      "http://localhost:3000/api/brands?organisationId=local-org",
    );
    const listRes = await brandsGet(listBrandsReq);
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as {
      brands: Array<{ brandId: string }>;
    };
    assert.ok(listBody.brands.some((b) => b.brandId === brand.brandId));

    // Analyze brand with zero published rules -> PARTIAL + NO_PUBLISHED_KNOWLEDGE (no Teralune fallback!)
    const repo = new FileBackedBrandKnowledgeRepository({ storePath });
    const orchestrator = createTestOrchestrator(repo);
    const emptyBrandRes = await handleAnalysisRequest(
      {
        title: "Polaris Launch",
        contentType: "Campaign Copy",
        guidelineCollection: "Polaris Labs",
        brandId: brand.brandId,
        organisationId: "local-org",
        textContent: "Teralune spring water miracles cure everything!",
      },
      { orchestrator },
    );
    assert.equal(emptyBrandRes.status, 200);
    const body = emptyBrandRes.body as {
      analysisStatus: string;
      brandName: string;
      contextWarnings: string[];
      findings: Array<{ sourceReference: string }>;
    };
    assert.equal(body.analysisStatus, "PARTIAL");
    assert.equal(body.brandName, "Polaris Labs");
    assert.ok(body.contextWarnings.includes("NO_PUBLISHED_KNOWLEDGE"));
    assert.equal(
      body.findings.some((f) => f.sourceReference.includes("Teralune")),
      false,
      "Empty brand must never silently inherit Teralune fixture rules",
    );

    // POST /api/knowledge -> save_draft then publish
    const draftReq = new NextRequest("http://localhost:3000/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_draft",
        brandId: brand.brandId,
        organisationId: "local-org",
        section: "prohibited",
        title: "No Quantum Hyperbole",
        content: "Avoid calling standard silicon quantum magic.",
        avoidTerm: "quantum magic",
        sourceDocumentId: "POL-DOC-1",
        sourceTitle: "Polaris Editorial Charter",
      }),
    });
    const draftRes = await knowledgePost(draftReq);
    assert.equal(draftRes.status, 200);
    const draftJson = (await draftRes.json()) as {
      entry: { id: string; publicationStatus: string };
    };
    assert.equal(draftJson.entry.publicationStatus, "draft");

    const pubReq = new NextRequest("http://localhost:3000/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "publish",
        entryId: draftJson.entry.id,
        brandId: brand.brandId,
        organisationId: "local-org",
      }),
    });
    const pubRes = await knowledgePost(pubReq);
    assert.equal(pubRes.status, 200);
    const pubJson = (await pubRes.json()) as {
      entry: { publicationStatus: string };
      snapshot: { versionId: string };
    };
    assert.equal(pubJson.entry.publicationStatus, "published");
    assert.equal(pubJson.snapshot.versionId, "v1");

    // GET /api/knowledge
    const getKbReq = new NextRequest(
      `http://localhost:3000/api/knowledge?brandId=${encodeURIComponent(
        brand.brandId,
      )}&organisationId=local-org`,
    );
    const getKbRes = await knowledgeGet(getKbReq);
    assert.equal(getKbRes.status, 200);
    const getKbBody = (await getKbRes.json()) as {
      entries: Array<{ id: string }>;
      snapshots: Array<{ versionId: string }>;
    };
    assert.equal(getKbBody.entries.length, 1);
    assert.equal(getKbBody.snapshots.length, 1);

    // Unknown brand returns 404
    const missingRes = await handleAnalysisRequest(
      {
        title: "Missing Brand",
        contentType: "Campaign Copy",
        guidelineCollection: "Missing",
        brandId: "non-existent-brand-id",
        textContent: "Some campaign copy that is long enough for analysis.",
      },
      { orchestrator },
    );
    assert.equal(missingRes.status, 404);
  });
});
