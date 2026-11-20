import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildBrandKnowledgeRecordFromEntries,
  buildTeraluneSampleSeed,
} from "./knowledge-mapper";
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
  ManagedKnowledgeEntry,
  PublicationStatus,
  WorkspaceBrandRecord,
} from "./types";

interface PersistedKnowledgeStore {
  schemaVersion: number;
  brands: WorkspaceBrandRecord[];
  entries: ManagedKnowledgeEntry[];
  snapshots: BrandVersionSnapshot[];
}

const DEFAULT_STORE_PATH = path.join(
  process.cwd(),
  ".identiq-data",
  "brand-knowledge-store.json",
);

const writeQueues = new Map<string, Promise<unknown>>();

function serializeWrite<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  writeQueues.set(
    key,
    next.finally(() => {
      if (writeQueues.get(key) === next) {
        writeQueues.delete(key);
      }
    }),
  );
  return next;
}

function createInitialStore(): PersistedKnowledgeStore {
  const teraluneSeed = buildTeraluneSampleSeed();
  const snapshot: BrandVersionSnapshot = {
    snapshotId: "snap-teralune-v1",
    brandId: teraluneSeed.brand.brandId,
    organisationId: teraluneSeed.brand.organisationId,
    versionId: "1.0",
    versionNumber: 1,
    publishedAt: "2026-11-01T00:00:00.000Z",
    publishedBy: "Teralune Governance Fixture",
    note: "Initial sample guideline fixture",
    entries: teraluneSeed.entries,
  };
  return {
    schemaVersion: 1,
    brands: [teraluneSeed.brand],
    entries: teraluneSeed.entries,
    snapshots: [snapshot],
  };
}

function recomputeBrandCounters(
  brand: WorkspaceBrandRecord,
  entries: ManagedKnowledgeEntry[],
  snapshots: BrandVersionSnapshot[],
): WorkspaceBrandRecord {
  const brandEntries = entries.filter((e) => e.brandId === brand.brandId);
  const brandSnapshots = snapshots
    .filter((s) => s.brandId === brand.brandId)
    .sort((a, b) => b.versionNumber - a.versionNumber);

  const publishedEntryCount = brandEntries.filter(
    (e) => e.publicationStatus === "published",
  ).length;
  const draftEntryCount = brandEntries.filter(
    (e) => e.publicationStatus === "draft",
  ).length;
  const archivedEntryCount = brandEntries.filter(
    (e) => e.publicationStatus === "archived",
  ).length;

  return {
    ...brand,
    latestPublishedVersion:
      brandSnapshots[0]?.versionId ??
      brandEntries.find((e) => e.publicationStatus === "published")?.versionId ??
      brand.latestPublishedVersion,
    publishedEntryCount,
    draftEntryCount,
    archivedEntryCount,
    updatedAt: new Date().toISOString(),
  };
}

