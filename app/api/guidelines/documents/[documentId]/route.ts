import { NextRequest, NextResponse } from "next/server";
import {
  CrossTenantBrandAccessError,
  HostedPersistenceUnavailableError,
  createBrandKnowledgeRepository,
} from "@/lib/brand-context";
import { resolveServerApiTenantContext } from "@/lib/brand-context/server-api-auth";
import { attachConflictsToProposals } from "@/lib/guidelines/conflict-detector";
import {
  GuidelineDocumentNotFoundError,
  createGuidelineDocumentRepository,
} from "@/lib/guidelines/document-repository";
import { createGuidelinePdfStorage } from "@/lib/guidelines/storage";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await context.params;
    const requestedOrgId = req.nextUrl.searchParams.get("organisationId");
    const tenant = await resolveServerApiTenantContext(req, {
      requestedOrganisationId: requestedOrgId,
      isMutation: false,
    });
    if (!tenant.ok) {
      return NextResponse.json({ error: tenant.error }, { status: tenant.status });
    }

    const docRepo = createGuidelineDocumentRepository();
    const session = await docRepo.getDocumentSession({
      documentId,
      organisationId: tenant.organisationId,
    });
    if (!session) {
      return NextResponse.json(
        { error: `Guideline document "${documentId}" was not found.` },
        { status: 404 },
      );
    }

    const brandRepo = createBrandKnowledgeRepository();
    const publishedEntries = await brandRepo.listKnowledgeEntries({
      brandId: session.brandId,
      organisationId: tenant.organisationId,
      status: "published",
    });

    return NextResponse.json({
      session: {
        ...session,
        proposals: attachConflictsToProposals(
          session.proposals,
          publishedEntries,
        ),
      },
    });
  } catch (err) {
    if (err instanceof HostedPersistenceUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof CrossTenantBrandAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(
      "Unhandled GET /api/guidelines/documents/[documentId] error:",
      err instanceof Error ? err.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "Unable to load guideline document session." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await context.params;
    const requestedOrgId = req.nextUrl.searchParams.get("organisationId");
    const tenant = await resolveServerApiTenantContext(req, {
      requestedOrganisationId: requestedOrgId,
      isMutation: true,
    });
    if (!tenant.ok) {
      return NextResponse.json({ error: tenant.error }, { status: tenant.status });
    }

    const docRepo = createGuidelineDocumentRepository();
    const result = await docRepo.discardDocumentSession({
      documentId,
      organisationId: tenant.organisationId,
    });

    if (result.shouldDeleteStorage) {
      const storage = createGuidelinePdfStorage();
      await storage.deletePdf(result.session.storageKey);
    }

    return NextResponse.json({
      discarded: true,
      deletedCompletely: result.deletedCompletely,
      session: result.session,
    });
  } catch (err) {
    if (err instanceof HostedPersistenceUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof CrossTenantBrandAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof GuidelineDocumentNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error(
      "Unhandled DELETE /api/guidelines/documents/[documentId] error:",
      err instanceof Error ? err.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "Unable to discard guideline document session." },
      { status: 500 },
    );
  }
}
