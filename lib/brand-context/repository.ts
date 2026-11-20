import type {
  BrandContextQuery,
  BrandKnowledgeRecord,
  BrandVersionSnapshot,
  ManagedKnowledgeEntry,
  ManagedKnowledgeSection,
  PublicationStatus,
  WorkspaceBrandRecord,
} from "./types";

export interface BrandKnowledgeRepository {
  getBrandKnowledge(
    query: BrandContextQuery,
  ): Promise<BrandKnowledgeRecord | null>;
}

export interface CreateWorkspaceBrandInput {
  brandId?: string;
  organisationId: string;
  brandName: string;
  description?: string;
  website?: string;
  profileSummary?: string;
  voiceAndToneSummary?: string;
  isSample?: boolean;
}

export interface SaveManagedKnowledgeInput {
  id?: string;
  brandId: string;
  organisationId?: string;
  section: ManagedKnowledgeSection;
  kind?: string;
  title: string;
  content: string;
  preferredTerm?: string;
  avoidTerm?: string;
  hexCodes?: string[];
  fontFamily?: string;
  supportingEvidence?: string;
  restrictions?: string[];
  severity?: "high" | "medium" | "low";
  publicationStatus?: "draft" | "published";
  sourceDocumentId?: string;
  sourceTitle?: string;
  sectionRef?: string;
  pageNumber?: number;
  applicableTo?: {
    submissionIds?: string[];
    contentPlatforms?: string[];
  };
  owner?: string;
  versionId?: string;
}

export interface MultiBrandKnowledgeRepository extends BrandKnowledgeRepository {
  listBrands(organisationId?: string): Promise<WorkspaceBrandRecord[]>;
  getBrand(
    brandId: string,
    organisationId?: string,
  ): Promise<WorkspaceBrandRecord | null>;
  createBrand(input: CreateWorkspaceBrandInput): Promise<WorkspaceBrandRecord>;
  listKnowledgeEntries(query: {
    brandId: string;
    organisationId?: string;
    status?: PublicationStatus | "all";
  }): Promise<ManagedKnowledgeEntry[]>;
  saveKnowledgeEntry(
    input: SaveManagedKnowledgeInput,
  ): Promise<ManagedKnowledgeEntry>;
  publishKnowledgeEntry(input: {
    entryId: string;
    brandId: string;
    organisationId?: string;
    actor?: string;
    note?: string;
  }): Promise<{
    entry: ManagedKnowledgeEntry;
    snapshot: BrandVersionSnapshot;
  }>;
  archiveKnowledgeEntry(input: {
    entryId: string;
    brandId: string;
    organisationId?: string;
    actor?: string;
  }): Promise<ManagedKnowledgeEntry>;
  listVersionSnapshots(
    brandId: string,
    organisationId?: string,
  ): Promise<BrandVersionSnapshot[]>;
}

export class BrandKnowledgeRepositoryError extends Error {
  public readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "BrandKnowledgeRepositoryError";
    this.cause = cause;
  }
}

export class CrossTenantBrandAccessError extends BrandKnowledgeRepositoryError {
  constructor(brandId: string, organisationId: string) {
    super(
      `Brand "${brandId}" does not belong to organisation "${organisationId}".`,
    );
    this.name = "CrossTenantBrandAccessError";
  }
}

export class KnowledgeEntryNotFoundError extends BrandKnowledgeRepositoryError {
  constructor(entryId: string, brandId: string) {
    super(`Knowledge entry "${entryId}" was not found for brand "${brandId}".`);
    this.name = "KnowledgeEntryNotFoundError";
  }
}
