import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { AnalysisOrchestrator } from "@/lib/analysis";
import {
  BrandContextService,
  FileBackedBrandKnowledgeRepository,
} from "@/lib/brand-context";
import { DeterministicTextGovernanceEngine } from "@/lib/governance";
import { detectProposalConflicts } from "@/lib/guidelines/conflict-detector";
import { FileBackedGuidelineDocumentRepository } from "@/lib/guidelines/document-repository";
import {
  GuidelinePdfIntakeError,
  buildKnowledgeProposalsFromPages,
  extractGuidelineDocumentPages,
  validateGuidelinePdfBuffer,
} from "@/lib/guidelines/intelligence";
import { GET as getBrandsHandler } from "@/app/api/brands/route";
import {
  GET as getGuidelineDocumentsHandler,
  POST as postGuidelineDocumentsHandler,
} from "@/app/api/guidelines/documents/route";
import {
  DELETE as deleteGuidelineDocumentHandler,
} from "@/app/api/guidelines/documents/[documentId]/route";
import {
  GET as getGuidelineDocumentFileHandler,
} from "@/app/api/guidelines/documents/[documentId]/file/route";
import { POST as postGuidelineProposalsHandler } from "@/app/api/guidelines/proposals/route";
import { POST as postKnowledgeHandler } from "@/app/api/knowledge/route";

async function createSamplePdf(pages: Array<{ lines: string[] }>): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const pageSpec of pages) {
    const page = doc.addPage([612, 792]);
    let y = 740;
    for (const line of pageSpec.lines) {
      if (line.trim()) {
        page.drawText(line, { x: 48, y, size: 11, font });
      }
      y -= 20;
    }
  }

  return Buffer.from(await doc.save());
}

