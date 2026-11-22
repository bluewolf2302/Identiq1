import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  BrandKnowledgeRepositoryError,
  CrossTenantBrandAccessError,
  HostedPersistenceUnavailableError,
  createBrandKnowledgeRepository,
  getPersistenceEnvironmentInfo,
} from "@/lib/brand-context";
import { resolveServerApiTenantContext } from "@/lib/brand-context/server-api-auth";
import { attachConflictsToProposals } from "@/lib/guidelines/conflict-detector";
import {
  GuidelineDocumentSessionSchema,
  createGuidelineDocumentRepository,
  type GuidelineDocumentSession,
} from "@/lib/guidelines/document-repository";
import {
  GuidelinePdfIntakeError,
  buildKnowledgeProposalsFromPages,
  extractGuidelineDocumentPages,
  validateGuidelinePdfBuffer,
} from "@/lib/guidelines/intelligence";
import { createGuidelinePdfStorage } from "@/lib/guidelines/storage";
import {
  TERALUNE_DEMO_BRAND_ID,
  TERALUNE_GUIDELINES_PDF_URL,
} from "@/lib/demo/teralune-demo-fixtures";

function defaultTitleFromFileName(fileName: string): string {
  return (
    fileName
      .replace(/\.pdf$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Brand Guideline PDF"
  );
}

export async function GET(req: NextRequest) {
  try {
    const brandId = req.nextUrl.searchParams.get("brandId")?.trim();
    if (!brandId) {
      return NextResponse.json(
        { error: "brandId query parameter is required." },
        { status: 400 },
      );
    }

    const requestedOrgId = req.nextUrl.searchParams.get("organisationId");
    const includeDiscarded =
      req.nextUrl.searchParams.get("includeDiscarded") === "1";

    const tenant = await resolveServerApiTenantContext(req, {
      requestedOrganisationId: requestedOrgId,
      isMutation: false,
    });
    if (!tenant.ok) {
      return NextResponse.json({ error: tenant.error }, { status: tenant.status });
    }

    const brandRepo = createBrandKnowledgeRepository();
    const brand = await brandRepo.getBrand(brandId, tenant.organisationId);
    if (!brand) {
      return NextResponse.json(
        { error: `Brand "${brandId}" was not found.` },
        { status: 404 },
      );
    }

    const isSampleBrand = Boolean(
      brand.isSample || brandId === TERALUNE_DEMO_BRAND_ID,
    );
    const docRepo = createGuidelineDocumentRepository();
    const [sessions, publishedEntries] = await Promise.all([
      isSampleBrand
        ? Promise.resolve([])
        : docRepo.listDocumentSessions({
            brandId,
            organisationId: tenant.organisationId,
            includeDiscarded,
          }),
      brandRepo.listKnowledgeEntries({
        brandId,
        organisationId: tenant.organisationId,
        status: "published",
      }),
    ]);

    const enrichedSessions = sessions.map((session) => ({
      ...session,
      proposals: attachConflictsToProposals(session.proposals, publishedEntries),
    }));

    return NextResponse.json({
      sessions: enrichedSessions,
      brand,
      ...(isSampleBrand
        ? {
            sampleGuidelineDocument: {
              title: "Teralune Brand Identity & AI Guidelines",
              version: "v1.0",
              url: TERALUNE_GUIDELINES_PDF_URL,
              readOnly: true,
            },
          }
        : {}),
      persistenceEnvironment: getPersistenceEnvironmentInfo(),
    });
  } catch (err) {
    if (err instanceof HostedPersistenceUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof CrossTenantBrandAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof BrandKnowledgeRepositoryError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(
      "Unhandled GET /api/guidelines/documents error:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to load guideline document sessions." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Request body must be multipart/form-data containing a PDF file." },
        { status: 400 },
      );
    }

    const brandId = String(formData.get("brandId") ?? "").trim();
    if (!brandId) {
      return NextResponse.json(
        { error: "brandId is required to upload a guideline PDF." },
        { status: 400 },
      );
    }

    const requestedOrgId = String(formData.get("organisationId") ?? "").trim() || null;
    const tenant = await resolveServerApiTenantContext(req, {
      requestedOrganisationId: requestedOrgId,
      isMutation: true,
    });
    if (!tenant.ok) {
      return NextResponse.json({ error: tenant.error }, { status: tenant.status });
    }

    const brandRepo = createBrandKnowledgeRepository();
    const brand = await brandRepo.getBrand(brandId, tenant.organisationId);
    if (!brand) {
      return NextResponse.json(
        { error: `Brand "${brandId}" was not found.` },
        { status: 404 },
      );
    }

    if (brand.isSample || brandId === TERALUNE_DEMO_BRAND_ID) {
      return NextResponse.json(
        {
          error:
            "Teralune sample guidelines (v1.0) are preloaded read-only reference fixtures. Select or create a workspace brand to upload new guideline PDFs.",
        },
        { status: 400 },
      );
    }

    const uploadedFile = formData.get("file");
    if (!(uploadedFile instanceof File)) {
      return NextResponse.json(
        { error: "Please attach a guideline PDF file in the \"file\" field." },
        { status: 400 },
      );
    }

    const rawTitle = String(formData.get("title") ?? "").trim();
    const sourceDocumentVersion =
      String(formData.get("sourceDocumentVersion") ?? "").trim() || "doc-v1";
    const requestedDocId = String(formData.get("documentId") ?? "").trim();
    const retrySessionId = String(formData.get("retrySessionId") ?? "").trim();
    const enableOcr = String(formData.get("enableOcr") ?? "true") !== "false";
    const allowDuplicate = String(formData.get("allowDuplicate") ?? "false") === "true";

    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const validated = await validateGuidelinePdfBuffer({
      fileName: uploadedFile.name || "guideline.pdf",
      mimeType: uploadedFile.type || "application/pdf",
      buffer,
    });

    const docRepo = createGuidelineDocumentRepository();
    const storage = createGuidelinePdfStorage();

    if (!allowDuplicate && !retrySessionId) {
      const duplicate = await docRepo.findByChecksum({
        brandId,
        organisationId: tenant.organisationId,
        sha256: validated.sha256,
      });
      if (duplicate) {
        return NextResponse.json(
          {
            error: `This PDF matches an existing guideline upload ("${duplicate.title}", ${duplicate.sourceDocumentVersion}). Resume that session or confirm duplicate upload.`,
            code: "DUPLICATE_GUIDELINE_DOCUMENT",
            existingDocumentId: duplicate.documentId,
            existingTitle: duplicate.title,
            existingVersion: duplicate.sourceDocumentVersion,
            existingSession: duplicate,
          },
          { status: 409 },
        );
      }
    }

    let documentId = requestedDocId || `gdoc-${randomUUID()}`;
    let existingCreatedAt: string | undefined;
    if (retrySessionId) {
      const prior = await docRepo.getDocumentSession({
        documentId: retrySessionId,
        organisationId: tenant.organisationId,
      });
      if (prior && prior.brandId === brandId) {
        documentId = prior.documentId;
        existingCreatedAt = prior.createdAt;
      }
    }

    const stored = await storage.putPdf({
      organisationId: tenant.organisationId,
      brandId,
      documentId,
      versionLabel: sourceDocumentVersion,
      buffer,
    });

    const extraction = await extractGuidelineDocumentPages(
      {
        fileName: validated.sanitizedFileName,
        mimeType: "application/pdf",
        buffer,
      },
      { enableOcr },
    );

    const rawProposals = buildKnowledgeProposalsFromPages({
      documentId,
      brandId,
      organisationId: tenant.organisationId,
      pages: extraction.pages,
    });

    const publishedEntries = await brandRepo.listKnowledgeEntries({
      brandId,
      organisationId: tenant.organisationId,
      status: "published",
    });

    const proposals = attachConflictsToProposals(rawProposals, publishedEntries);
    const now = new Date().toISOString();

    const session: GuidelineDocumentSession = GuidelineDocumentSessionSchema.parse({
      documentId,
      brandId,
      organisationId: tenant.organisationId,
      title: rawTitle || defaultTitleFromFileName(validated.sanitizedFileName),
      fileName: validated.sanitizedFileName,
      mimeType: "application/pdf",
      fileSizeBytes: validated.sanitizedFileName ? buffer.length : 0,
      sha256: validated.sha256,
      sourceDocumentVersion,
      storageKey: stored.storageKey,
      storageBackend: stored.storageBackend,
      status: "ready_for_review",
      totalPageCount: extraction.totalPageCount,
      ocrUsed: extraction.ocrUsed,
      ocrPageCount: extraction.ocrPageCount,
      failedPageCount: extraction.failedPageCount,
      pages: extraction.pages,
      warnings: extraction.warnings,
      proposals,
      uploadedBy: tenant.actorName,
      createdAt: existingCreatedAt || now,
      updatedAt: now,
    });

    const saved = await docRepo.saveDocumentSession(session);
    return NextResponse.json(
      {
        session: saved,
        persistenceEnvironment: getPersistenceEnvironmentInfo(),
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof HostedPersistenceUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof CrossTenantBrandAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof GuidelinePdfIntakeError) {
      const status = err.code === "FILE_TOO_LARGE" ? 413 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    if (err instanceof BrandKnowledgeRepositoryError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(
      "Unhandled POST /api/guidelines/documents error:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to process uploaded guideline PDF." },
      { status: 500 },
    );
  }
}
