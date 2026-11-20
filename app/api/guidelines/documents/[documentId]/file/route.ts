import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  CrossTenantBrandAccessError,
  HostedPersistenceUnavailableError,
} from "@/lib/brand-context";
import { resolveServerApiTenantContext } from "@/lib/brand-context/server-api-auth";
import { createGuidelineDocumentRepository } from "@/lib/guidelines/document-repository";
import {
  GuidelineStorageError,
  createGuidelinePdfStorage,
} from "@/lib/guidelines/storage";

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

    const storage = createGuidelinePdfStorage();
    const pdfBuffer = await storage.getPdf(session.storageKey);
    const safeFileName =
      path.basename(session.fileName).replace(/[^a-zA-Z0-9._-]+/g, "_") ||
      "guideline.pdf";

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof HostedPersistenceUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof CrossTenantBrandAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof GuidelineStorageError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error(
      "Unhandled GET /api/guidelines/documents/[documentId]/file error:",
      err instanceof Error ? err.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "Unable to retrieve source guideline PDF." },
      { status: 500 },
    );
  }
}