export class FileBackedBrandKnowledgeRepository
  implements MultiBrandKnowledgeRepository
{
  private readonly storePath: string;
  private readonly seedTeralune: boolean;

  constructor(options: { storePath?: string; seedTeralune?: boolean } = {}) {
    this.storePath =
      options.storePath ||
      process.env.IDENTIQ_KNOWLEDGE_STORE_PATH ||
      DEFAULT_STORE_PATH;
    this.seedTeralune = options.seedTeralune ?? true;
  }

  private readStore(): PersistedKnowledgeStore {
    try {
      if (!fs.existsSync(this.storePath)) {
        const initial = this.seedTeralune
          ? createInitialStore()
          : { schemaVersion: 1, brands: [], entries: [], snapshots: [] };
        this.writeStoreSync(initial);
        return initial;
      }
      const raw = fs.readFileSync(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedKnowledgeStore;
      return {
        schemaVersion: parsed.schemaVersion ?? 1,
        brands: Array.isArray(parsed.brands) ? parsed.brands : [],
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      };
    } catch (error) {
      throw new BrandKnowledgeRepositoryError(
        "Failed to read brand knowledge store.",
        error,
      );
    }
  }

  private writeStoreSync(store: PersistedKnowledgeStore): void {
    try {
      const dir = path.dirname(this.storePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf8");
      fs.renameSync(tmpPath, this.storePath);
    } catch (error) {
      throw new BrandKnowledgeRepositoryError(
        "Failed to persist brand knowledge store.",
        error,
      );
    }
  }

  async listBrands(organisationId?: string): Promise<WorkspaceBrandRecord[]> {
    const store = this.readStore();
    return store.brands.filter(
      (b) => !organisationId || b.organisationId === organisationId || b.isSample,
    );
  }

  async getBrand(
    brandId: string,
    organisationId?: string,
  ): Promise<WorkspaceBrandRecord | null> {
    const store = this.readStore();
    const brand = store.brands.find((b) => b.brandId === brandId);
    if (!brand) return null;
    if (
      organisationId &&
      !brand.isSample &&
      brand.organisationId !== organisationId
    ) {
      throw new CrossTenantBrandAccessError(brandId, organisationId);
    }
    return brand;
  }

  async createBrand(
    input: CreateWorkspaceBrandInput,
  ): Promise<WorkspaceBrandRecord> {
    return serializeWrite(this.storePath, async () => {
      const store = this.readStore();
      const brandName = input.brandName.trim();
      if (!brandName) {
        throw new BrandKnowledgeRepositoryError("Brand name is required.");
      }
      const brandId = input.brandId?.trim() || `brand-${crypto.randomUUID()}`;
      if (store.brands.some((b) => b.brandId === brandId)) {
        throw new BrandKnowledgeRepositoryError(
          `Brand "${brandId}" already exists.`,
        );
      }

      const now = new Date().toISOString();
      const brand: WorkspaceBrandRecord = {
        brandId,
        organisationId: input.organisationId.trim() || "local-org",
        brandName,
        ...(input.description?.trim()
          ? { description: input.description.trim() }
          : {}),
        ...(input.website?.trim() ? { website: input.website.trim() } : {}),
        approved: true,
        ...(input.isSample ? { isSample: true } : {}),
        ...(input.profileSummary?.trim()
          ? { profileSummary: input.profileSummary.trim() }
          : {}),
        ...(input.voiceAndToneSummary?.trim()
          ? { voiceAndToneSummary: input.voiceAndToneSummary.trim() }
          : {}),
        publishedEntryCount: 0,
        draftEntryCount: 0,
        archivedEntryCount: 0,
        updatedAt: now,
      };

      store.brands = [brand, ...store.brands];
      this.writeStoreSync(store);
      return brand;
    });
  }

  async listKnowledgeEntries(query: {
    brandId: string;
    organisationId?: string;
    status?: PublicationStatus | "all";
  }): Promise<ManagedKnowledgeEntry[]> {
    const store = this.readStore();
    const brand = store.brands.find((b) => b.brandId === query.brandId);
    if (!brand) return [];
    if (
      query.organisationId &&
      !brand.isSample &&
      brand.organisationId !== query.organisationId
    ) {
      throw new CrossTenantBrandAccessError(
        query.brandId,
        query.organisationId,
      );
    }
    return store.entries.filter(
      (entry) =>
        entry.brandId === query.brandId &&
        (!query.status ||
          query.status === "all" ||
          entry.publicationStatus === query.status),
    );
  }

  async saveKnowledgeEntry(
    input: SaveManagedKnowledgeInput,
  ): Promise<ManagedKnowledgeEntry> {
    return serializeWrite(this.storePath, async () => {
      const store = this.readStore();
      const brandIndex = store.brands.findIndex(
        (b) => b.brandId === input.brandId,
      );
      if (brandIndex === -1) {
        throw new BrandKnowledgeRepositoryError(
          `Brand "${input.brandId}" does not exist.`,
        );
      }
      const brand = store.brands[brandIndex]!;
      if (
        input.organisationId &&
        !brand.isSample &&
        brand.organisationId !== input.organisationId
      ) {
        throw new CrossTenantBrandAccessError(
          input.brandId,
          input.organisationId,
        );
      }

      const now = new Date().toISOString();
      const existingIndex = input.id
        ? store.entries.findIndex(
            (e) => e.id === input.id && e.brandId === input.brandId,
          )
        : -1;
      const existing = existingIndex >= 0 ? store.entries[existingIndex] : undefined;

      const requestedStatus: PublicationStatus =
        input.publicationStatus ?? "draft";
      const nextVersionNumber = existing
        ? existing.publicationStatus === "published" ||
          existing.publicationStatus === "archived"
          ? existing.versionNumber + 1
          : existing.versionNumber
        : 1;
      const nextVersionId =
        input.versionId?.trim() || `v${nextVersionNumber}`;

      const entryId = existing?.id || input.id?.trim() || `kb-${crypto.randomUUID()}`;
      const cleanHexCodes = input.hexCodes
        ?.map((h) => h.trim().toUpperCase())
        .filter((h) => /^#[0-9A-F]{6}$/.test(h));

      const nextEntry: ManagedKnowledgeEntry = {
        id: entryId,
        brandId: brand.brandId,
        organisationId: brand.organisationId,
        section: input.section,
        ...(input.kind ? { kind: input.kind } : existing?.kind ? { kind: existing.kind } : {}),
        title: input.title.trim(),
        content: input.content.trim(),
        ...(input.preferredTerm?.trim()
          ? { preferredTerm: input.preferredTerm.trim() }
          : {}),
        ...(input.avoidTerm?.trim() ? { avoidTerm: input.avoidTerm.trim() } : {}),
        ...(cleanHexCodes && cleanHexCodes.length > 0
          ? { hexCodes: cleanHexCodes }
          : {}),
        ...(input.fontFamily?.trim()
          ? { fontFamily: input.fontFamily.trim() }
          : {}),
        ...(input.supportingEvidence?.trim()
          ? { supportingEvidence: input.supportingEvidence.trim() }
          : {}),
        ...(input.restrictions && input.restrictions.length > 0
          ? { restrictions: input.restrictions }
          : {}),
        ...(input.severity ? { severity: input.severity } : {}),
        publicationStatus: requestedStatus,
        versionNumber: nextVersionNumber,
        versionId: nextVersionId,
        sourceDocumentId:
          input.sourceDocumentId?.trim() ||
          existing?.sourceDocumentId ||
          `src-${brand.brandId}-${entryId.slice(0, 8)}`,
        sourceTitle:
          input.sourceTitle?.trim() ||
          existing?.sourceTitle ||
          `${brand.brandName} Knowledge Hub`,
        ...(input.sectionRef?.trim()
          ? { sectionRef: input.sectionRef.trim() }
          : { sectionRef: input.section }),
        ...(input.pageNumber ? { pageNumber: input.pageNumber } : {}),
        ...(input.applicableTo ? { applicableTo: input.applicableTo } : {}),
        owner: input.owner?.trim() || existing?.owner || "Brand Governance Lead",
        updatedAt: now,
        ...(requestedStatus === "published" ? { publishedAt: now } : {}),
      };

      if (existingIndex >= 0) {
        store.entries[existingIndex] = nextEntry;
      } else {
        store.entries = [nextEntry, ...store.entries];
      }

      if (requestedStatus === "published") {
        const snapshot = this.createSnapshotForBrand(
          brand,
          store.entries,
          store.snapshots,
          nextEntry.owner,
          input.versionId?.trim(),
        );
        store.snapshots = [snapshot, ...store.snapshots];
      }

      store.brands[brandIndex] = recomputeBrandCounters(
        brand,
        store.entries,
        store.snapshots,
      );
      this.writeStoreSync(store);
      return nextEntry;
    });
  }

  async publishKnowledgeEntry(input: {
    entryId: string;
    brandId: string;
    organisationId?: string;
    actor?: string;
    note?: string;
  }): Promise<{
    entry: ManagedKnowledgeEntry;
    snapshot: BrandVersionSnapshot;
  }> {
    return serializeWrite(this.storePath, async () => {
      const store = this.readStore();
      const brandIndex = store.brands.findIndex(
        (b) => b.brandId === input.brandId,
      );
      if (brandIndex === -1) {
        throw new BrandKnowledgeRepositoryError(
          `Brand "${input.brandId}" does not exist.`,
        );
      }
      const brand = store.brands[brandIndex]!;
      if (
        input.organisationId &&
        !brand.isSample &&
        brand.organisationId !== input.organisationId
      ) {
        throw new CrossTenantBrandAccessError(
          input.brandId,
          input.organisationId,
        );
      }

      const idx = store.entries.findIndex(
        (e) => e.id === input.entryId && e.brandId === input.brandId,
      );
      if (idx === -1) {
        throw new KnowledgeEntryNotFoundError(input.entryId, input.brandId);
      }

      const now = new Date().toISOString();
      const current = store.entries[idx]!;
      const publishedEntry: ManagedKnowledgeEntry = {
        ...current,
        publicationStatus: "published",
        publishedAt: now,
        archivedAt: undefined,
        updatedAt: now,
      };
      store.entries[idx] = publishedEntry;

      const snapshot = this.createSnapshotForBrand(
        brand,
        store.entries,
        store.snapshots,
        input.actor || publishedEntry.owner,
        undefined,
        input.note,
      );
      store.snapshots = [snapshot, ...store.snapshots];
      store.brands[brandIndex] = recomputeBrandCounters(
        brand,
        store.entries,
        store.snapshots,
      );

      this.writeStoreSync(store);
      return { entry: publishedEntry, snapshot };
    });
  }

  async archiveKnowledgeEntry(input: {
    entryId: string;
    brandId: string;
    organisationId?: string;
    actor?: string;
  }): Promise<ManagedKnowledgeEntry> {
    return serializeWrite(this.storePath, async () => {
      const store = this.readStore();
      const brandIndex = store.brands.findIndex(
        (b) => b.brandId === input.brandId,
      );
      if (brandIndex === -1) {
        throw new BrandKnowledgeRepositoryError(
          `Brand "${input.brandId}" does not exist.`,
        );
      }
      const brand = store.brands[brandIndex]!;
      if (
        input.organisationId &&
        !brand.isSample &&
        brand.organisationId !== input.organisationId
      ) {
        throw new CrossTenantBrandAccessError(
          input.brandId,
          input.organisationId,
        );
      }

      const idx = store.entries.findIndex(
        (e) => e.id === input.entryId && e.brandId === input.brandId,
      );
      if (idx === -1) {
        throw new KnowledgeEntryNotFoundError(input.entryId, input.brandId);
      }

      const now = new Date().toISOString();
      const archivedEntry: ManagedKnowledgeEntry = {
        ...store.entries[idx]!,
        publicationStatus: "archived",
        archivedAt: now,
        updatedAt: now,
      };
      store.entries[idx] = archivedEntry;
      store.brands[brandIndex] = recomputeBrandCounters(
        brand,
        store.entries,
        store.snapshots,
      );

      this.writeStoreSync(store);
      return archivedEntry;
    });
  }

  async listVersionSnapshots(
    brandId: string,
    organisationId?: string,
  ): Promise<BrandVersionSnapshot[]> {
    const store = this.readStore();
    const brand = store.brands.find((b) => b.brandId === brandId);
    if (!brand) return [];
    if (
      organisationId &&
      !brand.isSample &&
      brand.organisationId !== organisationId
    ) {
      throw new CrossTenantBrandAccessError(brandId, organisationId);
    }
    return store.snapshots
      .filter((s) => s.brandId === brandId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async getBrandKnowledge(
    query: BrandContextQuery,
  ): Promise<BrandKnowledgeRecord | null> {
    const store = this.readStore();
    const brand = store.brands.find((b) => b.brandId === query.brandId);
    if (!brand) {
      return null;
    }
    if (
      query.organisationId &&
      !brand.isSample &&
      brand.organisationId !== query.organisationId
    ) {
      throw new CrossTenantBrandAccessError(
        query.brandId,
        query.organisationId,
      );
    }
    if (!brand.approved) {
      return null;
    }

    if (query.versionId) {
      const snapshot = store.snapshots.find(
        (s) => s.brandId === brand.brandId && s.versionId === query.versionId,
      );
      if (!snapshot) {
        return null;
      }
      if (
        brand.brandId === teraluneKnowledge.profile.brandId &&
        query.versionId === "1.0"
      ) {
        return teraluneKnowledge;
      }
      return buildBrandKnowledgeRecordFromEntries(brand, snapshot.entries, {
        allowSnapshotEntries: true,
        overrideVersionId: snapshot.versionId,
      });
    }

    const brandEntries = store.entries.filter((e) => e.brandId === brand.brandId);
    if (brand.brandId === teraluneKnowledge.profile.brandId) {
      const seed = buildTeraluneSampleSeed();
      const unmodified =
        brandEntries.length === seed.entries.length &&
        brandEntries.every(
          (e) =>
            e.id.startsWith("teralune-") && e.publicationStatus === "published",
        );
      if (unmodified) {
        return teraluneKnowledge;
      }
    }

    return buildBrandKnowledgeRecordFromEntries(brand, brandEntries);
  }

  private createSnapshotForBrand(
    brand: WorkspaceBrandRecord,
    entries: ManagedKnowledgeEntry[],
    existingSnapshots: BrandVersionSnapshot[],
    publishedBy: string,
    explicitVersionId?: string,
    note?: string,
  ): BrandVersionSnapshot {
    const brandSnapshots = existingSnapshots.filter(
      (s) => s.brandId === brand.brandId,
    );
    const maxVersion = brandSnapshots.reduce(
      (max, snap) => Math.max(max, snap.versionNumber),
      0,
    );
    const versionNumber = maxVersion + 1;
    const versionId = explicitVersionId || `v${versionNumber}`;
    const publishedEntries = entries.filter(
      (e) => e.brandId === brand.brandId && e.publicationStatus === "published",
    );
    return {
      snapshotId: `snap-${crypto.randomUUID()}`,
      brandId: brand.brandId,
      organisationId: brand.organisationId,
      versionId,
      versionNumber,
      publishedAt: new Date().toISOString(),
      publishedBy,
      ...(note?.trim() ? { note: note.trim() } : {}),
      entries: publishedEntries,
    };
  }
}
