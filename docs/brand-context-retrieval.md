# Brand Context Retrieval & Multi-Brand Knowledge Service

The [`lib/brand-context`](../lib/brand-context) module resolves live, versioned, tenant-scoped brand knowledge into the canonical `BrandContext` contract consumed by both deterministic and AI text/visual analysis engines.

## Architecture

- [`types.ts`](../lib/brand-context/types.ts) defines `BrandSummary`, `ManagedKnowledgeEntry` (with Phase 2 provenance fields: `entryOrigin`, `extractedText`, `sourceDocumentId`, `sourceTitle`, `sourceDocumentVersion`, `pageNumber`, `sectionRef`, `sourceProposalId`, `structuredFacts`, `versionId`, `createdAt`, `updatedAt`), `KnowledgePublicationStatus` (`"draft" | "published" | "archived"`), `BrandVersionSnapshot`, `BrandKnowledgeRecord`, `SourceReference`, `BrandRetrievalWarningCode`, and typed errors (`BrandNotFoundError`, `CrossTenantBrandAccessError`, `KnowledgeEntryNotFoundError`, `BrandKnowledgeRepositoryError`, `HostedPersistenceUnavailableError`).
- [`repository.ts`](../lib/brand-context/repository.ts) defines `BrandKnowledgeRepository` (analysis read path) and `MultiBrandKnowledgeRepository` (workspace brand listing/creation, idempotent `createOrUpdateEntry`, `publishEntry`, `archiveEntry`, `listBrandSnapshots`, and `HostedPersistenceUnavailableError`).
- [`knowledge-mapper.ts`](../lib/brand-context/knowledge-mapper.ts) maps all seven Knowledge Hub sections (`approved_guidelines`, `voice_tone`, `brand_facts`, `prohibited_claims`, `visual_identity`, `approved_assets`, `required_disclosures`) into canonical `BrandKnowledgeRecord` structures (`buildBrandKnowledgeRecordFromEntries`, `buildTeraluneSampleSeed`). Only `"published"` entries compile into live `BrandContext` snapshots; historical `"versionId"` requests reconstruct the exact published snapshot.
- [`brand-context-service.ts`](../lib/brand-context/brand-context-service.ts) validates `brandId`, `organisationId`, and optional `brandVersionId`, enforces tenant boundaries (`CrossTenantBrandAccessError`), filters to published & platform-applicable entries, maps source/version metadata (`sourceId`, `documentTitle`, `section`, `pageNumber`, `versionId`, `excerpt`), validates `BrandContext`, and emits structured retrieval warnings (including `"NO_PUBLISHED_KNOWLEDGE"` when a brand exists but has zero published entries).
- [`file-brand-repository.ts`](../lib/brand-context/file-brand-repository.ts) implements `MultiBrandKnowledgeRepository` with atomic JSON file persistence (`IDENTIQ_KNOWLEDGE_STORE_PATH` or `.identiq-data/brand-knowledge-store.json`), serialized write locking, strict `organisationId` isolation, monotonic version snapshots (`v1`, `v2`, ...), `publishIdempotencyKey` deduplication, and immutable preservation of `extractedText` across edits.
- [`supabase-brand-repository.ts`](../lib/brand-context/supabase-brand-repository.ts) implements `MultiBrandKnowledgeRepository` against Supabase PostgreSQL (`brands`, `brand_rules`, `brand_facts`, `assets`, `audit_logs`) using server-side `callServerPostgrest(..., { useServiceRole: true })` with explicit `organisation_id` checks. Provenance metadata is preserved inside `applicable_to.__identiqMeta` (including `entryOrigin`, `extractedText`, `sourceDocumentId`, `sourceDocumentVersion`, `sourceProposalId`, `structuredFacts`, `pageNumber`, `sectionRef`, `publishIdempotencyKey`, and `createdAt`), and immutable snapshots are stored in `audit_logs` (`action = "KNOWLEDGE_VERSION_SNAPSHOT"`). Note: `listKnowledgeEntries` filters out `assets` rows with `asset_category === "guideline_pdf"` so uploaded source PDF records never leak into published Asset entries.
- [`repository-factory.ts`](../lib/brand-context/repository-factory.ts) inspects `getPersistenceEnvironmentInfo()`:
  - Uses `SupabaseBrandKnowledgeRepository` when `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are configured.
  - In hosted deployments (`VERCEL === "1"` or `VERCEL_ENV` in `["production", "preview"]` without `IDENTIQ_ALLOW_LOCAL_FILE_STORE=1`), **fails closed** with `HostedPersistenceUnavailableError` (HTTP `503`) rather than silently falling back to ephemeral disk storage.
  - Uses `FileBackedBrandKnowledgeRepository` in local development/test runs.
- [`server-api-auth.ts`](../lib/brand-context/server-api-auth.ts) verifies caller identity (`Authorization: Bearer <jwt>` via GoTrue + `organisation_members`) and mutator role permissions before API handlers read or mutate brand knowledge.
- [`mock-brand-repository.ts`](../lib/brand-context/mock-brand-repository.ts) retains the local contract-test fixtures (`brand-001` and `demo-brand-teralune`) for unit tests.

## Live Lifecycle, Provenance & Traceability

Call `BrandContextService.getForSubmission({ brandId, submissionId, organisationId, brandVersionId, contentPlatform })`:

1. Returns `{ context, warnings }` where `context.activeVersionId`, `context.sourceIds`, and `context.sourceVersionInformation` reflect the exact published snapshot used during analysis.
2. `"draft"` and `"archived"` entries are never included in live `BrandContext` compilation; saving a draft preserves the previously published snapshot until explicitly published.
3. Edits to an entry derived from a guideline PDF (`entryOrigin: "guideline_pdf"`) update the active rule text (`content`) while keeping `extractedText`, `sourceDocumentId`, `sourceDocumentVersion`, `pageNumber`, `sectionRef`, and `sourceProposalId` immutable.
4. Publishing an entry generates a new monotonic snapshot (`v1`, `v2`, ...) that historical reviews can reference by `brandVersionId`. Repeated requests with the same `publishIdempotencyKey` are safely deduplicated.
5. Brands with zero published entries return a valid empty `BrandContext` paired with `"NO_PUBLISHED_KNOWLEDGE"` so orchestration reports `analysisStatus: "PARTIAL"` rather than fabricating clean compliance.

## Supabase Schema & Private Storage Handoff (For Harsh Joshi)

`SupabaseBrandKnowledgeRepository` and `SupabaseGuidelineDocumentRepository` operate compatibly against the existing schema (`brands`, `brand_rules`, `brand_facts`, `assets`, `audit_logs`) and private Storage without altering `supabase/migrations/`. To replace JSON metadata encoding with dedicated SQL tables/columns and RLS-enforced RPCs in a future additive migration, Harsh Joshi can apply:

```sql
-- 1. First-class publication & provenance columns on knowledge tables
ALTER TABLE public.brand_rules
  ADD COLUMN IF NOT EXISTS publication_status text NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft', 'published', 'archived')),
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS entry_origin text NOT NULL DEFAULT 'manual'
    CHECK (entry_origin IN ('manual', 'guideline_pdf')),
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS source_document_id uuid,
  ADD COLUMN IF NOT EXISTS source_document_version text,
  ADD COLUMN IF NOT EXISTS page_number integer,
  ADD COLUMN IF NOT EXISTS section_ref text,
  ADD COLUMN IF NOT EXISTS source_proposal_id text,
  ADD COLUMN IF NOT EXISTS structured_facts jsonb,
  ADD COLUMN IF NOT EXISTS publish_idempotency_key text;

