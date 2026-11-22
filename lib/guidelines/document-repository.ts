import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  BrandKnowledgeRepositoryError,
  CrossTenantBrandAccessError,
  HostedPersistenceUnavailableError,
  ManagedKnowledgeSectionSchema,
  StructuredFactMetadataSchema,
  getPersistenceEnvironmentInfo,
} from "@/lib/brand-context";
import { TERALUNE_DEMO_BRAND_ID } from "@/lib/demo/teralune-demo-fixtures";
import { callServerPostgrest } from "@/lib/supabase/server";

const SUPABASE_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSafeSupabaseUuid(value: string | null | undefined): boolean {
  return Boolean(value && SUPABASE_UUID_REGEX.test(value.trim()));
}

export const GuidelinePageStatusSchema = z.enum([
  "TEXT_EXTRACTED",
  "OCR_EXTRACTED",
  "NO_EXTRACTABLE_TEXT",
  "PAGE_FAILED",
]);

export type GuidelinePageStatus = z.infer<typeof GuidelinePageStatusSchema>;

export const GuidelinePageExtractionDetailSchema = z
  .object({
    pageNumber: z.number().int().positive(),
    status: GuidelinePageStatusSchema,
    extractionSource: z.enum(["embedded_text", "ocr", "none", "failed"]),
    text: z.string(),
    ocrConfidence: z.number().min(0).max(1).optional(),
    requiresHumanReview: z.boolean(),
    warnings: z.array(z.string()),
    error: z.string().optional(),
  })
  .strict();

export type GuidelinePageExtractionDetail = z.infer<
  typeof GuidelinePageExtractionDetailSchema
>;

export const ProposalConflictSeveritySchema = z.enum([
  "conflict",
  "possible_conflict",
]);

export const ProposalConflictCategorySchema = z.enum([
  "price",
  "date",
  "colour",
  "terminology",
  "inverse_rule",
]);

export const ProposalConflictMatchSchema = z
  .object({
    existingEntryId: z.string().trim().min(1),
    existingTitle: z.string().trim().min(1),
    existingContent: z.string().trim().min(1),
    existingSection: ManagedKnowledgeSectionSchema,
    existingStatus: z.literal("published"),
    existingVersionId: z.string().trim().min(1),
    existingSourceDocumentId: z.string().trim().min(1),
    existingSourceTitle: z.string().trim().min(1),
    existingSourceDocumentVersion: z.string().trim().min(1).optional(),
    existingPageNumber: z.number().int().positive().optional(),
    existingSectionRef: z.string().trim().min(1).optional(),
    severity: ProposalConflictSeveritySchema,
    category: ProposalConflictCategorySchema,
    reason: z.string().trim().min(1),
    proposalStatement: z.string().trim().min(1),
    existingStatement: z.string().trim().min(1),
  })
  .strict();

export type ProposalConflictMatch = z.infer<typeof ProposalConflictMatchSchema>;

export const ConflictResolutionSchema = z.enum([
  "unresolved",
  "keep_existing",
  "publish_and_archive_existing",
  "publish_coexisting",
  "discard_proposal",
]);

export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>;

export const KnowledgeProposalStatusSchema = z.enum([
  "pending_review",
  "draft_saved",
  "published",
  "discarded",
]);

export type KnowledgeProposalStatus = z.infer<
  typeof KnowledgeProposalStatusSchema
>;