describe("Round 3 Phase 2: Guideline Document Intelligence, Provenance, Conflict Detection & Hosted Guardrails", () => {
  let tmpDir: string;
  let knowledgeStorePath: string;
  let guidelineDocsStorePath: string;
  let guidelineFilesDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "identiq-phase2-"));
    knowledgeStorePath = path.join(tmpDir, "knowledge-store.json");
    guidelineDocsStorePath = path.join(tmpDir, "guideline-docs-store.json");
    guidelineFilesDir = path.join(tmpDir, "guideline-files");

    for (const key of [
      "IDENTIQ_KNOWLEDGE_STORE_PATH",
      "IDENTIQ_GUIDELINE_DOCS_STORE_PATH",
      "IDENTIQ_GUIDELINE_FILES_DIR",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "VERCEL",
      "VERCEL_ENV",
      "IDENTIQ_ALLOW_LOCAL_FILE_STORE",
    ]) {
      savedEnv[key] = process.env[key];
    }

    process.env.IDENTIQ_KNOWLEDGE_STORE_PATH = knowledgeStorePath;
    process.env.IDENTIQ_GUIDELINE_DOCS_STORE_PATH = guidelineDocsStorePath;
    process.env.IDENTIQ_GUIDELINE_FILES_DIR = guidelineFilesDir;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.IDENTIQ_ALLOW_LOCAL_FILE_STORE;

    const brandRepo = new FileBackedBrandKnowledgeRepository({
      storePath: knowledgeStorePath,
    });
    await brandRepo.createBrand({
      brandId: "brand-aurora-test",
      organisationId: "local-org",
      brandName: "Aurora Botanicals",
      description: "Botanical tea & skincare brand",
      voiceAndToneSummary: "Calm, transparent, verifiable",
    });
    await brandRepo.createBrand({
      brandId: "brand-rival-org",
      organisationId: "org-beta-other",
      brandName: "Beta Co",
    });
  });

  after(async () => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("Group A: rejects empty, non-PDF, invalid-signature, corrupt, encrypted, and oversized PDFs cleanly", async () => {
    await assert.rejects(
      () =>
        validateGuidelinePdfBuffer({
          fileName: "empty.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.alloc(0),
        }),
      (err: unknown) =>
        err instanceof GuidelinePdfIntakeError && err.code === "EMPTY_FILE",
    );

    await assert.rejects(
      () =>
        validateGuidelinePdfBuffer({
          fileName: "notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("hello"),
        }),
      (err: unknown) =>
        err instanceof GuidelinePdfIntakeError && err.code === "INVALID_FILE_TYPE",
    );

    await assert.rejects(
      () =>
        validateGuidelinePdfBuffer({
          fileName: "fake.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("NOT A PDF HEADER"),
        }),
      (err: unknown) =>
        err instanceof GuidelinePdfIntakeError &&
        err.code === "INVALID_PDF_SIGNATURE",
    );

    await assert.rejects(
      () =>
        validateGuidelinePdfBuffer({
          fileName: "corrupt.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.7\n%broken xref data\n%%EOF"),
        }),
      (err: unknown) =>
        err instanceof GuidelinePdfIntakeError && err.code === "MALFORMED_PDF",
    );

    await assert.rejects(
      () =>
        validateGuidelinePdfBuffer({
          fileName: "encrypted.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(
            "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n3 0 obj\n<< /Filter /Standard /V 2 /R 3 /O (abc) /U (def) /P -4 >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 3 0 R >>\n%%EOF",
          ),
        }),
      (err: unknown) =>
        err instanceof GuidelinePdfIntakeError && err.code === "ENCRYPTED_PDF",
    );

    const oversized = Buffer.alloc(20 * 1024 * 1024 + 10);
    Buffer.from("%PDF-1.7\n").copy(oversized);
    await assert.rejects(
      () =>
        validateGuidelinePdfBuffer({
          fileName: "huge.pdf",
          mimeType: "application/pdf",
          buffer: oversized,
        }),
      (err: unknown) =>
        err instanceof GuidelinePdfIntakeError && err.code === "FILE_TOO_LARGE",
    );
  });

  it("Group A & B: extracts multi-page text, runs selective OCR only on blank pages, isolates page OCR failure, and flags uncertain/expired rules", async () => {
    const pdfBuf = await createSamplePdf([
      {
        lines: [
          "COLOR PALETTE",
          "Primary forest green colour must use #064E3B across hero headings.",
          "",
          "PRODUCT PRICING",
          "Product: Aurora Matcha Reserve. Retail price is $24.00 valid 2024-01-01 to 2024-03-01.",
          "",
          "PROHIBITED CLAIMS",
          'Never use "instant cure" or unsubstantiated medical claims in marketing.',
        ],
      },
      {
        // Blank embedded text layer -> triggers selective OCR
        lines: [],
      },
      {
        lines: [
          "TERMINOLOGY STANDARDS",
          'Use "Ceremonial Grade Leaf" instead of "Superfood Powder" on packaging.',
        ],
      },
    ]);

    const ocrInvokedOnPages: number[] = [];
    const extracted = await extractGuidelineDocumentPages(
      { fileName: "aurora-brand-book.pdf", mimeType: "application/pdf", buffer: pdfBuf },
      {
        enableOcr: true,
        ocrAdapter: async ({ pageNumber }) => {
          ocrInvokedOnPages.push(pageNumber);
          return {
            text: "Scanned Page Notice: Keep clear space around the Aurora wordmark.",
            confidence: 0.61,
          };
        },
      },
    );

    assert.equal(extracted.totalPageCount, 3);
    assert.deepEqual(ocrInvokedOnPages, [2]);
    assert.equal(extracted.ocrUsed, true);
    assert.equal(extracted.ocrPageCount, 1);
    assert.equal(extracted.pages[0]?.status, "TEXT_EXTRACTED");
    assert.equal(extracted.pages[1]?.status, "OCR_EXTRACTED");
    assert.equal(extracted.pages[1]?.requiresHumanReview, true);
    assert.equal(extracted.pages[2]?.status, "TEXT_EXTRACTED");

    const proposals = buildKnowledgeProposalsFromPages({
      documentId: "doc-aurora-1",
      brandId: "brand-aurora-test",
      organisationId: "local-org",
      pages: extracted.pages,
      referenceDate: new Date("2026-06-01T00:00:00Z"),
    });

    assert.ok(proposals.length >= 4);

    const visualProposal = proposals.find((p) =>
      p.hexCodes?.includes("#064E3B"),
    );
    assert.ok(visualProposal);
    assert.equal(visualProposal.suggestedCategory, "visual");
    assert.equal(visualProposal.pageNumber, 1);
    assert.equal(visualProposal.sectionRef, "COLOR PALETTE");

    const priceProposal = proposals.find(
      (p) => p.structuredFacts?.numericPrice === 24,
    );
    assert.ok(priceProposal);
    assert.equal(priceProposal.suggestedCategory, "facts");
    assert.equal(priceProposal.structuredFacts?.currency, "USD");
    assert.equal(priceProposal.structuredFacts?.validFrom, "2024-01-01");
    assert.equal(priceProposal.structuredFacts?.validUntil, "2024-03-01");
    assert.equal(priceProposal.structuredFacts?.isExpiredPromo, true);

    const prohibitedProposal = proposals.find((p) =>
      p.extractedText.includes("instant cure"),
    );
    assert.ok(prohibitedProposal);
    assert.equal(prohibitedProposal.suggestedCategory, "prohibited");

    const termProposal = proposals.find(
      (p) => p.preferredTerm === "Ceremonial Grade Leaf",
    );
    assert.ok(termProposal);
    assert.equal(termProposal.suggestedCategory, "terminology");
    assert.equal(termProposal.avoidTerm, "Superfood Powder");

    const ocrProposal = proposals.find((p) => p.pageNumber === 2);
    assert.ok(ocrProposal);
    assert.equal(ocrProposal.extractionSource, "ocr");
    assert.equal(ocrProposal.classificationUncertain, true);
    assert.equal(ocrProposal.requiresHumanReview, true);
    assert.equal(ocrProposal.sectionRef, undefined);

    // Ensure OCR failure on a scanned page does not break digital pages
    const resilient = await extractGuidelineDocumentPages(
      { fileName: "aurora-brand-book.pdf", mimeType: "application/pdf", buffer: pdfBuf },
      {
        enableOcr: true,
        ocrAdapter: async () => {
          throw new Error("Simulated OCR crash");
        },
      },
    );
    assert.equal(resilient.pages[0]?.status, "TEXT_EXTRACTED");
    assert.equal(resilient.pages[2]?.status, "TEXT_EXTRACTED");
    assert.ok(resilient.warnings.some((w) => w.includes("OCR fallback")));
  });

  it("Group C, D, E & F: uploads PDF via API, drafts survive reload, publishes idempotently with provenance, checks live analysis, detects & resolves conflicts", async () => {
    const pdfV1 = await createSamplePdf([
      {
        lines: [
          "COLOR PALETTE",
          "Primary deep forest colour must use #064E3B for headlines.",
          "",
          "PRODUCT PRICING",
          "Product: Aurora Matcha Reserve. Retail price is $24.00 valid 2026-01-01 to 2026-03-31.",
          "",
          "PROHIBITED CLAIMS",
          'Never say "instant cure" on any marketing asset.',
        ],
      },
    ]);

    const fd = new FormData();
    fd.set(
      "file",
      new File([new Uint8Array(pdfV1)], "aurora-v1.pdf", {
        type: "application/pdf",
      }),
    );
    fd.set("brandId", "brand-aurora-test");
    fd.set("organisationId", "local-org");
    fd.set("title", "Aurora Brand Book Q1");
    fd.set("sourceDocumentVersion", "doc-v1");
    fd.set("enableOcr", "false");

    const uploadReq = new NextRequest("http://localhost:3000/api/guidelines/documents", {
      method: "POST",
      body: fd,
    });
    const uploadRes = await postGuidelineDocumentsHandler(uploadReq);
    assert.equal(uploadRes.status, 201);
    const uploadBody = (await uploadRes.json()) as {
      session: {
        documentId: string;
        proposals: Array<{
          proposalId: string;
          extractedText: string;
          title: string;
          content: string;
          category: string;
          status: string;
          structuredFacts?: { numericPrice?: number };
          hexCodes?: string[];
        }>;
      };
    };

    const docId = uploadBody.session.documentId;
    assert.ok(uploadBody.session.proposals.length >= 3);
    // Nothing is auto-published
    assert.ok(
      uploadBody.session.proposals.every((p) => p.status === "pending_review"),
    );

    // Duplicate upload returns 409
    const dupRes = await postGuidelineDocumentsHandler(
      new NextRequest("http://localhost:3000/api/guidelines/documents", {
        method: "POST",
        body: fd,
      }),
    );
    assert.equal(dupRes.status, 409);

    // BrandContextService MUST NOT include unpublished staged proposals yet
    const brandRepo = new FileBackedBrandKnowledgeRepository({
      storePath: knowledgeStorePath,
    });
    const contextSvc = new BrandContextService(brandRepo);
    const prePublishCtx = await contextSvc.getForSubmission({
      brandId: "brand-aurora-test",
      organisationId: "local-org",
    });
    assert.equal(prePublishCtx.context.approvedProductFacts.length, 0);
    assert.ok(prePublishCtx.warnings.includes("NO_PUBLISHED_KNOWLEDGE"));

    // Save draft edit on price proposal, ensuring extractedText stays immutable
    const priceProp = uploadBody.session.proposals.find(
      (p) => p.structuredFacts?.numericPrice === 24,
    )!;
    const originalExtractedText = priceProp.extractedText;

    const saveDraftRes = await postGuidelineProposalsHandler(
      new NextRequest("http://localhost:3000/api/guidelines/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_draft",
          documentId: docId,
          proposalId: priceProp.proposalId,
          organisationId: "local-org",
          title: "Aurora Matcha Reserve Q1 Launch Price",
          content: "Reviewed: Official Q1 MSRP is $24.00 for Aurora Matcha Reserve.",
        }),
      }),
    );
    assert.equal(saveDraftRes.status, 200);
    const draftBody = (await saveDraftRes.json()) as {
      proposal: {
        status: string;
        extractedText: string;
        content: string;
      };
    };
    assert.equal(draftBody.proposal.status, "draft_saved");
    assert.equal(draftBody.proposal.extractedText, originalExtractedText);
    assert.ok(draftBody.proposal.content.startsWith("Reviewed:"));

    // Reload via fresh repository instance + GET endpoint -> draft survives reload!
    const freshDocRepo = new FileBackedGuidelineDocumentRepository(
      guidelineDocsStorePath,
    );
    const reloadedSession = await freshDocRepo.getDocumentSession({
      documentId: docId,
      organisationId: "local-org",
    });
    assert.ok(reloadedSession);
    const reloadedProp = reloadedSession.proposals.find(
      (p) => p.proposalId === priceProp.proposalId,
    )!;
    assert.equal(reloadedProp.status, "draft_saved");
    assert.equal(reloadedProp.extractedText, originalExtractedText);

    // Publish visual, price, and prohibited proposals; verify idempotent duplicate publish
    const visualProp = uploadBody.session.proposals.find((p) =>
      p.hexCodes?.includes("#064E3B"),
    )!;
    const prohibProp = uploadBody.session.proposals.find((p) =>
      p.extractedText.includes("instant cure"),
    )!;

    for (const target of [priceProp, visualProp, prohibProp]) {
      const pubRes = await postGuidelineProposalsHandler(
        new NextRequest("http://localhost:3000/api/guidelines/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "publish",
            documentId: docId,
            proposalId: target.proposalId,
            organisationId: "local-org",
            publishIdempotencyKey: `idem-${target.proposalId}`,
          }),
        }),
      );
      assert.equal(pubRes.status, 200);
    }

    // Repeat publish with same idempotency key -> deduplicated: true, no duplicate entry
    const repeatPubRes = await postGuidelineProposalsHandler(
      new NextRequest("http://localhost:3000/api/guidelines/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          documentId: docId,
          proposalId: priceProp.proposalId,
          organisationId: "local-org",
          publishIdempotencyKey: `idem-${priceProp.proposalId}`,
        }),
      }),
    );
    assert.equal(repeatPubRes.status, 200);
    const repeatBody = (await repeatPubRes.json()) as { deduplicated: boolean };
    assert.equal(repeatBody.deduplicated, true);

    const allAuroraEntries = await brandRepo.listKnowledgeEntries({
      brandId: "brand-aurora-test",
      organisationId: "local-org",
      status: "all",
    });
    const publishedEntries = allAuroraEntries.filter(
      (e) => e.publicationStatus === "published",
    );
    assert.equal(publishedEntries.length, 3);

    const publishedPrice = publishedEntries.find(
      (e) => e.structuredFacts?.numericPrice === 24,
    )!;
    assert.equal(publishedPrice.entryOrigin, "guideline_pdf");
    assert.equal(publishedPrice.extractedText, originalExtractedText);
    assert.equal(publishedPrice.sourceDocumentId, docId);
    assert.equal(publishedPrice.sourceDocumentVersion, "doc-v1");
    assert.equal(publishedPrice.pageNumber, 1);

    // Editing a published entry preserves immutable extractedText
    const editRes = await postKnowledgeHandler(
      new NextRequest("http://localhost:3000/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_and_publish",
          id: publishedPrice.id,
          brandId: "brand-aurora-test",
          organisationId: "local-org",
          section: "facts",
          title: publishedPrice.title,
          content: "Manually refined Q1 price text ($24.00) with shipping note.",
        }),
      }),
    );
    assert.equal(editRes.status, 200);
    const editBody = (await editRes.json()) as {
      entry: { extractedText?: string; content: string };
    };
    assert.equal(editBody.entry.extractedText, originalExtractedText);

    // Private PDF endpoint works for same tenant and rejects cross-tenant
    const pdfGetRes = await getGuidelineDocumentFileHandler(
      new NextRequest(
        `http://localhost:3000/api/guidelines/documents/${docId}/file?organisationId=local-org`,
      ),
      { params: Promise.resolve({ documentId: docId }) },
    );
    assert.equal(pdfGetRes.status, 200);
    assert.equal(pdfGetRes.headers.get("content-type"), "application/pdf");
    assert.equal(pdfGetRes.headers.get("cache-control"), "private, no-store");
    const returnedBytes = Buffer.from(await pdfGetRes.arrayBuffer());
    assert.equal(returnedBytes.subarray(0, 5).toString("ascii"), "%PDF-");

    const crossTenantPdfRes = await getGuidelineDocumentFileHandler(
      new NextRequest(
        `http://localhost:3000/api/guidelines/documents/${docId}/file?organisationId=org-beta-other`,
      ),
      { params: Promise.resolve({ documentId: docId }) },
    );
    assert.equal(crossTenantPdfRes.status, 403);

    // Live analysis uses published knowledge & catches prohibited "instant cure"
    const liveCtx = await contextSvc.getForSubmission({
      brandId: "brand-aurora-test",
      organisationId: "local-org",
    });
    assert.ok(
      liveCtx.context.prohibitedTerminology.some((t) =>
        t.toLowerCase().includes("instant cure"),
      ),
    );
    assert.ok(
      liveCtx.context.approvedColours.some((c) => c.includes("#064E3B")),
    );

    const orchestrator = new AnalysisOrchestrator({
      brandContextService: contextSvc,
      deterministicEngine: new DeterministicTextGovernanceEngine(),
      aiAnalysisService: {
        analyze: async () => ({
          findings: [],
          providerUsed: "test-stub",
          fallbackUsed: false,
        }),
      },
      getBrandKnowledgeRecord: (bId: string, orgId?: string) =>
        brandRepo.getBrandKnowledge({ brandId: bId, organisationId: orgId }),
    });
    const analysisRes = await orchestrator.analyze({
      submissionId: "rev-aurora-test",
      brandId: "brand-aurora-test",
      organisationId: "local-org",
      campaignName: "Aurora Test Campaign",
      contentText: "Try Aurora Matcha Reserve for an instant cure today!",
    });
    assert.ok(
      analysisRes.findings.some(
        (f) =>
          f.status === "CONFLICTING" &&
          f.evidenceReferences.some((r) => r.sourceId === docId),
      ),
    );

    // Group F: Upload conflicting PDF v2 (price $29.00, different date, different primary #DC2626, plus compatible accent #FAF8F6)
    const pdfV2 = await createSamplePdf([
      {
        lines: [
          "COLOR PALETTE",
          "Primary crimson colour must use #DC2626 across hero headings.",
          "",
          "ACCENT COLOUR",
          "Accent warm cream background uses #FAF8F6 across secondary cards.",
          "",
          "PRODUCT PRICING",
          "Product: Aurora Matcha Reserve. Retail price is $29.00 valid 2026-04-01 to 2026-06-30.",
          "",
          "TERMINOLOGY",
          'Preferred term: "instant cure" for rapid wellness copy.',
        ],
      },
    ]);

    const fd2 = new FormData();
    fd2.set(
      "file",
      new File([new Uint8Array(pdfV2)], "aurora-v2.pdf", {
        type: "application/pdf",
      }),
    );
    fd2.set("brandId", "brand-aurora-test");
    fd2.set("organisationId", "local-org");
    fd2.set("title", "Aurora Brand Book Q2");
    fd2.set("sourceDocumentVersion", "doc-v2");
    fd2.set("enableOcr", "false");

    const uploadV2Res = await postGuidelineDocumentsHandler(
      new NextRequest("http://localhost:3000/api/guidelines/documents", {
        method: "POST",
        body: fd2,
      }),
    );
    assert.equal(uploadV2Res.status, 201);
    const v2Body = (await uploadV2Res.json()) as {
      session: {
        documentId: string;
        proposals: Array<{
          proposalId: string;
          extractedText: string;
          conflictStatus?: string;
          conflictMatches?: Array<{ category: string; existingEntryId: string }>;
          hexCodes?: string[];
          structuredFacts?: { numericPrice?: number };
        }>;
      };
    };

    const v2Price = v2Body.session.proposals.find(
      (p) => p.structuredFacts?.numericPrice === 29,
    )!;
    assert.equal(v2Price.conflictStatus, "conflict");
    assert.ok(
      v2Price.conflictMatches?.some(
        (m) => m.category === "price" && m.existingEntryId === publishedPrice.id,
      ),
    );

    const v2PrimaryColour = v2Body.session.proposals.find((p) =>
      p.hexCodes?.includes("#DC2626"),
    )!;
    assert.equal(v2PrimaryColour.conflictStatus, "conflict");

    const v2AccentColour = v2Body.session.proposals.find((p) =>
      p.hexCodes?.includes("#FAF8F6"),
    )!;
    assert.equal(v2AccentColour.conflictStatus, "no_conflict");

    const v2Term = v2Body.session.proposals.find((p) =>
      p.extractedText.includes("instant cure"),
    )!;
    assert.equal(v2Term.conflictStatus, "conflict");

    // Publishing unresolved definite conflict is blocked with 409 PROPOSAL_CONFLICT
    const blockedPubRes = await postGuidelineProposalsHandler(
      new NextRequest("http://localhost:3000/api/guidelines/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          documentId: v2Body.session.documentId,
          proposalId: v2Price.proposalId,
          organisationId: "local-org",
        }),
      }),
    );
    assert.equal(blockedPubRes.status, 409);

    const snapBefore = (
      await brandRepo.listVersionSnapshots("brand-aurora-test", "local-org")
    )[0]!;

    // Explicit resolution: publish_and_archive_existing archives old price rule and preserves historical snapshot
    const resolvedPubRes = await postGuidelineProposalsHandler(
      new NextRequest("http://localhost:3000/api/guidelines/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          documentId: v2Body.session.documentId,
          proposalId: v2Price.proposalId,
          organisationId: "local-org",
          conflictResolution: "publish_and_archive_existing",
          supersedeEntryId: publishedPrice.id,
        }),
      }),
    );
    assert.equal(resolvedPubRes.status, 200);

    // Old entry is archived, new entry is active, and earlier snapshot still retains $24.00
    const latestCtx = await contextSvc.getForSubmission({
      brandId: "brand-aurora-test",
      organisationId: "local-org",
    });
    assert.ok(
      latestCtx.context.approvedProductFacts.some((f) => f.includes("$29.00")),
    );
    assert.ok(
      !latestCtx.context.approvedProductFacts.some((f) => f.includes("$24.00")),
    );

    const historicalCtx = await contextSvc.getForSubmission({
      brandId: "brand-aurora-test",
      organisationId: "local-org",
      versionId: snapBefore.versionId,
    });
    assert.ok(
      historicalCtx.context.approvedProductFacts.some((f) =>
        f.includes("$24.00"),
      ),
    );

    // Clean session discard when document has published entries keeps provenance while discarding open drafts
    const discardDoc1Res = await deleteGuidelineDocumentHandler(
      new NextRequest(
        `http://localhost:3000/api/guidelines/documents/${docId}?organisationId=local-org`,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ documentId: docId }) },
    );
    assert.equal(discardDoc1Res.status, 200);
    const discardBody = (await discardDoc1Res.json()) as {
      deletedCompletely: boolean;
    };
    assert.equal(discardBody.deletedCompletely, false);

    // Check direct GET sessions filters discarded doc out
    const listRes = await getGuidelineDocumentsHandler(
      new NextRequest(
        "http://localhost:3000/api/guidelines/documents?brandId=brand-aurora-test&organisationId=local-org",
      ),
    );
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as {
      sessions: Array<{ documentId: string }>;
    };
    assert.ok(!listBody.sessions.some((s) => s.documentId === docId));
  });

  it("Group D & Hosted Guardrail: fails closed with HTTP 503 in hosted Vercel runtime when Supabase credentials are missing", async () => {
    const prevVercel = process.env.VERCEL;
    const prevEnv = process.env.VERCEL_ENV;
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";

    try {
      const brandsRes = await getBrandsHandler(
        new NextRequest("http://localhost:3000/api/brands"),
      );
      assert.equal(brandsRes.status, 503);

      const docsRes = await getGuidelineDocumentsHandler(
        new NextRequest(
          "http://localhost:3000/api/guidelines/documents?brandId=brand-aurora-test",
        ),
      );
      assert.equal(docsRes.status, 503);
    } finally {
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
      if (prevEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevEnv;
    }
  });

  it("Group F (Pure Unit): detects compatible vs conflicting dates and inverse rules accurately", () => {
    const baseProposal = {
      proposalId: "p-1",
      documentId: "d-1",
      brandId: "b-1",
      organisationId: "o-1",
      extractedText: "Free shipping always included on orders over $50.",
      title: "Free Shipping Policy",
      content: "Free shipping always included on orders over $50.",
      suggestedCategory: "policies" as const,
      category: "policies" as const,
      classificationUncertain: false,
      requiresHumanReview: false,
      extractionSource: "embedded_text" as const,
      pageNumber: 1,
      status: "pending_review" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const existingPublished = [
      {
        id: "e-1",
        brandId: "b-1",
        organisationId: "o-1",
        section: "policies" as const,
        title: "Free Shipping Restriction",
        content: "Never promise free shipping on orders under or over $50.",
        publicationStatus: "published" as const,
        versionNumber: 1,
        versionId: "v1",
        sourceDocumentId: "d-0",
        sourceTitle: "Shipping Rules",
        owner: "Brand Lead",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const res = detectProposalConflicts(baseProposal, existingPublished);
    assert.ok(
      res.conflictStatus === "conflict" ||
        res.conflictStatus === "possible_conflict",
    );
    assert.equal(res.matches[0]?.category, "inverse_rule");
  });
});
