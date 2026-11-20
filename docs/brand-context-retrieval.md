# Brand Context Retrieval & Multi-Brand Knowledge Service

The [`lib/brand-context`](../lib/brand-context) module resolves live, versioned, tenant-scoped brand knowledge into the canonical `BrandContext` contract consumed by both deterministic and AI text/visual analysis engines.

## Architecture

- [`types.ts`](../lib/brand-context/types.ts) defines `BrandSummary`, `ManagedKnowledgeEntry`, `KnowledgePublicationStatus` (`"draft" | "published" | "archived"`), `BrandVersionSnapshot`, `BrandKnowledgeRecord`, `SourceReference`, `BrandRetrievalWarningCode`, and typed errors (`BrandNotFoundError`, `CrossTenantBrandAccessError`, `KnowledgeEntryNotFoundError`, `BrandKnowledgeRepositoryError`).
- [`repository.ts`](../lib/brand-context/repository.ts) defines `BrandKnowledgeRepository` (analysis read path) and `MultiBrandKnowledgeRepository` (workspace brand listing/creation, entry CRUD, `publishEntry`, `archiveEntry`, and `listBrandSnapshots`).
- [`knowledge-mapper.ts`](../lib/brand-context/knowledge-mapper.ts) maps all seven Knowledge Hub sections (`approved_guidelines`, `voice_tone`, `brand_facts`, `prohibited_claims`, `visual_identity`, `approved_assets`, `required_disclosures`) into canonical `BrandKnowledgeRecord` structures (`buildBrandKnowledgeRecordFromEntries`, `buildTeraluneSampleSeed`). Only `"published"` entries compile into live `BrandContext` snapshots; historical `"versionId"` requests reconstruct the exact published snapshot.
- [`brand-context-service.ts`](../lib/brand-context/brand-context-service.ts) validates `brandId`, `organisationId`, and optional `brandVersionId`, enforces tenant boundaries (`CrossTenantBrandAccessError`), filters to published & platform-applicable entries, maps source/version metadata, validates `BrandContext`, and emits structured retrieval warnings (including `"NO_PUBLISHED_KNOWLEDGE"` when a brand exists but has zero published entries).
- [`file-brand-repository.ts`](../lib/brand-context/file-brand-repository.ts) implements `MultiBrandKnowledgeRepository` with atomic JSON file persistence (`IDENTIQ_KNOWLEDGE_STORE_PATH` or `.identiq-data/brand-knowledge-store.json`), serialized write locking, strict `organisationId` isolation, automatic seeding of the Teralune demo fixture strictly under `demo-brand-teralune`, and monotonic version snapshots (`v1`, `v2`, ...).
- [`supabase-brand-repository.ts`](../lib/brand-context/supabase-brand-repository.ts) implements `MultiBrandKnowledgeRepository` against Supabase PostgreSQL (`brands`, `brand_rules`, `brand_facts`, `assets`, `audit_logs`) using server-side `callServerPostgrest(..., { useServiceRole: true })` with explicit `organisation_id` checks. Entry publication metadata is stored in `applicable_to.__identiqMeta` and immutable snapshots are stored in `audit_logs` (`action = "KNOWLEDGE_VERSION_SNAPSHOT"`).
- [`repository-factory.ts`](../lib/brand-context/repository-factory.ts) creates the active `MultiBrandKnowledgeRepository` per request (`SupabaseBrandKnowledgeRepository` when Supabase server credentials are configured, falling back cleanly to `FileBackedBrandKnowledgeRepository` in local/demo mode).
- [`server-api-auth.ts`](../lib/brand-context/server-api-auth.ts) verifies caller identity (`Authorization: Bearer <jwt>` via GoTrue + `organisation_members`) and mutator role permissions before API handlers read or mutate brand knowledge.
- [`mock-brand-repository.ts`](../lib/brand-context/mock-brand-repository.ts) retains the local contract-test fixtures (`brand-001` and `demo-brand-teralune`) for unit tests.

## Live Lifecycle & Traceability

Call `BrandContextService.getForSubmission({ brandId, submissionId, organisationId, brandVersionId, contentPlatform })`:

1. Returns `{ context, warnings }` where `context.activeVersionId`, `context.sourceIds`, and `context.sourceVersionInformation` reflect the exact published snapshot used during analysis.
2. `"draft"` and `"archived"` entries are never included in live `BrandContext` compilation; saving a draft preserves the previously published snapshot until explicitly published.
3. Publishing an entry generates a new monotonic snapshot (`v1`, `v2`, ...) that historical reviews can reference by `brandVersionId`.
4. Brands with zero published entries return a valid empty `BrandContext` paired with `"NO_PUBLISHED_KNOWLEDGE"` so orchestration reports `analysisStatus: "PARTIAL"` rather than fabricating clean compliance.

## Supabase Schema Handoff (For Harsh Joshi)

`SupabaseBrandKnowledgeRepository` works compatibly with the current database schema without altering `supabase/migrations/`. To replace JSON metadata encoding with first-class SQL columns and RLS-enforced RPCs in a future migration, Harsh Joshi can add:

1. `publication_status text NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft', 'published', 'archived'))` and `published_at timestamptz` on `brand_rules`, `brand_facts`, and `assets` (plus structured `metadata jsonb` / `hex_colours text[]` / `avoid_terms text[]` on `brand_rules`).
2. A dedicated `brand_knowledge_versions (id uuid, brand_id uuid, organisation_id uuid, version_id text, snapshot jsonb, created_at timestamptz)` table replacing `audit_logs` snapshot entries.
3. Transactional RPCs (`publish_knowledge_entry`, `archive_knowledge_entry`, `create_workspace_brand`) scoped by `organisation_members` role checks (`owner`, `admin`, `reviewer`) so mutations work via user JWT without service-role fallback.
