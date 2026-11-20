import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  BrandKnowledgeRepositoryError,
  CrossTenantBrandAccessError,
  KnowledgeEntryNotFoundError,
  ManagedKnowledgeSectionSchema,
  PublicationStatusSchema,
  createBrandKnowledgeRepository,
} from "@/lib/brand-context";
import { resolveServerApiTenantContext } from "@/lib/brand-context/server-api-auth";

const SaveEntryPayloadSchema = z
  .object({
    action: z.enum(["save_draft", "save_and_publish"]),
    id: z.string().trim().min(1).optional(),
    brandId: z.string().trim().min(1, "brandId is required."),
    organisationId: z.string().trim().min(1).optional(),
    section: ManagedKnowledgeSectionSchema,
    kind: z.string().trim().min(1).optional(),
    title: z
      .string()
      .trim()
      .min(2, "Rule or fact title must be at least 2 characters.")
      .max(200),
    content: z
      .string()
      .trim()
      .min(2, "Guidance or fact description is required.")
      .max(8000),
    preferredTerm: z.string().trim().max(500).optional(),
    avoidTerm: z.string().trim().max(500).optional(),
    hexCodes: z
      .array(
        z
          .string()
          .trim()
          .regex(/^#[0-9a-fA-F]{6}$/, "Hex codes must follow #RRGGBB format."),
      )
      .optional(),
    fontFamily: z.string().trim().max(200).optional(),
    supportingEvidence: z.string().trim().max(1000).optional(),
    restrictions: z.array(z.string().trim().min(1)).optional(),
    severity: z.enum(["high", "medium", "low"]).optional(),
    sourceDocumentId: z.string().trim().max(160).optional(),
    sourceTitle: z.string().trim().max(300).optional(),
    sectionRef: z.string().trim().max(200).optional(),
    pageNumber: z.number().int().positive().optional(),
    applicableTo: z
      .object({
        submissionIds: z.array(z.string().trim().min(1)).optional(),
        contentPlatforms: z.array(z.string().trim().min(1)).optional(),
      })
      .strict()
      .optional(),
    owner: z.string().trim().max(160).optional(),
    versionId: z.string().trim().max(60).optional(),
  })
  .strict();

const PublishEntryPayloadSchema = z
  .object({
    action: z.literal("publish"),
    entryId: z.string().trim().min(1, "entryId is required."),
    brandId: z.string().trim().min(1, "brandId is required."),
    organisationId: z.string().trim().min(1).optional(),
    actor: z.string().trim().max(160).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

const ArchiveEntryPayloadSchema = z
  .object({
    action: z.literal("archive"),
    entryId: z.string().trim().min(1, "entryId is required."),
    brandId: z.string().trim().min(1, "brandId is required."),
    organisationId: z.string().trim().min(1).optional(),
    actor: z.string().trim().max(160).optional(),
  })
  .strict();

const KnowledgeMutationSchema = z.discriminatedUnion("action", [
  SaveEntryPayloadSchema,
  PublishEntryPayloadSchema,
  ArchiveEntryPayloadSchema,
]);

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
    const rawStatus = req.nextUrl.searchParams.get("status");
    const statusParsed =
      !rawStatus || rawStatus === "all"
        ? "all"
        : PublicationStatusSchema.safeParse(rawStatus);

    if (statusParsed !== "all" && !statusParsed.success) {
      return NextResponse.json(
        { error: `Unsupported publication status "${rawStatus}".` },
        { status: 400 },
      );
    }

    const tenant = await resolveServerApiTenantContext(req, {
      requestedOrganisationId: requestedOrgId,
      isMutation: false,
    });
    if (!tenant.ok) {
      return NextResponse.json({ error: tenant.error }, { status: tenant.status });
    }

    const repo = createBrandKnowledgeRepository();
    const brand = await repo.getBrand(brandId, tenant.organisationId);
    if (!brand) {
      return NextResponse.json(
        { error: `Brand "${brandId}" was not found.` },
        { status: 404 },
      );
    }

    const [entries, snapshots] = await Promise.all([
      repo.listKnowledgeEntries({
        brandId,
        organisationId: tenant.organisationId,
        status: statusParsed === "all" ? "all" : statusParsed.data,
      }),
      repo.listVersionSnapshots(brandId, tenant.organisationId),
    ]);

    return NextResponse.json({
      brand,
      entries,
      snapshots,
    });
  } catch (err) {
    if (err instanceof CrossTenantBrandAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof BrandKnowledgeRepositoryError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(
      "Unhandled GET /api/knowledge error:",
      err instanceof Error ? err.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "Unable to load brand knowledge entries." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const parsed = KnowledgeMutationSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ||
            "Invalid knowledge mutation payload.",
        },
        { status: 400 },
      );
    }

    const payload = parsed.data;
    const tenant = await resolveServerApiTenantContext(req, {
      requestedOrganisationId: payload.organisationId,
      isMutation: true,
    });
    if (!tenant.ok) {
      return NextResponse.json({ error: tenant.error }, { status: tenant.status });
    }

    const repo = createBrandKnowledgeRepository();
    const existingBrand = await repo.getBrand(
      payload.brandId,
      tenant.organisationId,
    );
    if (!existingBrand) {
      return NextResponse.json(
        { error: `Brand "${payload.brandId}" was not found.` },
        { status: 404 },
      );
    }

    if (payload.action === "publish") {
      const result = await repo.publishKnowledgeEntry({
        entryId: payload.entryId,
        brandId: payload.brandId,
        organisationId: tenant.organisationId,
        actor: payload.actor || tenant.actorName,
        note: payload.note,
      });
      const [brand, snapshots] = await Promise.all([
        repo.getBrand(payload.brandId, tenant.organisationId),
        repo.listVersionSnapshots(payload.brandId, tenant.organisationId),
      ]);
      return NextResponse.json({
        entry: result.entry,
        snapshot: result.snapshot,
        brand,
        snapshots,
      });
    }

    if (payload.action === "archive") {
      const entry = await repo.archiveKnowledgeEntry({
        entryId: payload.entryId,
        brandId: payload.brandId,
        organisationId: tenant.organisationId,
        actor: payload.actor || tenant.actorName,
      });
      const brand = await repo.getBrand(payload.brandId, tenant.organisationId);
      return NextResponse.json({
        entry,
        brand,
      });
    }

    const entry = await repo.saveKnowledgeEntry({
      id: payload.id,
      brandId: payload.brandId,
      organisationId: tenant.organisationId,
      section: payload.section,
      kind: payload.kind,
      title: payload.title,
      content: payload.content,
      preferredTerm: payload.preferredTerm,
      avoidTerm: payload.avoidTerm,
      hexCodes: payload.hexCodes,
      fontFamily: payload.fontFamily,
      supportingEvidence: payload.supportingEvidence,
      restrictions: payload.restrictions,
      severity: payload.severity,
      publicationStatus:
        payload.action === "save_and_publish" ? "published" : "draft",
      sourceDocumentId: payload.sourceDocumentId,
      sourceTitle: payload.sourceTitle,
      sectionRef: payload.sectionRef,
      pageNumber: payload.pageNumber,
      applicableTo: payload.applicableTo,
      owner: payload.owner || tenant.actorName,
      versionId: payload.versionId,
    });

    const [brand, snapshots] = await Promise.all([
      repo.getBrand(payload.brandId, tenant.organisationId),
      repo.listVersionSnapshots(payload.brandId, tenant.organisationId),
    ]);

    return NextResponse.json({
      entry,
      brand,
      snapshots,
    });
  } catch (err) {
    if (err instanceof CrossTenantBrandAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof KnowledgeEntryNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof BrandKnowledgeRepositoryError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(
      "Unhandled POST /api/knowledge error:",
      err instanceof Error ? err.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "Unable to save brand knowledge entry." },
      { status: 500 },
    );
  }
}
