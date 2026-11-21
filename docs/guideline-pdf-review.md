# Guideline PDF Review, Document Intelligence & Publication Workflow

IdentIQ Round 3 Phase 2 implements the end-to-end durable Guideline PDF workflow inside the existing **Knowledge Hub -> Guideline PDFs** tab ([`components/GuidelinePdfReviewPanel.tsx`](../components/GuidelinePdfReviewPanel.tsx)), connecting PDF upload, extraction, selective OCR fallback, structured rule proposals, bounded conflict detection, and idempotent publication directly into [`MultiBrandKnowledgeRepository`](../lib/brand-context/repository.ts).

## Architecture Overview

### 1. PDF Validation, Ingestion & Private Storage
- [`lib/guidelines/intelligence.ts`](../lib/guidelines/intelligence.ts) validates every uploaded file before storage or extraction:
  - Rejects empty files (`EMPTY_FILE`), non-PDF extensions/MIME types (`INVALID_FILE_TYPE`), files missing the `%PDF-` signature (`INVALID_PDF_SIGNATURE`), and files larger than 20 MB (`FILE_TOO_LARGE`).
  - Computes a deterministic SHA-256 checksum (`checksumSha256`) for brand-scoped duplicate upload detection (`409 DUPLICATE_GUIDELINE_DOCUMENT`, allowing resume or explicit copy).
  - Detects encrypted/password-protected PDFs (`ENCRYPTED_PDF`), zero-page PDFs, and corrupt/unparseable PDFs (`MALFORMED_PDF`), mapping them cleanly to `400` / `422` responses without silent `200` empty responses.
- [`lib/guidelines/storage.ts`](../lib/guidelines/storage.ts) stores original PDF bytes privately:
  - **Hosted Supabase mode**: Uploads to a private Supabase Storage bucket (`SUPABASE_GUIDELINES_BUCKET`, default `identiq-guidelines`) using server-side `SUPABASE_SERVICE_ROLE_KEY`. Auto-creates the bucket as private (`public: false`) if absent.
  - **Local/Demo mode**: Stores PDFs under `.identiq-data/guideline-files/<organisationId>/<brandId>/<documentId>.pdf` with strict `path.resolve` + `path.sep` traversal confinement.
  - **Hosted fail-closed guardrail**: In Vercel production/preview deployments without Supabase credentials (unless `IDENTIQ_ALLOW_LOCAL_FILE_STORE=1` is explicitly set for temporary non-production testing), document persistence fails closed with `503` (`HostedPersistenceUnavailableError`) instead of writing to ephemeral serverless `/tmp` or local disk.
- Original PDFs are served only via authenticated, tenant-checked [`GET /api/guidelines/documents/[documentId]/file`](../app/api/guidelines/documents/[documentId]/file/route.ts) with `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

### 2. Page-by-Page Extraction & Selective OCR Fallback
- Embedded PDF text is extracted page by page via `pdfjs-dist` with per-page error isolation (`page.extractionFailed`, `page.errorMessage`) so a single unreadable page never aborts an entire multi-page document.
- When `enableOcr` is enabled (default) and a page has low embedded text density (`< 40` characters or `< 15` non-whitespace chars), `extractGuidelineDocumentIntelligence` selectively runs OCR using [`lib/visual/pdf-processor.ts`](../lib/visual/pdf-processor.ts) (`processPdfCreative`) and [`lib/visual/ocr.ts`](../lib/visual/ocr.ts) (`extractPageTextWithOcr`).
- Each page records `extractionMethod` (`"embedded" | "ocr" | "hybrid" | "failed"`), `ocrAttempted`, `ocrStatus`, and `ocrReason`, while document-level `extractionStatus` reports `"completed" | "partial" | "failed"`.
- **Safe OCR Fallback**: If OCR is unavailable or fails on a page, `ocrStatus: "failed"` and `ocrReason` are surfaced cleanly in the UI and reviewers can still inspect extracted text or manually select text/add rules on any page.
- [`next.config.ts`](../next.config.ts) includes `pdfjs-dist` workers/fonts/cmaps and `tesseract.js` assets in `outputFileTracingIncludes` for `/api/guidelines/documents`.

### 3. Structured Passage Segmentation, Uncertainty & Fact Extraction
- `segmentAndClassifyDocument` preserves real document headings (`sectionRef`) and 1-based `pageNumber`s without fabricating section names or unverified claims.
- Every candidate proposal classifies into one of the 7 Knowledge Hub categories (`guidelines`, `facts`, `terminology`, `prohibited`, `voice`, `visual`, `policies`), carries immutable `extractedText`, editable `ruleText`/`title`/`tags`/`hexCodes`/`fontNames`, and explicit uncertainty signaling (`classificationUncertain`, `confidence`, `requiresHumanReview`).
- `extractStructuredMetadataFromPassage` extracts grounded metadata into `structuredFacts`:
  - `productName`, `price`, `numericPrice`, `currency`
  - `validFrom`, `validUntil`, `promoPeriod`, and deterministic `isExpiredPromo`
  - `approvedClaim`, `disclaimer`, `restrictedTerm`, `preferredTerm`

### 4. Bounded Guideline Conflict Detection
- [`lib/guidelines/conflict-detector.ts`](../lib/guidelines/conflict-detector.ts) deterministically compares pending proposals against existing **`published`** knowledge entries for the same brand across:
  - **Prices & numeric product specs** (`price`)
  - **Promotional date windows** (`date`)
  - **`#RRGGBB` colour palettes** (`colour`, matching same colour role like primary/accent or contradicting palette definitions)
  - **Prohibited vs preferred/approved terminology** (`terminology`)
  - **Inverse rule polarity** (`inverse_rule`, e.g., `"Always X"` vs `"Never X"`)
- Separates `"conflict"` (direct contradiction) from `"possible_conflict"` (related overlap requiring reviewer confirmation) and `"no_conflict"`.
- Publishing blocked `"conflict"` proposals returns `409 PROPOSAL_CONFLICT` unless the reviewer records an explicit resolution (`keep_existing`, `publish_and_archive_existing`, `publish_coexisting`, `discard_proposal`).

### 5. Durable Session Recovery & Idempotent Publication
- [`lib/guidelines/document-repository.ts`](../lib/guidelines/document-repository.ts) persists sessions via `FileBackedGuidelineDocumentRepository` locally or `SupabaseGuidelineDocumentRepository` (`assets` with `asset_category = "guideline_pdf"` + `audit_logs` `GUIDELINE_DOCUMENT_SESSION` records scoped by `organisation_id`) in Supabase mode.
- Refreshing the page reloads saved draft sessions via `GET /api/guidelines/documents?brandId=...`.
- Discarding a review session (`DELETE /api/guidelines/documents/[documentId]` or `POST /api/guidelines/proposals` with `action: "discard"`) deletes draft proposals cleanly while leaving previously **published** knowledge entries and source PDF provenance intact.
- Publishing requires explicit reviewer action, sends a deterministic `publishIdempotencyKey` to prevent duplicate entries on retries/double-clicks, and compiles a new immutable `BrandVersionSnapshot` (`v1`, `v2`, ...).

## Legacy Extraction Compatibility
- `lib/guidelines/pdf-extraction.ts` (`extractGuidelinePdfText`) and `POST /api/guideline-review/extract` remain intact for legacy Phase 1 unit tests (`tests/guideline-pdf-extraction.test.ts`, `tests/guideline-review-route.test.ts`).
