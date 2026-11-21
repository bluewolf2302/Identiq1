import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LATEST_KNOWLEDGE_VERSION_ID,
  countEntriesBySection,
  deriveKnowledgeCounts,
  filterKnowledgeEntries,
  getEntryPublicationStatus,
  resolveDisplayedKnowledgeEntries,
} from "../lib/knowledge-versions";
import {
  MAX_ASSET_FILE_SIZE_BYTES,
  getAssetPersistenceNotice,
  validateAssetSubmission,
  validateAssetUploadFile,
} from "../lib/asset-validation";
import {
  buildKnowledgeHubHref,
  buildNewReviewHref,
  resolveNewReviewBrandAndVersion,
} from "../lib/workspace-navigation";
import type {
  KnowledgeEntry,
  KnowledgeVersionSnapshot,
  WorkspaceBrand,
} from "../lib/types";

function makeEntry(overrides: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: overrides.id ?? "entry-1",
    brandId: overrides.brandId ?? "brand-1",
    organisationId: overrides.organisationId ?? "org-1",
    section: overrides.section ?? "guidelines",
    title: overrides.title ?? "Sample Rule",
    content: overrides.content ?? "Always keep copy concise.",
    status: overrides.status ?? "Approved",
    publicationStatus: overrides.publicationStatus ?? "published",
    updatedAt: overrides.updatedAt ?? "2026-11-20",
    owner: overrides.owner ?? "Brand Governance Team",
    ...overrides,
  };
}

describe("Phase 4 Knowledge Hub Versioning & Filtering", () => {
  it("resolves live entries for 'latest' and immutable snapshot entries for historical versions", () => {
    const liveEntries: KnowledgeEntry[] = [
      makeEntry({
        id: "live-1",
        title: "Live Draft Rule",
        status: "Pending Review",
        publicationStatus: "draft",
      }),
      makeEntry({
        id: "live-2",
        title: "Live Published Rule",
        status: "Approved",
        publicationStatus: "published",
      }),
    ];

    const v1Entries: KnowledgeEntry[] = [
      makeEntry({ id: "snap-1", title: "Historical V1 Rule", versionId: "v1" }),
    ];

    const snapshots: KnowledgeVersionSnapshot[] = [
      {
        snapshotId: "snap-v1",
        versionId: "v1",
        versionNumber: 1,
        brandId: "brand-1",
        organisationId: "org-1",
        publishedAt: "2026-11-18T10:00:00Z",
        publishedBy: "Harsh",
        entryCount: 1,
        entries: v1Entries,
      },
    ];

    const liveView = resolveDisplayedKnowledgeEntries({
      liveEntries,
      snapshots,
      selectedVersionId: LATEST_KNOWLEDGE_VERSION_ID,
    });
    assert.equal(liveView.isHistoricalView, false);
    assert.equal(liveView.activeSnapshot, null);
    assert.equal(liveView.entries.length, 2);

    const historicalView = resolveDisplayedKnowledgeEntries({
      liveEntries,
      snapshots,
      selectedVersionId: "v1",
    });
    assert.equal(historicalView.isHistoricalView, true);
    assert.equal(historicalView.activeSnapshot?.versionId, "v1");
    assert.equal(historicalView.entries.length, 1);
    assert.equal(historicalView.entries[0]?.title, "Historical V1 Rule");
  });

  it("derives publication counts cleanly across draft, published, and archived states", () => {
    const entries: KnowledgeEntry[] = [
      makeEntry({ id: "e1", status: "Approved", publicationStatus: "published" }),
      makeEntry({ id: "e2", status: "Pending Review", publicationStatus: "draft" }),
      makeEntry({ id: "e3", status: "Archived", publicationStatus: "archived" }),
      makeEntry({ id: "e4", status: "Approved", publicationStatus: undefined }),
    ];

    assert.equal(getEntryPublicationStatus(entries[3]!), "published");
    const counts = deriveKnowledgeCounts(entries);
    assert.deepEqual(counts, {
      total: 4,
      published: 2,
      draft: 1,
      archived: 1,
    });
  });

  it("filters entries by section, publication status, search text, and source document provenance", () => {
    const entries: KnowledgeEntry[] = [
      makeEntry({
        id: "e1",
        section: "terminology",
        title: "Preferred Product Name",
        preferredTerm: "Teralune Sparkling",
        publicationStatus: "published",
        sourceDocumentId: "doc-1",
        pageNumber: 2,
      }),
      makeEntry({
        id: "e2",
        section: "terminology",
        title: "Deprecated Tagline",
        avoidTerm: "Zero Sugar Magic",
        status: "Pending Review",
        publicationStatus: "draft",
        sourceDocumentId: "doc-1",
        pageNumber: 4,
      }),
      makeEntry({
        id: "e3",
        section: "visual",
        title: "Primary Accent Hex",
        content: "Use #FF6B5A strictly for hero highlights.",
        publicationStatus: "published",
      }),
    ];

    const sectionCounts = countEntriesBySection(entries);
    assert.equal(sectionCounts.terminology, 2);
    assert.equal(sectionCounts.visual, 1);
    assert.equal(sectionCounts.policies, 0);

    const draftOnly = filterKnowledgeEntries({
      entries,
      activeSection: "terminology",
      statusFilter: "Draft",
      searchQuery: "",
    });
    assert.equal(draftOnly.length, 1);
    assert.equal(draftOnly[0]?.id, "e2");

    const bySourcePage = filterKnowledgeEntries({
      entries,
      activeSection: "guidelines",
      statusFilter: "All",
      searchQuery: "",
      sourceDocFilter: "doc-1",
      sourcePageFilter: 2,
    });
    assert.equal(bySourcePage.length, 1);
    assert.equal(bySourcePage[0]?.id, "e1");
  });
});

