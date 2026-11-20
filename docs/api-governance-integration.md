# Next.js governance API integration

The `/api/analyze`, `/api/brands`, and `/api/knowledge` App Router endpoints connect the Knowledge Hub UI, New Review Submission workflow, and Review Studio directly to live multi-brand `BrandContext` resolution and `AnalysisOrchestrator`. The legacy `lib/ai/analyzer.ts` is not imported by any API route.

## Server-side composition

[`lib/analysis/composition-root.ts`](../lib/analysis/composition-root.ts) constructs per-request orchestration dependencies using [`createBrandKnowledgeRepository()`](../lib/brand-context/repository-factory.ts):

1. `MultiBrandKnowledgeRepository` (`SupabaseBrandKnowledgeRepository` when Supabase server credentials are configured, or `FileBackedBrandKnowledgeRepository` locally at `.identiq-data/brand-knowledge-store.json`)
2. `BrandContextService`
3. `DeterministicTextGovernanceEngine`
4. `createAiAnalysisServiceFromEnvironment()` with configurable primary/fallback provider priority (`gemini` / `openrouter`)
5. `VisualAnalysisOrchestrator` (synced with the resolved `BrandContext` snapshot per request)
6. `AnalysisOrchestrator`

All provider credentials (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) remain strictly server-side.

## Knowledge Hub & Brand Management APIs

### `GET / POST /api/brands`

- `GET /api/brands` lists tenant-scoped `BrandSummary[]` (including `activeVersionId`, `publishedCount`, `draftCount`, `archivedCount`). Passing `?brandId=...` returns `{ brand, snapshots }`.
- `POST /api/brands` creates a new workspace brand (`name`, `description`, `website`, `primaryPlatforms`) inside the verified tenant organisation and returns `201`.

### `GET / POST /api/knowledge`

- `GET /api/knowledge?brandId=...&status=all|draft|published|archived` returns `{ brand, entries, snapshots }` for the verified tenant brand.
- `POST /api/knowledge` executes Zod-validated lifecycle mutations:
  - `save_draft`: creates or updates a `draft` entry without altering the active published `BrandContext` snapshot.
  - `save_and_publish`: saves an entry directly as `published` and generates a new immutable brand snapshot (`v1`, `v2`, ...).
  - `publish`: promotes an existing `draft` or `archived` entry to `published` and generates a new snapshot.
  - `archive`: moves an entry to `archived` (excluding it from future live analyses while keeping historical snapshots intact) and issues a new snapshot if it was previously published.

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
  - `400`: malformed JSON or Zod validation failure
  - `401`: missing/invalid auth token when Supabase auth is required
  - `403`: cross-organisation brand access (`CrossTenantBrandAccessError`) or insufficient role
  - `404`: requested `brandId` or `brandVersionId` does not exist (`BrandNotFoundError`)
  - `422`: unmapped legacy collection name
  - `500` / `502` / `503`: deterministic, validation, or AI provider unavailability

## UI Integration

- [`/knowledge-hub`](../app/knowledge-hub/page.tsx): brand selector, `+ Create Brand` modal, Published Version History drawer, `All | Published | Draft | Archived` status filters, entry editor supporting dual `Save as Draft` / `Save & Publish` actions, and per-card `Publish` / `Edit` / `Archive` controls backed by `/api/brands` and `/api/knowledge`.
- [`/reviews/new`](../app/reviews/new/page.tsx): Brand / Active Knowledge Version selector showing live published entry counts and active snapshot version, zero-published-rules partial-review notice, one-click `"Attach Teralune Test PDF"` sample action, and submission of `brandId` + `organisationId` + auth token to `/api/analyze`.
- [`/studio`](../app/studio/page.tsx): displays the review's `brandName`, `brandVersionId`, and tailored `NO_PUBLISHED_KNOWLEDGE` partial-review notice alongside evidence-backed findings.
