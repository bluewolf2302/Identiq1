import crypto from "node:crypto";
import { callServerPostgrest } from "../supabase/server";
import { buildBrandKnowledgeRecordFromEntries } from "./knowledge-mapper";
import {
  BrandKnowledgeRepositoryError,
  CrossTenantBrandAccessError,
  KnowledgeEntryNotFoundError,
  type CreateWorkspaceBrandInput,
  type MultiBrandKnowledgeRepository,
  type SaveManagedKnowledgeInput,
} from "./repository";
import { teraluneKnowledge } from "./teralune-brand-fixture";
import type {
  BrandContextQuery,
  BrandKnowledgeRecord,
  BrandVersionSnapshot,
  EntryOrigin,
  ManagedKnowledgeEntry,
  ManagedKnowledgeSection,
  PublicationStatus,
  StructuredFactMetadata,
  WorkspaceBrandRecord,
} from "./types";

interface IdentiqRowMeta {
  publicationStatus?: PublicationStatus;
  versionNumber?: number;
  section?: ManagedKnowledgeSection;
  kind?: string;
  entryOrigin?: EntryOrigin;
  extractedText?: string;
  sourceDocumentVersion?: string;
  sourceProposalId?: string;
  structuredFacts?: StructuredFactMetadata;
  preferredTerm?: string;
  avoidTerm?: string;
  hexCodes?: string[];
  fontFamily?: string;
  severity?: "high" | "medium" | "low";
  owner?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  archivedAt?: string;
  publishIdempotencyKey?: string;
}

function parseApplicableAndMeta(raw: unknown): {
  applicableTo?: ManagedKnowledgeEntry["applicableTo"];
  meta: IdentiqRowMeta;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { meta: {} };
  }
  const obj = raw as Record<string, unknown>;
  const meta =
    obj.__identiqMeta && typeof obj.__identiqMeta === "object"
      ? (obj.__identiqMeta as IdentiqRowMeta)
      : {};
  const submissionIds = Array.isArray(obj.submissionIds)
    ? obj.submissionIds.filter((v): v is string => typeof v === "string")
    : undefined;
  const contentPlatforms = Array.isArray(obj.contentPlatforms)
    ? obj.contentPlatforms.filter((v): v is string => typeof v === "string")
    : undefined;

  return {
    applicableTo:
      submissionIds || contentPlatforms
        ? {
            ...(submissionIds ? { submissionIds } : {}),
            ...(contentPlatforms ? { contentPlatforms } : {}),
          }
        : undefined,
    meta,
  };
}

function serializeApplicableAndMeta(
  applicableTo: ManagedKnowledgeEntry["applicableTo"] | undefined,
  meta: IdentiqRowMeta,
): Record<string, unknown> {
  return {
    ...(applicableTo?.submissionIds
      ? { submissionIds: applicableTo.submissionIds }
      : {}),
    ...(applicableTo?.contentPlatforms
      ? { contentPlatforms: applicableTo.contentPlatforms }
      : {}),
    __identiqMeta: meta,
  };
}

function resolvePublicationStatus(
  approved: boolean,
  meta: IdentiqRowMeta,
): PublicationStatus {
  if (meta.publicationStatus) {
    return meta.publicationStatus;
  }
  return approved ? "published" : "draft";
}

