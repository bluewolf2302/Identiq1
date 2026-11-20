import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  BrandKnowledgeRepositoryError,
  CrossTenantBrandAccessError,
  HostedPersistenceUnavailableError,
  ManagedKnowledgeSectionSchema,
  StructuredFactMetadataSchema,
  createBrandKnowledgeRepository,
} from "@/lib/brand-context";
import { resolveServerApiTenantContext } from "@/lib/brand-context/server-api-auth";
import {
  attachConflictsToProposals,
  detectProposalConflicts,
} from "@/lib/guidelines/conflict-detector";
import {
  ConflictResolutionSchema,
  GuidelineDocumentNotFoundError,
  GuidelineProposalNotFoundError,
  createGuidelineDocumentRepository,
} from "@/lib/guidelines/document-repository";
import { createManualProposalFromPassage } from "@/lib/guidelines/intelligence";

const ProposalEditableFieldsSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  content: z.string().trim().min(2).max(8000).optional(),
  category: ManagedKnowledgeSectionSchema.optional(),
  sectionRef: z.string().trim().max(200).optional(),
  pageNumber: z.number().int().positive().optional(),
  structuredFacts: StructuredFactMetadataSchema.optional(),
  preferredTerm: z.string().trim().max(500).optional(),
  avoidTerm: z.string().trim().max(500).optional(),
  hexCodes: z
    .array(z.string().trim().regex(/^#[0-9a-fA-F]{6}$/))
    .optional(),
  fontFamily: z.string().trim().max(200).optional(),
  supportingEvidence: z.string().trim().max(1000).optional(),
  restrictions: z.array(z.string().trim().min(1)).optional(),
  severity: z.enum(["high", "medium", "low"]).optional(),
  conflictResolution: ConflictResolutionSchema.optional(),
});

const SaveProposalDraftSchema = ProposalEditableFieldsSchema.extend({
  action: z.literal("save_draft"),
  documentId: z.string().trim().min(1),
  proposalId: z.string().trim().min(1),
  organisationId: z.string().trim().min(1).optional(),
}).strict();

const PublishProposalSchema = ProposalEditableFieldsSchema.extend({
  action: z.literal("publish"),
  documentId: z.string().trim().min(1),
  proposalId: z.string().trim().min(1),
  organisationId: z.string().trim().min(1).optional(),
  supersedeEntryId: z.string().trim().min(1).max(160).optional(),
  publishIdempotencyKey: z.string().trim().max(200).optional(),
}).strict();

const DiscardProposalSchema = z
  .object({
    action: z.literal("discard"),
    documentId: z.string().trim().min(1),
    proposalId: z.string().trim().min(1),
    organisationId: z.string().trim().min(1).optional(),
  })
  .strict();

const AddManualProposalSchema = z
  .object({
    action: z.literal("add_manual_proposal"),
    documentId: z.string().trim().min(1),
    organisationId: z.string().trim().min(1).optional(),
    extractedText: z.string().trim().min(8).max(8000),
    pageNumber: z.number().int().positive(),
    sectionRef: z.string().trim().max(200).optional(),
    category: ManagedKnowledgeSectionSchema.optional(),
    title: z.string().trim().min(2).max(200).optional(),
  })
  .strict();

