# Next.js governance API integration

The `/api/analyze`, `/api/brands`, `/api/knowledge`, `/api/guidelines/documents`, and `/api/guidelines/proposals` App Router endpoints connect the Knowledge Hub UI, Guideline PDF Review workflow, New Review Submission workflow, and Review Studio directly to live multi-brand `BrandContext` resolution, private document persistence, and `AnalysisOrchestrator`. The legacy `lib/ai/analyzer.ts` is not imported by any API route.

## Server-side composition & Fail-Closed Hosted Guardrail

[`lib/analysis/composition-root.ts`](../lib/analysis/composition-root.ts) constructs per-request orchestration dependencies using [`createBrandKnowledgeRepository()`](../lib/brand-context/repository-factory.ts):

1. `MultiBrandKnowledgeRepository` (`SupabaseBrandKnowledgeRepository` when Supabase server credentials are configured, or `FileBackedBrandKnowledgeRepository` locally at `.identiq-data/brand-knowledge-store.json`)
2. `BrandContextService`
3. `DeterministicTextGovernanceEngine`
4. `createAiAnalysisServiceFromEnvironment()` with configurable primary/fallback provider priority (`gemini` / `openrouter`)
5. `VisualAnalysisOrchestrator` (synced with the resolved `BrandContext` snapshot per request)
6. `AnalysisOrchestrator`

All provider credentials (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) remain strictly server-side.

In hosted deployments (`VERCEL=1` or `VERCEL_ENV=production|preview` without `IDENTIQ_ALLOW_LOCAL_FILE_STORE=1`), missing Supabase server credentials (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) fail closed with HTTP `503` (`HostedPersistenceUnavailableError`) instead of writing to ephemeral serverless disk.

## Knowledge Hub & Brand Management APIs

### `GET / POST /api/brands`

- `GET /api/brands` lists tenant-scoped `BrandSummary[]` (including `activeVersionId`, `publishedCount`, `draftCount`, `archivedCount`) plus `persistenceEnvironment` diagnostics (`backend`, `hostedProduction`, `supabaseConfigured`, `hasServiceRoleKey`). Passing `?brandId=...` returns `{ brand, snapshots }`.
- `POST /api/brands` creates a new workspace brand (`name`, `description`, `website`, `primaryPlatforms`) inside the verified tenant organisation and returns `201`.

### `GET / POST /api/knowledge`

- `GET /api/knowledge?brandId=...&status=all|draft|published|archived` returns `{ brand, entries, snapshots }` for the verified tenant brand.
- `POST /api/knowledge` executes Zod-validated lifecycle mutations while preserving immutable source provenance (`entryOrigin`, `extractedText`, `sourceDocumentId`, `sourceTitle`, `sourceDocumentVersion`, `pageNumber`, `sectionRef`, `sourceProposalId`, `structuredFacts`, `publishIdempotencyKey`):
  - `save_draft`: creates or updates a `draft` entry without altering the active published `BrandContext` snapshot.
  - `save_and_publish`: saves an entry directly as `published` and generates a new immutable brand snapshot (`v1`, `v2`, ...). Supports optional `supersedeEntryId` to archive a superseded published rule atomically.
  - `publish`: promotes an existing `draft` or `archived` entry to `published` and generates a new snapshot.
  - `archive`: moves an entry to `archived` (excluding it from future live analyses while keeping historical snapshots intact) and issues a new snapshot if it was previously published.

## Guideline PDF Intelligence & Proposal Review APIs

### `GET / POST /api/guidelines/documents`

- `GET /api/guidelines/documents?brandId=...` lists saved durable guideline review sessions (`GuidelineDocumentSession[]`) for the selected brand & tenant, recomputing live conflict checks against currently published entries.
- `POST /api/guidelines/documents` accepts `multipart/form-data` (`file`, `brandId`, `title`, optional `sourceDocumentVersion`, `enableOcr`, `allowDuplicateCopy`, `retrySessionId`):
  - Enforces server-side PDF validation (`<= 20 MB`, `.pdf` / `application/pdf`, `%PDF-` magic header, encrypted/0-page/corrupt checks).
  - Detects same-brand SHA-256 duplicates (`409 DUPLICATE_GUIDELINE_DOCUMENT` returning `{ existingSessionId, existingTitle }`) unless `allowDuplicateCopy=true` or retrying a failed session (`retrySessionId`).
  - Stores PDF bytes privately in Supabase Storage (`SUPABASE_GUIDELINES_BUCKET`, default `identiq-guidelines`) or local confined storage (`.identiq-data/guideline-files/`), runs isolated page-by-page extraction + selective OCR fallback, classifies candidate proposals, extracts `structuredFacts`, detects conflicts against published brand rules, and persists the durable session.

### `GET / DELETE /api/guidelines/documents/[documentId]`

- `GET` returns `{ session, brand }` with refreshed conflict checks against current published knowledge.
- `DELETE` cleanly removes a draft/unneeded review session (`discarded`) without modifying or deleting any already-published `KnowledgeEntry` records.

### `GET /api/guidelines/documents/[documentId]/file`