export const KnowledgeProposalSchema = z
  .object({
    proposalId: z.string().trim().min(1),
    documentId: z.string().trim().min(1),
    brandId: z.string().trim().min(1),
    organisationId: z.string().trim().min(1),
    extractedText: z.string().min(1),
    title: z.string().trim().min(1),
    content: z.string().trim().min(1),
    suggestedCategory: ManagedKnowledgeSectionSchema,
    category: ManagedKnowledgeSectionSchema,
    classificationUncertain: z.boolean(),
    uncertaintyReason: z.string().trim().optional(),
    requiresHumanReview: z.boolean(),
    extractionSource: z.enum(["embedded_text", "ocr", "manual_selection"]),
    ocrConfidence: z.number().min(0).max(1).optional(),
    pageNumber: z.number().int().positive(),
    sectionRef: z.string().trim().min(1).optional(),
    structuredFacts: StructuredFactMetadataSchema.optional(),
    preferredTerm: z.string().trim().min(1).optional(),
    avoidTerm: z.string().trim().min(1).optional(),
    hexCodes: z.array(z.string().trim().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
    fontFamily: z.string().trim().min(1).optional(),
    supportingEvidence: z.string().trim().min(1).optional(),
    restrictions: z.array(z.string().trim().min(1)).optional(),
    severity: z.enum(["high", "medium", "low"]).optional(),
    status: KnowledgeProposalStatusSchema,
    conflictStatus: z
      .enum(["conflict", "possible_conflict", "no_conflict"])
      .optional(),
    conflictMatches: z.array(ProposalConflictMatchSchema).optional(),
    conflictResolution: ConflictResolutionSchema.optional(),
    publishedEntryId: z.string().trim().min(1).optional(),
    publishedVersionId: z.string().trim().min(1).optional(),
    publishIdempotencyKey: z.string().trim().min(1).optional(),
    createdAt: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1),
  })
  .strict();

export type KnowledgeProposal = z.infer<typeof KnowledgeProposalSchema>;

export const GuidelineDocumentSessionStatusSchema = z.enum([
  "ready_for_review",
  "completed",
  "failed",
  "discarded",
]);

export const GuidelineDocumentSessionSchema = z
  .object({
    documentId: z.string().trim().min(1),
    brandId: z.string().trim().min(1),
    organisationId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    fileName: z.string().trim().min(1),
    mimeType: z.string().trim().min(1),
    fileSizeBytes: z.number().int().nonnegative(),
    sha256: z.string().trim().min(16),
    sourceDocumentVersion: z.string().trim().min(1),
    storageKey: z.string().trim().min(1),
    storageBackend: z.enum(["supabase", "local_file"]),
    status: GuidelineDocumentSessionStatusSchema,
    totalPageCount: z.number().int().nonnegative(),
    ocrUsed: z.boolean(),
    ocrPageCount: z.number().int().nonnegative(),
    failedPageCount: z.number().int().nonnegative(),
    pages: z.array(GuidelinePageExtractionDetailSchema),
    warnings: z.array(z.string()),
    error: z.string().optional(),
    proposals: z.array(KnowledgeProposalSchema),
    uploadedBy: z.string().trim().min(1),
    createdAt: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1),
  })
  .strict();

export type GuidelineDocumentSession = z.infer<
  typeof GuidelineDocumentSessionSchema
>;

export class DuplicateGuidelineDocumentError extends Error {
  constructor(
    public readonly existingSession: GuidelineDocumentSession,
    message?: string,
  ) {
    super(
      message ||
        `This PDF matches an existing uploaded guideline document ("${existingSession.title}", ${existingSession.sourceDocumentVersion}).`,
    );
    this.name = "DuplicateGuidelineDocumentError";
  }
}

export class GuidelineDocumentNotFoundError extends Error {
  constructor(documentId: string) {
    super(`Guideline document "${documentId}" was not found.`);
    this.name = "GuidelineDocumentNotFoundError";
  }
}

export class GuidelineProposalNotFoundError extends Error {
  constructor(proposalId: string) {
    super(`Knowledge proposal "${proposalId}" was not found.`);
    this.name = "GuidelineProposalNotFoundError";
  }
}

export interface GuidelineDocumentRepository {
  listDocumentSessions(query: {
    brandId: string;
    organisationId: string;
    includeDiscarded?: boolean;
  }): Promise<GuidelineDocumentSession[]>;

  getDocumentSession(query: {
    documentId: string;
    organisationId: string;
  }): Promise<GuidelineDocumentSession | null>;

  findByChecksum(query: {
    brandId: string;
    organisationId: string;
    sha256: string;
  }): Promise<GuidelineDocumentSession | null>;

  saveDocumentSession(
    session: GuidelineDocumentSession,
  ): Promise<GuidelineDocumentSession>;

  updateProposal(input: {
    documentId: string;
    proposalId: string;
    organisationId: string;
    updater: (current: KnowledgeProposal) => KnowledgeProposal;
  }): Promise<{
    session: GuidelineDocumentSession;
    proposal: KnowledgeProposal;
  }>;

  discardDocumentSession(input: {
    documentId: string;
    organisationId: string;
  }): Promise<{
    session: GuidelineDocumentSession;
    deletedCompletely: boolean;
    shouldDeleteStorage: boolean;
  }>;
}