const ProposalActionSchema = z.discriminatedUnion("action", [
  SaveProposalDraftSchema,
  PublishProposalSchema,
  DiscardProposalSchema,
  AddManualProposalSchema,
]);

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

    const parsed = ProposalActionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message || "Invalid proposal action payload.",
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

    const docRepo = createGuidelineDocumentRepository();
    const brandRepo = createBrandKnowledgeRepository();
    const session = await docRepo.getDocumentSession({
      documentId: payload.documentId,
      organisationId: tenant.organisationId,
    });
    if (!session) {
      throw new GuidelineDocumentNotFoundError(payload.documentId);
    }

    const publishedEntries = await brandRepo.listKnowledgeEntries({
      brandId: session.brandId,
      organisationId: tenant.organisationId,
      status: "published",
    });

    if (payload.action === "add_manual_proposal") {
      if (payload.pageNumber > Math.max(1, session.totalPageCount)) {
        return NextResponse.json(
          {
            error: `Page ${payload.pageNumber} exceeds this document's ${session.totalPageCount} pages.`,
          },
          { status: 400 },
        );
      }
      const created = createManualProposalFromPassage({
        documentId: session.documentId,
        brandId: session.brandId,
        organisationId: tenant.organisationId,
        extractedText: payload.extractedText,
        pageNumber: payload.pageNumber,
        sectionRef: payload.sectionRef,
        category: payload.category,
        title: payload.title,
      });
      const updatedProposals = attachConflictsToProposals(
        [...session.proposals, created],
        publishedEntries,
      );
      const savedSession = await docRepo.saveDocumentSession({
        ...session,
        proposals: updatedProposals,
        updatedAt: new Date().toISOString(),
      });
      const savedProposal =
        savedSession.proposals.find((p) => p.proposalId === created.proposalId) ??
        created;

      return NextResponse.json(
        { proposal: savedProposal, session: savedSession },
        { status: 201 },
      );
    }

    const existingProposal = session.proposals.find(
      (p) => p.proposalId === payload.proposalId,
    );
    if (!existingProposal) {
      throw new GuidelineProposalNotFoundError(payload.proposalId);
    }

    if (payload.action === "discard") {
      if (existingProposal.status === "published") {
        return NextResponse.json(
          {
            error:
              "Published proposals cannot be discarded here. Archive the published entry in Knowledge Entries if needed.",
          },
          { status: 400 },
        );
      }

      const res = await docRepo.updateProposal({
        documentId: session.documentId,
        proposalId: payload.proposalId,
        organisationId: tenant.organisationId,
        updater: (cur) => ({
          ...cur,
          status: "discarded",
          conflictResolution: "discard_proposal",
          updatedAt: new Date().toISOString(),
        }),
      });
      return NextResponse.json({
        proposal: res.proposal,
        session: {
          ...res.session,
          proposals: attachConflictsToProposals(
            res.session.proposals,
            publishedEntries,
          ),
        },
      });
    }

    if (payload.action === "save_draft") {
      if (existingProposal.status === "published") {
        return NextResponse.json(
          {
            error:
              "This proposal has already been published. Edit the published entry in the Knowledge Entries list.",
          },
          { status: 400 },
        );
      }

      const now = new Date().toISOString();
      const draftCandidate = {
        ...existingProposal,
        // Never overwrite extractedText during edits
        extractedText: existingProposal.extractedText,
        title: payload.title ?? existingProposal.title,
        content: payload.content ?? existingProposal.content,
        category: payload.category ?? existingProposal.category,
        ...(payload.sectionRef !== undefined
          ? payload.sectionRef
            ? { sectionRef: payload.sectionRef }
            : {}
          : {}),
        pageNumber: payload.pageNumber ?? existingProposal.pageNumber,
        structuredFacts:
          payload.structuredFacts ?? existingProposal.structuredFacts,
        preferredTerm: payload.preferredTerm ?? existingProposal.preferredTerm,
        avoidTerm: payload.avoidTerm ?? existingProposal.avoidTerm,
        hexCodes: payload.hexCodes ?? existingProposal.hexCodes,
        fontFamily: payload.fontFamily ?? existingProposal.fontFamily,
        supportingEvidence:
          payload.supportingEvidence ?? existingProposal.supportingEvidence,
        restrictions: payload.restrictions ?? existingProposal.restrictions,
        severity: payload.severity ?? existingProposal.severity,
        conflictResolution:
          payload.conflictResolution ?? existingProposal.conflictResolution,
        status: "draft_saved" as const,
        updatedAt: now,
      };
      const conflictCheck = detectProposalConflicts(
        draftCandidate,
        publishedEntries,
      );

      const res = await docRepo.updateProposal({
        documentId: session.documentId,
        proposalId: payload.proposalId,
        organisationId: tenant.organisationId,
        updater: () => ({
          ...draftCandidate,
          conflictStatus: conflictCheck.conflictStatus,
          conflictMatches: conflictCheck.matches,
        }),
      });

      return NextResponse.json({
        proposal: res.proposal,
        session: {
          ...res.session,
          proposals: attachConflictsToProposals(
            res.session.proposals,
            publishedEntries,
          ),
        },
      });
    }

    // action === "publish"
    const idempotencyKey =
      payload.publishIdempotencyKey ||
      `proposal:${session.documentId}:${existingProposal.proposalId}`;

    if (
      existingProposal.status === "published" &&
      existingProposal.publishedEntryId &&
      (!existingProposal.publishIdempotencyKey ||
        existingProposal.publishIdempotencyKey === idempotencyKey)
    ) {
      const [brand, snapshots] = await Promise.all([
        brandRepo.getBrand(session.brandId, tenant.organisationId),
        brandRepo.listVersionSnapshots(session.brandId, tenant.organisationId),
      ]);
      return NextResponse.json({
        proposal: existingProposal,
        session,
        deduplicated: true,
        brand,
        snapshots,
      });
    }

    const now = new Date().toISOString();
    const publishCandidate = {
      ...existingProposal,
      extractedText: existingProposal.extractedText,
      title: payload.title ?? existingProposal.title,
      content: payload.content ?? existingProposal.content,
      category: payload.category ?? existingProposal.category,
      ...(payload.sectionRef !== undefined
        ? payload.sectionRef
          ? { sectionRef: payload.sectionRef }
          : {}
        : {}),
      pageNumber: payload.pageNumber ?? existingProposal.pageNumber,
      structuredFacts:
        payload.structuredFacts ?? existingProposal.structuredFacts,
      preferredTerm: payload.preferredTerm ?? existingProposal.preferredTerm,
      avoidTerm: payload.avoidTerm ?? existingProposal.avoidTerm,
      hexCodes: payload.hexCodes ?? existingProposal.hexCodes,
      fontFamily: payload.fontFamily ?? existingProposal.fontFamily,
      supportingEvidence:
        payload.supportingEvidence ?? existingProposal.supportingEvidence,
      restrictions: payload.restrictions ?? existingProposal.restrictions,
      severity: payload.severity ?? existingProposal.severity,
      conflictResolution:
        payload.conflictResolution ?? existingProposal.conflictResolution,
      updatedAt: now,
    };

    const conflictCheck = detectProposalConflicts(
      publishCandidate,
      publishedEntries,
    );
    const chosenResolution = publishCandidate.conflictResolution ?? "unresolved";

    if (chosenResolution === "keep_existing" || chosenResolution === "discard_proposal") {
      return NextResponse.json(
        {
          error:
            "Resolution is set to keep existing published knowledge. Discard this proposal instead of publishing.",
          code: "PROPOSAL_CONFLICT_RESOLUTION_MISMATCH",
        },
        { status: 400 },
      );
    }

    if (
      conflictCheck.conflictStatus === "conflict" &&
      chosenResolution !== "publish_and_archive_existing" &&
      chosenResolution !== "publish_coexisting"
    ) {
      return NextResponse.json(
        {
          error:
            "This proposal conflicts with existing published brand knowledge. Choose whether to replace the existing entry or publish alongside it.",
          code: "PROPOSAL_CONFLICT",
          conflictStatus: conflictCheck.conflictStatus,
          conflictMatches: conflictCheck.matches,
        },
        { status: 409 },
      );
    }

    if (chosenResolution === "publish_and_archive_existing") {
      const idsToArchive = payload.supersedeEntryId
        ? [payload.supersedeEntryId]
        : conflictCheck.matches
            .filter((m) => m.severity === "conflict")
            .map((m) => m.existingEntryId);

      for (const entryId of [...new Set(idsToArchive)]) {
        if (entryId !== existingProposal.publishedEntryId) {
          await brandRepo.archiveKnowledgeEntry({
            entryId,
            brandId: session.brandId,
            organisationId: tenant.organisationId,
            actor: tenant.actorName,
          });
        }
      }
    }

    const publishedEntry = await brandRepo.saveKnowledgeEntry({
      id: existingProposal.publishedEntryId,
      brandId: session.brandId,
      organisationId: tenant.organisationId,
      section: publishCandidate.category,
      title: publishCandidate.title,
      content: publishCandidate.content,
      entryOrigin: "guideline_pdf",
      extractedText: existingProposal.extractedText,
      sourceProposalId: existingProposal.proposalId,
      structuredFacts: publishCandidate.structuredFacts,
      preferredTerm: publishCandidate.preferredTerm,
      avoidTerm: publishCandidate.avoidTerm,
      hexCodes: publishCandidate.hexCodes,
      fontFamily: publishCandidate.fontFamily,
      supportingEvidence: publishCandidate.supportingEvidence,
      restrictions: publishCandidate.restrictions,
      severity: publishCandidate.severity,
      publicationStatus: "published",
      sourceDocumentId: session.documentId,
      sourceTitle: session.title,
      sourceDocumentVersion: session.sourceDocumentVersion,
      sectionRef: publishCandidate.sectionRef,
      pageNumber: publishCandidate.pageNumber,
      owner: tenant.actorName,
      publishIdempotencyKey: idempotencyKey,
    });

    const updatedRes = await docRepo.updateProposal({
      documentId: session.documentId,
      proposalId: existingProposal.proposalId,
      organisationId: tenant.organisationId,
      updater: () => ({
        ...publishCandidate,
        status: "published",
        requiresHumanReview: false,
        conflictStatus: conflictCheck.conflictStatus,
        conflictMatches: conflictCheck.matches,
        conflictResolution:
          chosenResolution === "unresolved"
            ? "publish_coexisting"
            : chosenResolution,
        publishedEntryId: publishedEntry.id,
        publishedVersionId: publishedEntry.versionId,
        publishIdempotencyKey: idempotencyKey,
      }),
    });

    const [brand, snapshots, latestPublished] = await Promise.all([
      brandRepo.getBrand(session.brandId, tenant.organisationId),
      brandRepo.listVersionSnapshots(session.brandId, tenant.organisationId),
      brandRepo.listKnowledgeEntries({
        brandId: session.brandId,
        organisationId: tenant.organisationId,
        status: "published",
      }),
    ]);

    return NextResponse.json({
      proposal: updatedRes.proposal,
      session: {
        ...updatedRes.session,
        proposals: attachConflictsToProposals(
          updatedRes.session.proposals,
          latestPublished,
        ),
      },
      entry: publishedEntry,
      brand,
      snapshots,
      deduplicated: false,
    });
  } catch (err) {
    if (err instanceof HostedPersistenceUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof CrossTenantBrandAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (
      err instanceof GuidelineDocumentNotFoundError ||
      err instanceof GuidelineProposalNotFoundError
    ) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof BrandKnowledgeRepositoryError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(
      "Unhandled POST /api/guidelines/proposals error:",
      err instanceof Error ? err.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "Unable to process knowledge proposal update." },
      { status: 500 },
    );
  }
}