- Streams the original uploaded PDF bytes only after verifying caller identity and tenant `organisation_id` (`403` on cross-tenant access).
- Sets `Content-Type: application/pdf`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`.

### `POST /api/guidelines/proposals`

- Handles Zod-validated proposal workflow mutations:
  - `save_draft`: persists reviewer edits, category overrides, structured metadata edits, or conflict resolution choices on the session without publishing to live context.
  - `publish`: validates every selected proposal; returns `409 PROPOSAL_CONFLICT` if any direct `"conflict"` lacks an explicit resolution (`keep_existing`, `publish_and_archive_existing`, `publish_coexisting`, `discard_proposal`). Deduplicates via `publishIdempotencyKey`, archives superseded entries when `publish_and_archive_existing` is chosen, writes published entries with full immutable provenance (`entryOrigin: "guideline_pdf"`, `extractedText`, `sourceDocumentId`, `sourceDocumentVersion`, `pageNumber`, `sectionRef`, `sourceProposalId`, `structuredFacts`), and creates a new monotonic `BrandVersionSnapshot`.
  - `add_manual_proposal`: allows reviewers to manually highlight/capture a passage directly from an extracted PDF page and attach it as a reviewable proposal.
  - `discard`: marks draft proposals/session discarded while preserving any already-published provenance.

### Tenant & Auth Enforcement

[`lib/brand-context/server-api-auth.ts`](../lib/brand-context/server-api-auth.ts) verifies `Authorization: Bearer <jwt>` against GoTrue `/auth/v1/user` and checks `organisation_members` in Supabase-configured mode (requiring `owner`, `admin`, `reviewer`, or `demo_reviewer` for mutations), or isolates demo requests to `DEMO_CONFIG.ORGANISATION_ID`. In unconfigured local demo mode (`DEMO_LOCAL`), requests are scoped to the active tenant organisation ID.

## Analysis Request & Response Adapters

### Request (`POST /api/analyze`)

[`lib/analysis/api-adapters.ts`](../lib/analysis/api-adapters.ts) adapts frontend submissions into canonical `AnalysisRequest`:

- Accepts an explicit `brandId` (or legacy `brand` collection selector for Teralune backwards compatibility; unknown brands are never silently mapped to Teralune and fail with `404` or `422`).
- Preserves optional `organisationId` (overridden by the server-verified tenant ID in `/api/analyze` when auth/org headers are supplied) and optional `brandVersionId`.
- `title` becomes `campaignName`; `textContent` becomes `contentText`.
- `knowledgeSummary` is intentionally ignored as authoritative evidence; only structured published Knowledge Hub records from the repository are evaluated.
- `creativePayload` is validated and passed to the multimodal visual pipeline (OCR + deterministic colour/typography/layout/logo checks + AI Vision).

### Response (`POST /api/analyze`)

- Preserves `submissionId`, `analysisRunId`, `brandId`, `brandVersionId`, `analysisStatus` (`"COMPLETED" | "PARTIAL"`), `contextWarnings`, `providerUsed`, `fallbackUsed`, `visualExecution`, and all finding evidence references (`sourceIds`, `versionId`, `documentTitle`, `section`, `pageNumber`, `excerpt`).
- Returns structured JSON error codes:
  - `400`: malformed JSON, invalid PDF upload, or Zod validation failure
  - `401`: missing/invalid auth token when Supabase auth is required
  - `403`: cross-organisation brand/document access (`CrossTenantBrandAccessError`) or insufficient role
  - `404`: requested `brandId`, `brandVersionId`, or `documentId` does not exist
  - `409`: duplicate guideline PDF (`DUPLICATE_GUIDELINE_DOCUMENT`) or unresolved guideline conflict (`PROPOSAL_CONFLICT`)
  - `422`: unmapped legacy collection name or encrypted/corrupt/0-page PDF (`ENCRYPTED_PDF` / `MALFORMED_PDF`)
  - `500` / `502` / `503`: deterministic failure, provider failure, AI unavailability, or hosted persistence unconfigured (`HostedPersistenceUnavailableError`)

## UI Integration

- [`/knowledge-hub`](../app/knowledge-hub/page.tsx): brand selector, `+ Create Brand` modal, Published Version History drawer, `All | Published | Draft | Archived` status filters, `From PDF` vs `Manual` origin badges, immutable `Original PDF Excerpt` comparison when edited, extracted `structuredFacts` & `Expired Promo Date` chips, deep-linked `?brandId=&sourceDocId=&page=` filtering, inline authenticated `Open Source PDF` modal viewer, and the integrated **Guideline PDFs** review tab (`components/GuidelinePdfReviewPanel.tsx`).
- [`/reviews/new`](../app/reviews/new/page.tsx): Brand / Active Knowledge Version selector showing live published entry counts and active snapshot version, zero-published-rules partial-review notice, one-click `"Attach Teralune Test PDF"` sample action, and submission of `brandId` + `organisationId` + auth token to `/api/analyze`.
- [`/studio`](../app/studio/page.tsx): displays the review's `brandName`, `brandVersionId` (`v1`, `v2`, ...), source citations (`documentTitle`, `section`, `pageNumber`), `"Inspect source"` deep-link back into Knowledge Hub, and tailored `NO_PUBLISHED_KNOWLEDGE` partial-review notice alongside evidence-backed findings.