function getDefaultStorePath(): string {
  const custom = process.env.IDENTIQ_GUIDELINE_DOCS_STORE_PATH?.trim();
  return custom
    ? path.resolve(custom)
    : path.resolve(process.cwd(), ".identiq-data", "guideline-documents-store.json");
}

function syncSessionLifecycleStatus(
  session: GuidelineDocumentSession,
): GuidelineDocumentSession {
  if (session.status === "failed" || session.status === "discarded") {
    return session;
  }
  const hasOpen = session.proposals.some(
    (p) => p.status === "pending_review" || p.status === "draft_saved",
  );
  const hasPublished = session.proposals.some((p) => p.status === "published");
  const nextStatus =
    session.proposals.length > 0 && !hasOpen && hasPublished
      ? "completed"
      : "ready_for_review";
  return {
    ...session,
    status: nextStatus,
  };
}

export class FileBackedGuidelineDocumentRepository
  implements GuidelineDocumentRepository
{
  private readonly storePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storePath?: string) {
    this.storePath = storePath
      ? path.resolve(storePath)
      : getDefaultStorePath();
  }

  private async readAll(): Promise<GuidelineDocumentSession[]> {
    try {
      const raw = await fs.readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const sessions: GuidelineDocumentSession[] = [];
      for (const item of parsed) {
        const res = GuidelineDocumentSessionSchema.safeParse(item);
        if (res.success) {
          sessions.push(res.data);
        }
      }
      return sessions;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeAll(sessions: GuidelineDocumentSession[]): Promise<void> {
    const dir = path.dirname(this.storePath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = `${this.storePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(sessions, null, 2), "utf8");
    await fs.rename(tempPath, this.storePath);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn, fn);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async listDocumentSessions(query: {
    brandId: string;
    organisationId: string;
    includeDiscarded?: boolean;
  }): Promise<GuidelineDocumentSession[]> {
    const sessions = await this.readAll();
    return sessions
      .filter(
        (s) =>
          s.brandId === query.brandId &&
          s.organisationId === query.organisationId &&
          (query.includeDiscarded || s.status !== "discarded"),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getDocumentSession(query: {
    documentId: string;
    organisationId: string;
  }): Promise<GuidelineDocumentSession | null> {
    const sessions = await this.readAll();
    const match = sessions.find((s) => s.documentId === query.documentId);
    if (!match) return null;
    if (match.organisationId !== query.organisationId) {
      throw new CrossTenantBrandAccessError(match.brandId, query.organisationId);
    }
    return match;
  }

  async findByChecksum(query: {
    brandId: string;
    organisationId: string;
    sha256: string;
  }): Promise<GuidelineDocumentSession | null> {
    const sessions = await this.readAll();
    return (
      sessions.find(
        (s) =>
          s.brandId === query.brandId &&
          s.organisationId === query.organisationId &&
          s.sha256 === query.sha256 &&
          s.status !== "discarded",
      ) ?? null
    );
  }

  async saveDocumentSession(
    session: GuidelineDocumentSession,
  ): Promise<GuidelineDocumentSession> {
    const validated = GuidelineDocumentSessionSchema.parse(
      syncSessionLifecycleStatus(session),
    );
    return this.enqueue(async () => {
      const sessions = await this.readAll();
      const idx = sessions.findIndex(
        (s) => s.documentId === validated.documentId,
      );
      if (idx >= 0) {
        if (sessions[idx]!.organisationId !== validated.organisationId) {
          throw new CrossTenantBrandAccessError(
            validated.brandId,
            validated.organisationId,
          );
        }
        sessions[idx] = validated;
      } else {
        sessions.push(validated);
      }
      await this.writeAll(sessions);
      return validated;
    });
  }

  async updateProposal(input: {
    documentId: string;
    proposalId: string;
    organisationId: string;
    updater: (current: KnowledgeProposal) => KnowledgeProposal;
  }): Promise<{
    session: GuidelineDocumentSession;
    proposal: KnowledgeProposal;
  }> {
    return this.enqueue(async () => {
      const sessions = await this.readAll();
      const idx = sessions.findIndex((s) => s.documentId === input.documentId);
      if (idx < 0) {
        throw new GuidelineDocumentNotFoundError(input.documentId);
      }
      const existing = sessions[idx]!;
      if (existing.organisationId !== input.organisationId) {
        throw new CrossTenantBrandAccessError(
          existing.brandId,
          input.organisationId,
        );
      }

      const proposalIdx = existing.proposals.findIndex(
        (p) => p.proposalId === input.proposalId,
      );
      if (proposalIdx < 0) {
        throw new GuidelineProposalNotFoundError(input.proposalId);
      }

      const updatedProposal = KnowledgeProposalSchema.parse(
        input.updater(existing.proposals[proposalIdx]!),
      );
      const nextProposals = [...existing.proposals];
      nextProposals[proposalIdx] = updatedProposal;

      const updatedSession = GuidelineDocumentSessionSchema.parse(
        syncSessionLifecycleStatus({
          ...existing,
          proposals: nextProposals,
          updatedAt: new Date().toISOString(),
        }),
      );
      sessions[idx] = updatedSession;
      await this.writeAll(sessions);
      return {
        session: updatedSession,
        proposal: updatedProposal,
      };
    });
  }

  async discardDocumentSession(input: {
    documentId: string;
    organisationId: string;
  }): Promise<{
    session: GuidelineDocumentSession;
    deletedCompletely: boolean;
    shouldDeleteStorage: boolean;
  }> {
    return this.enqueue(async () => {
      const sessions = await this.readAll();
      const idx = sessions.findIndex((s) => s.documentId === input.documentId);
      if (idx < 0) {
        throw new GuidelineDocumentNotFoundError(input.documentId);
      }
      const existing = sessions[idx]!;
      if (existing.organisationId !== input.organisationId) {
        throw new CrossTenantBrandAccessError(
          existing.brandId,
          input.organisationId,
        );
      }

      const hasPublished = existing.proposals.some(
        (p) => p.status === "published" && p.publishedEntryId,
      );

      if (!hasPublished) {
        const nextSessions = sessions.filter(
          (s) => s.documentId !== input.documentId,
        );
        await this.writeAll(nextSessions);
        return {
          session: {
            ...existing,
            status: "discarded",
          },
          deletedCompletely: true,
          shouldDeleteStorage: true,
        };
      }

      const now = new Date().toISOString();
      const nextSession = GuidelineDocumentSessionSchema.parse({
        ...existing,
        status: "discarded",
        proposals: existing.proposals.map((p) =>
          p.status === "published"
            ? p
            : { ...p, status: "discarded", updatedAt: now },
        ),
        updatedAt: now,
      });
      sessions[idx] = nextSession;
      await this.writeAll(sessions);
      return {
        session: nextSession,
        deletedCompletely: false,
        shouldDeleteStorage: false,
      };
    });
  }
}

interface SupabaseAuditSessionRow {
  id: string;
  organisation_id?: string;
  brand_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: {
    session?: unknown;
  } | null;
  created_at: string;
}

export class SupabaseGuidelineDocumentRepository
  implements GuidelineDocumentRepository
{
  private extractSession(row: SupabaseAuditSessionRow): GuidelineDocumentSession | null {
    const parsed = GuidelineDocumentSessionSchema.safeParse(row.details?.session);
    return parsed.success ? parsed.data : null;
  }

  async listDocumentSessions(query: {
    brandId: string;
    organisationId: string;
    includeDiscarded?: boolean;
  }): Promise<GuidelineDocumentSession[]> {
    if (
      query.brandId === TERALUNE_DEMO_BRAND_ID ||
      !isSafeSupabaseUuid(query.brandId)
    ) {
      return [];
    }

    const res = await callServerPostgrest<SupabaseAuditSessionRow[]>(
      `/rest/v1/audit_logs?brand_id=eq.${encodeURIComponent(query.brandId)}&action=eq.GUIDELINE_DOCUMENT_SESSION&entity_type=eq.guideline_document&order=created_at.desc`,
      { useServiceRole: true },
    );

    if (res.error || !Array.isArray(res.data)) {
      throw new Error(
        res.error?.message || "Failed to load guideline document sessions.",
      );
    }

    const byDocId = new Map<string, GuidelineDocumentSession>();
    for (const row of res.data) {
      const session = this.extractSession(row);
      if (!session) continue;
      if (session.organisationId !== query.organisationId) continue;
      if (!byDocId.has(session.documentId)) {
        byDocId.set(session.documentId, session);
      }
    }

    return [...byDocId.values()]
      .filter((s) => query.includeDiscarded || s.status !== "discarded")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getDocumentSession(query: {
    documentId: string;
    organisationId: string;
  }): Promise<GuidelineDocumentSession | null> {
    const res = await callServerPostgrest<SupabaseAuditSessionRow[]>(
      `/rest/v1/audit_logs?entity_type=eq.guideline_document&entity_id=eq.${encodeURIComponent(query.documentId)}&action=eq.GUIDELINE_DOCUMENT_SESSION&order=created_at.desc&limit=1`,
      { useServiceRole: true },
    );

    if (res.error || !Array.isArray(res.data)) {
      throw new Error(
        res.error?.message || "Failed to load guideline document session.",
      );
    }

    const row = res.data[0];
    if (!row) return null;
    const session = this.extractSession(row);
    if (!session) return null;
    if (session.organisationId !== query.organisationId) {
      throw new CrossTenantBrandAccessError(
        session.brandId || row.brand_id || "unknown",
        query.organisationId,
      );
    }

    return session;
  }

  async findByChecksum(query: {
    brandId: string;
    organisationId: string;
    sha256: string;
  }): Promise<GuidelineDocumentSession | null> {
    const sessions = await this.listDocumentSessions({
      brandId: query.brandId,
      organisationId: query.organisationId,
      includeDiscarded: false,
    });
    return sessions.find((s) => s.sha256 === query.sha256) ?? null;
  }

  async saveDocumentSession(
    session: GuidelineDocumentSession,
  ): Promise<GuidelineDocumentSession> {
    if (
      session.brandId === TERALUNE_DEMO_BRAND_ID ||
      !isSafeSupabaseUuid(session.brandId) ||
      !isSafeSupabaseUuid(session.organisationId)
    ) {
      throw new BrandKnowledgeRepositoryError(
        "Sample brand guidelines are read-only reference fixtures. Select or create a workspace brand to upload and stage guideline PDFs.",
      );
    }

    const validated = GuidelineDocumentSessionSchema.parse(
      syncSessionLifecycleStatus(session),
    );

    const existingAsset = await callServerPostgrest<Array<{ id: string }>>(
      `/rest/v1/assets?id=eq.${encodeURIComponent(validated.documentId)}&select=id`,
      { useServiceRole: true },
    );

    if (Array.isArray(existingAsset.data) && existingAsset.data.length > 0) {
      await callServerPostgrest(
        `/rest/v1/assets?id=eq.${encodeURIComponent(validated.documentId)}&organisation_id=eq.${encodeURIComponent(validated.organisationId)}`,
        {
          method: "PATCH",
          useServiceRole: true,
          body: {
            title: validated.title,
            storage_path: validated.storageKey,
            mime_type: validated.mimeType,
            metadata: {
              identiqGuidelinePdf: true,
              sha256: validated.sha256,
              sourceDocumentVersion: validated.sourceDocumentVersion,
              status: validated.status,
              totalPageCount: validated.totalPageCount,
              updatedAt: validated.updatedAt,
            },
          },
        },
      );
    } else {
      await callServerPostgrest("/rest/v1/assets", {
        method: "POST",
        useServiceRole: true,
        body: {
          id: validated.documentId,
          organisation_id: validated.organisationId,
          brand_id: validated.brandId,
          title: validated.title,
          asset_category: "guideline_pdf",
          storage_path: validated.storageKey,
          mime_type: validated.mimeType,
          metadata: {
            identiqGuidelinePdf: true,
            sha256: validated.sha256,
            sourceDocumentVersion: validated.sourceDocumentVersion,
            status: validated.status,
            totalPageCount: validated.totalPageCount,
            createdAt: validated.createdAt,
            updatedAt: validated.updatedAt,
          },
        },
      });
    }

    const existingAudit = await callServerPostgrest<Array<{ id: string }>>(
      `/rest/v1/audit_logs?entity_type=eq.guideline_document&entity_id=eq.${encodeURIComponent(validated.documentId)}&action=eq.GUIDELINE_DOCUMENT_SESSION&select=id&limit=1`,
      { useServiceRole: true },
    );

    if (Array.isArray(existingAudit.data) && existingAudit.data.length > 0) {
      const updateRes = await callServerPostgrest(
        `/rest/v1/audit_logs?id=eq.${encodeURIComponent(existingAudit.data[0]!.id)}`,
        {
          method: "PATCH",
          useServiceRole: true,
          body: {
            details: { session: validated },
          },
        },
      );
      if (updateRes.error) {
        throw new Error(
          updateRes.error.message || "Failed to update guideline document session.",
        );
      }
    } else {
      const insertRes = await callServerPostgrest("/rest/v1/audit_logs", {
        method: "POST",
        useServiceRole: true,
        body: {
          brand_id: validated.brandId,
          action: "GUIDELINE_DOCUMENT_SESSION",
          entity_type: "guideline_document",
          entity_id: validated.documentId,
          details: { session: validated },
        },
      });
      if (insertRes.error) {
        throw new Error(
          insertRes.error.message || "Failed to save guideline document session.",
        );
      }
    }

    return validated;
  }

  async updateProposal(input: {
    documentId: string;
    proposalId: string;
    organisationId: string;
    updater: (current: KnowledgeProposal) => KnowledgeProposal;
  }): Promise<{
    session: GuidelineDocumentSession;
    proposal: KnowledgeProposal;
  }> {
    const existing = await this.getDocumentSession({
      documentId: input.documentId,
      organisationId: input.organisationId,
    });
    if (!existing) {
      throw new GuidelineDocumentNotFoundError(input.documentId);
    }

    const idx = existing.proposals.findIndex(
      (p) => p.proposalId === input.proposalId,
    );
    if (idx < 0) {
      throw new GuidelineProposalNotFoundError(input.proposalId);
    }

    const updatedProposal = KnowledgeProposalSchema.parse(
      input.updater(existing.proposals[idx]!),
    );
    const nextProposals = [...existing.proposals];
    nextProposals[idx] = updatedProposal;

    const updatedSession = await this.saveDocumentSession({
      ...existing,
      proposals: nextProposals,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: updatedSession,
      proposal: updatedProposal,
    };
  }

  async discardDocumentSession(input: {
    documentId: string;
    organisationId: string;
  }): Promise<{
    session: GuidelineDocumentSession;
    deletedCompletely: boolean;
    shouldDeleteStorage: boolean;
  }> {
    const existing = await this.getDocumentSession({
      documentId: input.documentId,
      organisationId: input.organisationId,
    });
    if (!existing) {
      throw new GuidelineDocumentNotFoundError(input.documentId);
    }

    const hasPublished = existing.proposals.some(
      (p) => p.status === "published" && p.publishedEntryId,
    );
    const now = new Date().toISOString();

    if (!hasPublished) {
      await callServerPostgrest(
        `/rest/v1/audit_logs?entity_type=eq.guideline_document&entity_id=eq.${encodeURIComponent(input.documentId)}&action=eq.GUIDELINE_DOCUMENT_SESSION`,
        { method: "DELETE", useServiceRole: true },
      );
      await callServerPostgrest(
        `/rest/v1/assets?id=eq.${encodeURIComponent(input.documentId)}&organisation_id=eq.${encodeURIComponent(input.organisationId)}&asset_category=eq.guideline_pdf`,
        { method: "DELETE", useServiceRole: true },
      );
      return {
        session: { ...existing, status: "discarded", updatedAt: now },
        deletedCompletely: true,
        shouldDeleteStorage: true,
      };
    }

    const nextSession = await this.saveDocumentSession({
      ...existing,
      status: "discarded",
      proposals: existing.proposals.map((p) =>
        p.status === "published"
          ? p
          : { ...p, status: "discarded", updatedAt: now },
      ),
      updatedAt: now,
    });

    return {
      session: nextSession,
      deletedCompletely: false,
      shouldDeleteStorage: false,
    };
  }
}

export function createGuidelineDocumentRepository(): GuidelineDocumentRepository {
  const info = getPersistenceEnvironmentInfo();
  if (info.backend === "supabase") {
    return new SupabaseGuidelineDocumentRepository();
  }
  if (info.backend === "unavailable") {
    throw new HostedPersistenceUnavailableError(info.reason);
  }
  return new FileBackedGuidelineDocumentRepository();
}