function parseVersionNumber(versionId: string | null | undefined, meta: IdentiqRowMeta): number {
  if (typeof meta.versionNumber === "number" && meta.versionNumber > 0) {
    return meta.versionNumber;
  }
  if (versionId) {
    const match = versionId.match(/(\d+)/);
    if (match) {
      const parsed = Number.parseInt(match[1]!, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return 1;
}

export class SupabaseBrandKnowledgeRepository
  implements MultiBrandKnowledgeRepository
{
  private async fetchBrandRow(
    brandId: string,
  ): Promise<Record<string, unknown> | null> {
    const res = await callServerPostgrest<Array<Record<string, unknown>>>(
      `/rest/v1/brands?id=eq.${encodeURIComponent(brandId)}&select=*&limit=1`,
      { useServiceRole: true },
    );
    if (res.error) {
      throw new BrandKnowledgeRepositoryError(
        `Failed to load brand "${brandId}": ${res.error.message}`,
        res.error,
      );
    }
    return res.data && res.data.length > 0 ? res.data[0]! : null;
  }

  private mapRuleRow(
    row: Record<string, unknown>,
    brandId: string,
    organisationId: string,
  ): ManagedKnowledgeEntry {
    const { applicableTo, meta } = parseApplicableAndMeta(row.applicable_to);
    const approved = Boolean(row.approved);
    const publicationStatus = resolvePublicationStatus(approved, meta);
    const versionId =
      typeof row.version_id === "string" && row.version_id.trim()
        ? row.version_id.trim()
        : "v1";
    const category = String(row.category || "guidelines").toLowerCase();
    const section: ManagedKnowledgeSection =
      meta.section ??
      (category.includes("voice")
        ? "voice"
        : category.includes("terminolog")
          ? "terminology"
          : category.includes("polic")
            ? "policies"
            : category.includes("prohibit")
              ? "prohibited"
              : "guidelines");

    return {
      id: String(row.id),
      brandId,
      organisationId,
      section,
      ...(meta.kind ? { kind: meta.kind } : {}),
      title: String(row.rule_name || "Brand Rule"),
      content: String(row.description || row.rule_name || ""),
      entryOrigin: meta.entryOrigin ?? (meta.extractedText ? "guideline_pdf" : "manual"),
      ...(meta.extractedText ? { extractedText: meta.extractedText } : {}),
      ...(meta.sourceProposalId ? { sourceProposalId: meta.sourceProposalId } : {}),
      ...(meta.structuredFacts ? { structuredFacts: meta.structuredFacts } : {}),
      ...(meta.preferredTerm ? { preferredTerm: meta.preferredTerm } : {}),
      ...(meta.avoidTerm ? { avoidTerm: meta.avoidTerm } : {}),
      ...(meta.severity ? { severity: meta.severity } : {}),
      publicationStatus,
      versionNumber: parseVersionNumber(versionId, meta),
      versionId,
      sourceDocumentId:
        typeof row.source_document_id === "string" && row.source_document_id.trim()
          ? row.source_document_id.trim()
          : `src-${brandId}`,
      sourceTitle:
        typeof row.source_title === "string" && row.source_title.trim()
          ? row.source_title.trim()
          : "Brand Guidelines",
      ...(meta.sourceDocumentVersion ? { sourceDocumentVersion: meta.sourceDocumentVersion } : {}),
      ...(typeof row.section === "string" && row.section.trim()
        ? { sectionRef: row.section.trim() }
        : {}),
      ...(typeof row.page_number === "number" && row.page_number > 0
        ? { pageNumber: row.page_number }
        : {}),
      ...(applicableTo ? { applicableTo } : {}),
      owner: meta.owner || "Brand Governance Lead",
      createdAt: meta.createdAt || String(row.created_at || new Date().toISOString()),
      updatedAt: meta.updatedAt || String(row.created_at || new Date().toISOString()),
      ...(meta.publishedAt ? { publishedAt: meta.publishedAt } : {}),
      ...(meta.archivedAt ? { archivedAt: meta.archivedAt } : {}),
      ...(meta.publishIdempotencyKey ? { publishIdempotencyKey: meta.publishIdempotencyKey } : {}),
    };
  }

  private mapFactRow(
    row: Record<string, unknown>,
    brandId: string,
    organisationId: string,
  ): ManagedKnowledgeEntry {
    const { applicableTo, meta } = parseApplicableAndMeta(row.applicable_to);
    const approved = Boolean(row.approved);
    const publicationStatus = resolvePublicationStatus(approved, meta);
    const versionId =
      typeof row.version_id === "string" && row.version_id.trim()
        ? row.version_id.trim()
        : "v1";
    const category = String(row.category || "facts").toLowerCase();
    const section: ManagedKnowledgeSection =
      meta.section ?? (category.includes("prohibit") ? "prohibited" : "facts");

    const restrictions = Array.isArray(row.restrictions)
      ? row.restrictions.filter((v): v is string => typeof v === "string")
      : undefined;

    return {
      id: String(row.id),
      brandId,
      organisationId,
      section,
      ...(meta.kind ? { kind: meta.kind } : {}),
      title: String(row.fact_name || "Brand Fact"),
      content: String(row.fact_value || row.fact_name || ""),
      entryOrigin: meta.entryOrigin ?? (meta.extractedText ? "guideline_pdf" : "manual"),
      ...(meta.extractedText ? { extractedText: meta.extractedText } : {}),
      ...(meta.sourceProposalId ? { sourceProposalId: meta.sourceProposalId } : {}),
      ...(meta.structuredFacts ? { structuredFacts: meta.structuredFacts } : {}),
      ...(meta.avoidTerm ? { avoidTerm: meta.avoidTerm } : {}),
      ...(typeof row.supporting_evidence === "string" && row.supporting_evidence.trim()
        ? { supportingEvidence: row.supporting_evidence.trim() }
        : {}),
      ...(restrictions && restrictions.length > 0 ? { restrictions } : {}),
      publicationStatus,
      versionNumber: parseVersionNumber(versionId, meta),
      versionId,
      sourceDocumentId:
        typeof row.source_document_id === "string" && row.source_document_id.trim()
          ? row.source_document_id.trim()
          : `src-${brandId}`,
      sourceTitle:
        typeof row.source_title === "string" && row.source_title.trim()
          ? row.source_title.trim()
          : String(row.source || "Approved Brand Facts"),
      ...(meta.sourceDocumentVersion ? { sourceDocumentVersion: meta.sourceDocumentVersion } : {}),
      ...(typeof row.section === "string" && row.section.trim()
        ? { sectionRef: row.section.trim() }
        : {}),
      ...(typeof row.page_number === "number" && row.page_number > 0
        ? { pageNumber: row.page_number }
        : {}),
      ...(applicableTo ? { applicableTo } : {}),
      owner: meta.owner || "Brand Governance Lead",
      createdAt: meta.createdAt || String(row.created_at || new Date().toISOString()),
      updatedAt: meta.updatedAt || String(row.created_at || new Date().toISOString()),
      ...(meta.publishedAt ? { publishedAt: meta.publishedAt } : {}),
      ...(meta.archivedAt ? { archivedAt: meta.archivedAt } : {}),
      ...(meta.publishIdempotencyKey ? { publishIdempotencyKey: meta.publishIdempotencyKey } : {}),
    };
  }

  private mapAssetRow(
    row: Record<string, unknown>,
    brandId: string,
    organisationId: string,
  ): ManagedKnowledgeEntry {
    const { applicableTo, meta } = parseApplicableAndMeta(row.applicable_to);
    const approved = Boolean(row.approved);
    const publicationStatus = resolvePublicationStatus(approved, meta);
    const versionId =
      typeof row.version_id === "string" && row.version_id.trim()
        ? row.version_id.trim()
        : "v1";

    return {
      id: String(row.id),
      brandId,
      organisationId,
      section: "visual",
      ...(meta.kind ? { kind: meta.kind } : {}),
      title: String(row.file_name || "Visual Standard"),
      content: String(row.file_path || row.file_name || ""),
      entryOrigin: meta.entryOrigin ?? (meta.extractedText ? "guideline_pdf" : "manual"),
      ...(meta.extractedText ? { extractedText: meta.extractedText } : {}),
      ...(meta.sourceProposalId ? { sourceProposalId: meta.sourceProposalId } : {}),
      ...(meta.structuredFacts ? { structuredFacts: meta.structuredFacts } : {}),
      ...(meta.hexCodes ? { hexCodes: meta.hexCodes } : {}),
      ...(meta.fontFamily ? { fontFamily: meta.fontFamily } : {}),
      publicationStatus,
      versionNumber: parseVersionNumber(versionId, meta),
      versionId,
      sourceDocumentId:
        typeof row.source_document_id === "string" && row.source_document_id.trim()
          ? row.source_document_id.trim()
          : `src-${brandId}`,
      sourceTitle:
        typeof row.source_title === "string" && row.source_title.trim()
          ? row.source_title.trim()
          : "Visual Identity Guidelines",
      ...(meta.sourceDocumentVersion ? { sourceDocumentVersion: meta.sourceDocumentVersion } : {}),
      ...(typeof row.section === "string" && row.section.trim()
        ? { sectionRef: row.section.trim() }
        : {}),
      ...(typeof row.page_number === "number" && row.page_number > 0
        ? { pageNumber: row.page_number }
        : {}),
      ...(applicableTo ? { applicableTo } : {}),
      owner: meta.owner || "Design Systems",
      createdAt: meta.createdAt || String(row.created_at || new Date().toISOString()),
      updatedAt: meta.updatedAt || String(row.created_at || new Date().toISOString()),
      ...(meta.publishedAt ? { publishedAt: meta.publishedAt } : {}),
      ...(meta.archivedAt ? { archivedAt: meta.archivedAt } : {}),
      ...(meta.publishIdempotencyKey ? { publishIdempotencyKey: meta.publishIdempotencyKey } : {}),
    };
  }

  async listBrands(organisationId?: string): Promise<WorkspaceBrandRecord[]> {
    const filter = organisationId
      ? `?organisation_id=eq.${encodeURIComponent(organisationId)}&select=*&order=created_at.desc`
      : `?select=*&order=created_at.desc`;
    const res = await callServerPostgrest<Array<Record<string, unknown>>>(
      `/rest/v1/brands${filter}`,
      { useServiceRole: true },
    );
    if (res.error) {
      throw new BrandKnowledgeRepositoryError(
        `Failed to list brands: ${res.error.message}`,
        res.error,
      );
    }

    const rows = Array.isArray(res.data) ? res.data : [];
    const mapped: WorkspaceBrandRecord[] = [];
    for (const row of rows) {
      const id = String(row.id);
      const entries = await this.listKnowledgeEntries({ brandId: id });
      mapped.push({
        brandId: id,
        organisationId: String(row.organisation_id),
        brandName: String(row.name || "Untitled Brand"),
        ...(typeof row.description === "string" && row.description
          ? { description: row.description }
          : {}),
        ...(typeof row.website === "string" && row.website
          ? { website: row.website }
          : {}),
        approved: Boolean(row.approved),
        ...(typeof row.profile === "string" && row.profile
          ? { profileSummary: row.profile }
          : {}),
        ...(typeof row.voice_and_tone === "string" && row.voice_and_tone
          ? { voiceAndToneSummary: row.voice_and_tone }
          : {}),
        ...(typeof row.version_id === "string" && row.version_id
          ? { latestPublishedVersion: row.version_id }
          : {}),
        publishedEntryCount: entries.filter((e) => e.publicationStatus === "published").length,
        draftEntryCount: entries.filter((e) => e.publicationStatus === "draft").length,
        archivedEntryCount: entries.filter((e) => e.publicationStatus === "archived").length,
        updatedAt: String(row.created_at || new Date().toISOString()),
      });
    }
    return mapped;
  }

  async getBrand(
    brandId: string,
    organisationId?: string,
  ): Promise<WorkspaceBrandRecord | null> {
    if (brandId === teraluneKnowledge.profile.brandId) {
      return {
        brandId,
        organisationId: teraluneKnowledge.profile.organisationId,
        brandName: "Teralune (Demo Sample)",
        description: teraluneKnowledge.profile.profile,
        approved: true,
        isSample: true,
        latestPublishedVersion: "1.0",
        publishedEntryCount: 1,
        draftEntryCount: 0,
        archivedEntryCount: 0,
        updatedAt: "2026-11-01T00:00:00.000Z",
      };
    }

    const row = await this.fetchBrandRow(brandId);
    if (!row) return null;
    const rowOrgId = String(row.organisation_id);
    if (organisationId && rowOrgId !== organisationId) {
      throw new CrossTenantBrandAccessError(brandId, organisationId);
    }
    const entries = await this.listKnowledgeEntries({ brandId, organisationId });
    return {
      brandId: String(row.id),
      organisationId: rowOrgId,
      brandName: String(row.name || "Untitled Brand"),
      ...(typeof row.description === "string" && row.description
        ? { description: row.description }
        : {}),
      ...(typeof row.website === "string" && row.website
        ? { website: row.website }
        : {}),
      approved: Boolean(row.approved),
      ...(typeof row.profile === "string" && row.profile
        ? { profileSummary: row.profile }
        : {}),
      ...(typeof row.voice_and_tone === "string" && row.voice_and_tone
        ? { voiceAndToneSummary: row.voice_and_tone }
        : {}),
      ...(typeof row.version_id === "string" && row.version_id
        ? { latestPublishedVersion: row.version_id }
        : {}),
      publishedEntryCount: entries.filter((e) => e.publicationStatus === "published").length,
      draftEntryCount: entries.filter((e) => e.publicationStatus === "draft").length,
      archivedEntryCount: entries.filter((e) => e.publicationStatus === "archived").length,
      updatedAt: String(row.created_at || new Date().toISOString()),
    };
  }

  async createBrand(
    input: CreateWorkspaceBrandInput,
  ): Promise<WorkspaceBrandRecord> {
    const brandId = input.brandId?.trim() || crypto.randomUUID();
    const res = await callServerPostgrest<Array<Record<string, unknown>>>(
      "/rest/v1/brands",
      {
        method: "POST",
        useServiceRole: true,
        body: {
          id: brandId,
          organisation_id: input.organisationId,
          name: input.brandName.trim(),
          description: input.description?.trim() || null,
          website: input.website?.trim() || null,
          approved: true,
          profile: input.profileSummary?.trim() || input.description?.trim() || `${input.brandName.trim()} brand governance profile.`,
          voice_and_tone: input.voiceAndToneSummary?.trim() || null,
          source_document_id: `brand-${brandId}`,
          source_title: `${input.brandName.trim()} Brand Profile`,
          version_id: "v0",
        },
      },
    );
    if (res.error || !res.data?.[0]) {
      throw new BrandKnowledgeRepositoryError(
        res.error?.message || "Failed to create brand.",
        res.error,
      );
    }
    const row = res.data[0];
    return {
      brandId: String(row.id),
      organisationId: String(row.organisation_id),
      brandName: String(row.name),
      ...(typeof row.description === "string" && row.description
        ? { description: row.description }
        : {}),
      approved: Boolean(row.approved),
      publishedEntryCount: 0,
      draftEntryCount: 0,
      archivedEntryCount: 0,
      updatedAt: String(row.created_at || new Date().toISOString()),
    };
  }

  async listKnowledgeEntries(query: {
    brandId: string;
    organisationId?: string;
    status?: PublicationStatus | "all";
  }): Promise<ManagedKnowledgeEntry[]> {
    const brandRow = await this.fetchBrandRow(query.brandId);
    if (!brandRow) return [];
    const orgId = String(brandRow.organisation_id);
    if (query.organisationId && orgId !== query.organisationId) {
      throw new CrossTenantBrandAccessError(query.brandId, query.organisationId);
    }

    const encodedBrand = encodeURIComponent(query.brandId);
    const [rulesRes, factsRes, assetsRes] = await Promise.all([
      callServerPostgrest<Array<Record<string, unknown>>>(
        `/rest/v1/brand_rules?brand_id=eq.${encodedBrand}&select=*&order=created_at.desc`,
        { useServiceRole: true },
      ),
      callServerPostgrest<Array<Record<string, unknown>>>(
        `/rest/v1/brand_facts?brand_id=eq.${encodedBrand}&select=*&order=created_at.desc`,
        { useServiceRole: true },
      ),
      callServerPostgrest<Array<Record<string, unknown>>>(
        `/rest/v1/assets?brand_id=eq.${encodedBrand}&select=*&order=created_at.desc`,
        { useServiceRole: true },
      ),
    ]);

    if (rulesRes.error || factsRes.error || assetsRes.error) {
      const err = rulesRes.error || factsRes.error || assetsRes.error;
      throw new BrandKnowledgeRepositoryError(
        `Failed to fetch brand knowledge entries: ${err?.message}`,
        err,
      );
    }

    const combined: ManagedKnowledgeEntry[] = [
      ...(rulesRes.data ?? []).map((r) => this.mapRuleRow(r, query.brandId, orgId)),
      ...(factsRes.data ?? []).map((f) => this.mapFactRow(f, query.brandId, orgId)),
      ...(assetsRes.data ?? [])
        .filter((a) => String(a.asset_category || "") !== "guideline_pdf")
        .map((a) => this.mapAssetRow(a, query.brandId, orgId)),
    ];

    if (!query.status || query.status === "all") {
      return combined;
    }
    return combined.filter((e) => e.publicationStatus === query.status);
  }

  async saveKnowledgeEntry(
    input: SaveManagedKnowledgeInput,
  ): Promise<ManagedKnowledgeEntry> {
    const brandRow = await this.fetchBrandRow(input.brandId);
    if (!brandRow) {
      throw new BrandKnowledgeRepositoryError(
        `Brand "${input.brandId}" does not exist.`,
      );
    }
    const orgId = String(brandRow.organisation_id);
    if (input.organisationId && orgId !== input.organisationId) {
      throw new CrossTenantBrandAccessError(input.brandId, input.organisationId);
    }

    const existingEntries = await this.listKnowledgeEntries({
      brandId: input.brandId,
      organisationId: orgId,
    });
    const existing = input.id
      ? existingEntries.find((e) => e.id === input.id)
      : undefined;

    if (input.publishIdempotencyKey) {
      const dup = existingEntries.find(
        (e) => e.publishIdempotencyKey === input.publishIdempotencyKey,
      );
      if (dup) {
        return dup;
      }
    }

    const now = new Date().toISOString();
    const publicationStatus: PublicationStatus = input.publicationStatus ?? "draft";
    const versionNumber = existing
      ? existing.publicationStatus === "published" ||
        existing.publicationStatus === "archived"
        ? existing.versionNumber + 1
        : existing.versionNumber
      : 1;
    const versionId = input.versionId?.trim() || `v${versionNumber}`;
    const entryId = existing?.id || input.id || crypto.randomUUID();
    const approved = publicationStatus === "published";

    const preservedExtractedText = existing?.extractedText ?? input.extractedText;
    const resolvedOrigin: EntryOrigin =
      existing?.entryOrigin ??
      input.entryOrigin ??
      (preservedExtractedText ? "guideline_pdf" : "manual");
    const resolvedDocVersion =
      input.sourceDocumentVersion?.trim() || existing?.sourceDocumentVersion;
    const resolvedProposalId =
      existing?.sourceProposalId ?? input.sourceProposalId?.trim();
    const resolvedStructuredFacts =
      input.structuredFacts ?? existing?.structuredFacts;

    const meta: IdentiqRowMeta = {
      publicationStatus,
      versionNumber,
      section: input.section,
      kind: input.kind ?? existing?.kind,
      entryOrigin: resolvedOrigin,
      ...(preservedExtractedText ? { extractedText: preservedExtractedText } : {}),
      ...(resolvedDocVersion ? { sourceDocumentVersion: resolvedDocVersion } : {}),
      ...(resolvedProposalId ? { sourceProposalId: resolvedProposalId } : {}),
      ...(resolvedStructuredFacts ? { structuredFacts: resolvedStructuredFacts } : {}),
      preferredTerm: input.preferredTerm?.trim() || undefined,
      avoidTerm: input.avoidTerm?.trim() || undefined,
      hexCodes: input.hexCodes,
      fontFamily: input.fontFamily?.trim() || undefined,
      severity: input.severity,
      owner: input.owner?.trim() || existing?.owner || "Brand Governance Lead",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      ...(approved ? { publishedAt: now } : {}),
      ...(input.publishIdempotencyKey
        ? { publishIdempotencyKey: input.publishIdempotencyKey }
        : existing?.publishIdempotencyKey
          ? { publishIdempotencyKey: existing.publishIdempotencyKey }
          : {}),
    };

    const applicablePayload = serializeApplicableAndMeta(
      input.applicableTo ?? existing?.applicableTo,
      meta,
    );
    const sourceDocumentId =
      input.sourceDocumentId?.trim() ||
      existing?.sourceDocumentId ||
      `src-${input.brandId.slice(0, 8)}-${entryId.slice(0, 8)}`;
    const sourceTitle =
      input.sourceTitle?.trim() ||
      existing?.sourceTitle ||
      `${String(brandRow.name || "Brand")} Knowledge Hub`;

    if (input.section === "visual") {
      const body = {
        id: entryId,
        brand_id: input.brandId,
        file_name: input.title.trim(),
        file_path: input.content.trim(),
        file_type: input.fontFamily ? "typography" : input.hexCodes?.length ? "colour" : "visual_rule",
        asset_category: "visual",
        approved,
        source_document_id: sourceDocumentId,
        source_title: sourceTitle,
        version_id: versionId,
        page_number: input.pageNumber ?? existing?.pageNumber ?? null,
        section: input.sectionRef ?? existing?.sectionRef ?? null,
        applicable_to: applicablePayload,
      };
      const path = existing
        ? `/rest/v1/assets?id=eq.${encodeURIComponent(entryId)}`
        : "/rest/v1/assets";
      const res = await callServerPostgrest<Array<Record<string, unknown>>>(path, {
        method: existing ? "PATCH" : "POST",
        useServiceRole: true,
        body,
      });
      if (res.error || !res.data?.[0]) {
        throw new BrandKnowledgeRepositoryError(
          res.error?.message || "Failed to save visual knowledge entry.",
          res.error,
        );
      }
      const saved = this.mapAssetRow(res.data[0], input.brandId, orgId);
      if (approved) {
        await this.recordVersionSnapshot(
          input.brandId,
          orgId,
          saved.owner,
          input.versionId?.trim(),
        );
      }
      return saved;
    }

    if (input.section === "facts" || input.section === "prohibited") {
      const body = {
        id: entryId,
        brand_id: input.brandId,
        fact_name: input.title.trim(),
        fact_value: input.content.trim(),
        category: input.section,
        source: sourceTitle,
        approved,
        source_document_id: sourceDocumentId,
        source_title: sourceTitle,
        version_id: versionId,
        page_number: input.pageNumber ?? null,
        section: input.sectionRef ?? input.section,
        applicable_to: applicablePayload,
        supporting_evidence: input.supportingEvidence?.trim() || sourceTitle,
        restrictions: input.restrictions ?? [],
      };
      const path = existing
        ? `/rest/v1/brand_facts?id=eq.${encodeURIComponent(entryId)}`
        : "/rest/v1/brand_facts";
      const res = await callServerPostgrest<Array<Record<string, unknown>>>(path, {
        method: existing ? "PATCH" : "POST",
        useServiceRole: true,
        body,
      });
      if (res.error || !res.data?.[0]) {
        throw new BrandKnowledgeRepositoryError(
          res.error?.message || "Failed to save brand fact/claim entry.",
          res.error,
        );
      }
      const saved = this.mapFactRow(res.data[0], input.brandId, orgId);
      if (approved) {
        await this.recordVersionSnapshot(
          input.brandId,
          orgId,
          saved.owner,
          input.versionId?.trim(),
        );
      }
      return saved;
    }

    const body = {
      id: entryId,
      brand_id: input.brandId,
      rule_name: input.title.trim(),
      category: input.section,
      description: input.content.trim(),
      severity: input.severity ?? "medium",
      approved,
      source_document_id: sourceDocumentId,
      source_title: sourceTitle,
      version_id: versionId,
      page_number: input.pageNumber ?? null,
      section: input.sectionRef ?? input.section,
      applicable_to: applicablePayload,
    };
    const path = existing
      ? `/rest/v1/brand_rules?id=eq.${encodeURIComponent(entryId)}`
      : "/rest/v1/brand_rules";
    const res = await callServerPostgrest<Array<Record<string, unknown>>>(path, {
      method: existing ? "PATCH" : "POST",
      useServiceRole: true,
      body,
    });
    if (res.error || !res.data?.[0]) {
      throw new BrandKnowledgeRepositoryError(
        res.error?.message || "Failed to save brand rule entry.",
        res.error,
      );
    }
      const saved = this.mapRuleRow(res.data[0], input.brandId, orgId);
    if (approved) {
      await this.recordVersionSnapshot(
        input.brandId,
        orgId,
        saved.owner,
        input.versionId?.trim(),
      );
    }
    return saved;
  }

  async publishKnowledgeEntry(input: {
    entryId: string;
    brandId: string;
    organisationId?: string;
    actor?: string;
    note?: string;
    publishIdempotencyKey?: string;
  }): Promise<{
    entry: ManagedKnowledgeEntry;
    snapshot: BrandVersionSnapshot;
  }> {
    const brandRow = await this.fetchBrandRow(input.brandId);
    if (!brandRow) {
      throw new BrandKnowledgeRepositoryError(
        `Brand "${input.brandId}" does not exist.`,
      );
    }
    const orgId = String(brandRow.organisation_id);
    if (input.organisationId && orgId !== input.organisationId) {
      throw new CrossTenantBrandAccessError(input.brandId, input.organisationId);
    }

    const [entries, existingSnapshots] = await Promise.all([
      this.listKnowledgeEntries({
        brandId: input.brandId,
        organisationId: orgId,
      }),
      this.listVersionSnapshots(input.brandId, orgId),
    ]);
    const current = entries.find((e) => e.id === input.entryId);
    if (!current) {
      throw new KnowledgeEntryNotFoundError(input.entryId, input.brandId);
    }

    const latestSnapshot = existingSnapshots[0];
    if (
      current.publicationStatus === "published" &&
      latestSnapshot &&
      ((input.publishIdempotencyKey &&
        current.publishIdempotencyKey === input.publishIdempotencyKey) ||
        latestSnapshot.entries.some(
          (se) =>
            se.id === current.id &&
            se.content === current.content &&
            se.title === current.title &&
            se.section === current.section,
        ))
    ) {
      return { entry: current, snapshot: latestSnapshot };
    }

    const now = new Date().toISOString();
    const meta: IdentiqRowMeta = {
      publicationStatus: "published",
      versionNumber: current.versionNumber,
      section: current.section,
      kind: current.kind,
      entryOrigin: current.entryOrigin,
      extractedText: current.extractedText,
      sourceDocumentVersion: current.sourceDocumentVersion,
      sourceProposalId: current.sourceProposalId,
      structuredFacts: current.structuredFacts,
      preferredTerm: current.preferredTerm,
      avoidTerm: current.avoidTerm,
      hexCodes: current.hexCodes,
      fontFamily: current.fontFamily,
      severity: current.severity,
      owner: current.owner,
      createdAt: current.createdAt || current.updatedAt,
      updatedAt: now,
      publishedAt: now,
      publishIdempotencyKey:
        input.publishIdempotencyKey ?? current.publishIdempotencyKey,
    };
    const applicablePayload = serializeApplicableAndMeta(
      current.applicableTo,
      meta,
    );

    const table =
      current.section === "visual"
        ? "assets"
        : current.section === "facts" || current.section === "prohibited"
          ? "brand_facts"
          : "brand_rules";

    const res = await callServerPostgrest<Array<Record<string, unknown>>>(
      `/rest/v1/${table}?id=eq.${encodeURIComponent(current.id)}`,
      {
        method: "PATCH",
        useServiceRole: true,
        body: {
          approved: true,
          applicable_to: applicablePayload,
        },
      },
    );
    if (res.error || !res.data?.[0]) {
      throw new BrandKnowledgeRepositoryError(
        res.error?.message || "Failed to publish knowledge entry.",
        res.error,
      );
    }

    const updatedEntry: ManagedKnowledgeEntry = {
      ...current,
      publicationStatus: "published",
      publishedAt: now,
      archivedAt: undefined,
      updatedAt: now,
      ...(input.publishIdempotencyKey
        ? { publishIdempotencyKey: input.publishIdempotencyKey }
        : {}),
    };

    const snapshot = await this.recordVersionSnapshot(
      input.brandId,
      orgId,
      input.actor || current.owner,
      undefined,
      input.note,
    );

    await callServerPostgrest(`/rest/v1/brands?id=eq.${encodeURIComponent(input.brandId)}`, {
      method: "PATCH",
      useServiceRole: true,
      body: { version_id: snapshot.versionId, approved: true },
    });

    return { entry: updatedEntry, snapshot };
  }

  async archiveKnowledgeEntry(input: {
    entryId: string;
    brandId: string;
    organisationId?: string;
  }): Promise<ManagedKnowledgeEntry> {
    const brandRow = await this.fetchBrandRow(input.brandId);
    if (!brandRow) {
      throw new BrandKnowledgeRepositoryError(
        `Brand "${input.brandId}" does not exist.`,
      );
    }
    const orgId = String(brandRow.organisation_id);
    if (input.organisationId && orgId !== input.organisationId) {
      throw new CrossTenantBrandAccessError(input.brandId, input.organisationId);
    }

    const entries = await this.listKnowledgeEntries({
      brandId: input.brandId,
      organisationId: orgId,
    });
    const current = entries.find((e) => e.id === input.entryId);
    if (!current) {
      throw new KnowledgeEntryNotFoundError(input.entryId, input.brandId);
    }

    const now = new Date().toISOString();
    const meta: IdentiqRowMeta = {
      publicationStatus: "archived",
      versionNumber: current.versionNumber,
      section: current.section,
      kind: current.kind,
      preferredTerm: current.preferredTerm,
      avoidTerm: current.avoidTerm,
      hexCodes: current.hexCodes,
      fontFamily: current.fontFamily,
      severity: current.severity,
      owner: current.owner,
      updatedAt: now,
      publishedAt: current.publishedAt,
      archivedAt: now,
    };
    const applicablePayload = serializeApplicableAndMeta(
      current.applicableTo,
      meta,
    );
    const table =
      current.section === "visual"
        ? "assets"
        : current.section === "facts" || current.section === "prohibited"
          ? "brand_facts"
          : "brand_rules";

    const res = await callServerPostgrest<Array<Record<string, unknown>>>(
      `/rest/v1/${table}?id=eq.${encodeURIComponent(current.id)}`,
      {
        method: "PATCH",
        useServiceRole: true,
        body: {
          approved: false,
          applicable_to: applicablePayload,
        },
      },
    );
    if (res.error || !res.data?.[0]) {
      throw new BrandKnowledgeRepositoryError(
        res.error?.message || "Failed to archive knowledge entry.",
        res.error,
      );
    }

    return {
      ...current,
      publicationStatus: "archived",
      archivedAt: now,
      updatedAt: now,
    };
  }

  async listVersionSnapshots(
    brandId: string,
    organisationId?: string,
  ): Promise<BrandVersionSnapshot[]> {
    const brandRow = await this.fetchBrandRow(brandId);
    if (!brandRow) return [];
    const orgId = String(brandRow.organisation_id);
    if (organisationId && orgId !== organisationId) {
      throw new CrossTenantBrandAccessError(brandId, organisationId);
    }

    const res = await callServerPostgrest<Array<Record<string, unknown>>>(
      `/rest/v1/audit_logs?brand_id=eq.${encodeURIComponent(brandId)}&action=eq.KNOWLEDGE_VERSION_SNAPSHOT&select=*&order=created_at.desc`,
      { useServiceRole: true },
    );
    if (res.error) {
      throw new BrandKnowledgeRepositoryError(
        `Failed to load knowledge snapshots: ${res.error.message}`,
        res.error,
      );
    }

    return (res.data ?? [])
      .map((row) => row.details as BrandVersionSnapshot | null)
      .filter((s): s is BrandVersionSnapshot => Boolean(s && s.versionId))
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async getBrandKnowledge(
    query: BrandContextQuery,
  ): Promise<BrandKnowledgeRecord | null> {
    if (query.brandId === teraluneKnowledge.profile.brandId) {
      return teraluneKnowledge;
    }

    const brand = await this.getBrand(query.brandId, query.organisationId);
    if (!brand || !brand.approved) {
      return null;
    }

    if (query.versionId) {
      const snapshots = await this.listVersionSnapshots(
        query.brandId,
        query.organisationId,
      );
      const snapshot = snapshots.find((s) => s.versionId === query.versionId);
      if (!snapshot) return null;
      return buildBrandKnowledgeRecordFromEntries(brand, snapshot.entries, {
        allowSnapshotEntries: true,
        overrideVersionId: snapshot.versionId,
      });
    }

    const entries = await this.listKnowledgeEntries({
      brandId: query.brandId,
      organisationId: query.organisationId,
      status: "published",
    });

    return buildBrandKnowledgeRecordFromEntries(brand, entries);
  }

  private async recordVersionSnapshot(
    brandId: string,
    organisationId: string,
    publishedBy: string,
    explicitVersionId?: string,
    note?: string,
  ): Promise<BrandVersionSnapshot> {
    const existingSnapshots = await this.listVersionSnapshots(brandId, organisationId);
    const maxVersion = existingSnapshots.reduce(
      (max, snap) => Math.max(max, snap.versionNumber),
      0,
    );
    const versionNumber = maxVersion + 1;
    const versionId = explicitVersionId || `v${versionNumber}`;
    const publishedEntries = await this.listKnowledgeEntries({
      brandId,
      organisationId,
      status: "published",
    });

    const snapshot: BrandVersionSnapshot = {
      snapshotId: crypto.randomUUID(),
      brandId,
      organisationId,
      versionId,
      versionNumber,
      publishedAt: new Date().toISOString(),
      publishedBy,
      ...(note?.trim() ? { note: note.trim() } : {}),
      entries: publishedEntries,
    };

    const res = await callServerPostgrest("/rest/v1/audit_logs", {
      method: "POST",
      useServiceRole: true,
      body: {
        id: snapshot.snapshotId,
        brand_id: brandId,
        action: "KNOWLEDGE_VERSION_SNAPSHOT",
        entity_type: "brand_knowledge_version",
        details: snapshot,
      },
    });
    if (res.error) {
      throw new BrandKnowledgeRepositoryError(
        `Failed to record knowledge version snapshot: ${res.error.message}`,
        res.error,
      );
    }

    return snapshot;
  }
}