-- 2. Dedicated guideline_documents & knowledge_proposals tables
CREATE TABLE IF NOT EXISTS public.guideline_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  title text NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  checksum_sha256 text NOT NULL,
  file_size_bytes bigint NOT NULL,
  page_count integer NOT NULL,
  source_document_version text NOT NULL,
  extraction_status text NOT NULL CHECK (extraction_status IN ('completed', 'partial', 'failed')),
  ocr_enabled boolean NOT NULL DEFAULT true,
  session_status text NOT NULL CHECK (session_status IN ('ready', 'partially_published', 'published', 'discarded', 'failed')),
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.knowledge_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.guideline_documents(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  category text NOT NULL,
  title text NOT NULL,
  extracted_text text NOT NULL,
  edited_text text NOT NULL,
  page_number integer NOT NULL,
  section_ref text NOT NULL,
  classification_uncertain boolean NOT NULL DEFAULT false,
  confidence numeric(4,3) NOT NULL DEFAULT 0.5,
  structured_facts jsonb,
  conflict_status text NOT NULL DEFAULT 'no_conflict',
  conflict_matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution_action text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'draft', 'published', 'discarded')),
  published_entry_id uuid,
  publish_idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Private Storage bucket + tenant RLS policies
INSERT INTO storage.buckets (id, name, public)
VALUES ('identiq-guidelines', 'identiq-guidelines', false)
ON CONFLICT (id) DO NOTHING;

-- Enforce tenant isolation on guideline_documents & knowledge_proposals via organisation_members
ALTER TABLE public.guideline_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_proposals ENABLE ROW LEVEL SECURITY;
```

Plus a `brand_knowledge_versions` table and transactional RPCs (`publish_knowledge_entry`, `archive_knowledge_entry`, `create_workspace_brand`) scoped by `organisation_members` role checks (`owner`, `admin`, `reviewer`) so mutations can also execute cleanly under user JWTs.