describe("Phase 4 Asset Library Validation & Honest Persistence Notice", () => {
  it("accepts valid image files within size limits and rejects invalid/oversized/empty files", () => {
    const validPng = validateAssetUploadFile({
      name: "brand-logo.PNG",
      size: 2048,
      type: "image/png",
    });
    assert.equal(validPng.valid, true);
    assert.equal(validPng.format, "PNG");

    const validJpeg = validateAssetUploadFile({
      name: "hero.jpeg",
      size: 500_000,
      type: "image/jpeg",
    });
    assert.equal(validJpeg.valid, true);
    assert.equal(validJpeg.format, "JPG");

    const invalidPdf = validateAssetUploadFile({
      name: "guidelines.pdf",
      size: 1024,
      type: "application/pdf",
    });
    assert.equal(invalidPdf.valid, false);
    assert.match(invalidPdf.error || "", /Unsupported file format/);

    const emptyFile = validateAssetUploadFile({
      name: "empty.png",
      size: 0,
      type: "image/png",
    });
    assert.equal(emptyFile.valid, false);
    assert.match(emptyFile.error || "", /0 bytes/);

    const oversized = validateAssetUploadFile({
      name: "huge.webp",
      size: MAX_ASSET_FILE_SIZE_BYTES + 1,
      type: "image/webp",
    });
    assert.equal(oversized.valid, false);
    assert.match(oversized.error || "", /exceeds the 5\.00 MB limit/);
  });

  it("validates asset submissions cleanly and distinguishes persistence modes honestly", () => {
    assert.equal(
      validateAssetSubmission({ name: " ", hasFileOrPreview: true }).valid,
      false,
    );
    assert.equal(
      validateAssetSubmission({ name: "Brand Icon", hasFileOrPreview: false }).valid,
      false,
    );
    assert.deepEqual(
      validateAssetSubmission({ name: "  Brand Icon  ", hasFileOrPreview: true }),
      { valid: true, normalizedName: "Brand Icon" },
    );

    const authNotice = getAssetPersistenceNotice("AUTHENTICATED_SUPABASE");
    assert.equal(authNotice.scope, "session_only");
    assert.match(authNotice.label, /Not Cloud-Synced/);

    const localNotice = getAssetPersistenceNotice("DEMO_LOCAL");
    assert.equal(localNotice.scope, "local_browser");
    assert.match(localNotice.label, /Saved Locally/);
  });
});

describe("Phase 4 Cross-Page Brand & Version Review Handoff", () => {
  const brands: WorkspaceBrand[] = [
    {
      brandId: "brand-alpha",
      organisationId: "org-1",
      brandName: "Alpha Brand",
      approved: true,
      publishedEntryCount: 5,
      draftEntryCount: 1,
      archivedEntryCount: 0,
      latestPublishedVersion: "v2",
      updatedAt: "2026-11-20T09:00:00Z",
    },
    {
      brandId: "brand-beta",
      organisationId: "org-1",
      brandName: "Beta Brand",
      approved: true,
      publishedEntryCount: 2,
      draftEntryCount: 0,
      archivedEntryCount: 0,
      latestPublishedVersion: "v1",
      updatedAt: "2026-11-20T09:00:00Z",
    },
  ];

  const snapshots: KnowledgeVersionSnapshot[] = [
    {
      snapshotId: "snap-beta-v1",
      versionId: "v1",
      versionNumber: 1,
      brandId: "brand-beta",
      organisationId: "org-1",
      publishedAt: "2026-11-15T09:00:00Z",
      publishedBy: "Harsh",
      entryCount: 2,
    },
  ];

  it("builds /reviews/new and /knowledge-hub links preserving brand and historical snapshot version", () => {
    assert.equal(
      buildNewReviewHref({ brandId: "brand-beta", brandVersionId: "latest" }),
      "/reviews/new?brandId=brand-beta",
    );
    assert.equal(
      buildNewReviewHref({ brandId: "brand-beta", brandVersionId: "v1" }),
      "/reviews/new?brandId=brand-beta&brandVersionId=v1",
    );
    assert.equal(
      buildKnowledgeHubHref({ brandId: "brand-beta", sourceDocId: "doc-9", page: 3 }),
      "/knowledge-hub?brandId=brand-beta&sourceDocId=doc-9&page=3",
    );
  });

  it("resolves matching query params and emits non-blocking fallback warnings for missing brands/versions", () => {
    const matched = resolveNewReviewBrandAndVersion({
      requestedBrandId: "brand-beta",
      requestedVersionId: "v1",
      selectedBrandId: "brand-alpha",
      workspaceBrands: brands,
      snapshots,
    });
    assert.equal(matched.activeBrandId, "brand-beta");
    assert.equal(matched.effectiveVersionId, "v1");
    assert.equal(matched.queryBrandWarning, null);
    assert.equal(matched.queryVersionWarning, null);

    const missing = resolveNewReviewBrandAndVersion({
      requestedBrandId: "unknown-brand",
      requestedVersionId: "v99",
      selectedBrandId: "brand-alpha",
      workspaceBrands: brands,
      snapshots,
    });
    assert.equal(missing.activeBrandId, "brand-alpha");
    assert.equal(missing.effectiveVersionId, LATEST_KNOWLEDGE_VERSION_ID);
    assert.match(missing.queryBrandWarning || "", /not found/);
    assert.match(missing.queryVersionWarning || "", /not available/);
  });
});
