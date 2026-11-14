# IdentIQ Phase 2 — Multimodal Visual Governance Module

Owner: **Harsh Kumar** (Creative Processing, OCR, Visual Checks, Gemini Vision & Visual Evidence Mapping)

## 1. Architecture & Pipeline Overview

The visual module lives under `lib/visual/` and plugs directly into Shruti's central `AnalysisOrchestrator` (`lib/analysis/analysis-orchestrator.ts`) rather than acting as a standalone review workflow.

```
Creative Upload (.jpg / .jpeg / .png / .webp / .pdf)
  │
  ▼  validateCreativeFile (lib/visual/file-validation.ts)
  │  Extension + MIME vs Magic-Byte signature + Size + Corruption/Encryption check
  ▼
  ├─ Image (.jpg/.jpeg/.png/.webp) ──► processImageCreative (EXIF auto-rotate, upright PNG, preview)
  └─ PDF   (.pdf)                  ──► processPdfCreative (per-page dimensions, rotation, embedded text + @napi-rs/canvas + pdfjs-dist PNG render)
  │
  ▼  extractPageTextWithOcr (lib/visual/ocr/extract-text.ts)
  │  Local offline Tesseract OCR (@tesseract.js-data/eng) + PDF text-layer spatial/text deduplication
  │
  ├──► Shruti's DeterministicTextGovernanceEngine & AI Semantic Analyzer (combined user copy + OCR text)
  │
  ▼  Deterministic Visual Checks (per page, grounded in Aditi's BrandVisualContext)
  ├─ runColourCheck     (CIEDE2000 ΔE00 vs approved palette; 6×6 photographic tile protection)
  ├─ runLogoCheck       (Optional reference NCC template match + wordmark lockup colour/size/crop check)
  ├─ runTypographyCheck (Embedded PDF font-family check, low-res warning, WCAG text contrast)
  └─ runLayoutCheck     (Safe edge margins & logo clear-space crowding)
  │
  ▼  SdkGeminiVisionAdapter (lib/visual/vision/gemini-vision.ts)
  │  Server-side Gemini Vision contextual analysis with strict Zod + sourceId/version anti-fabrication check
  │
  ▼  deduplicateVisualFindings & mapVisualFindingsToCanonical
     Returns canonical ReviewFinding items, OcrBlock[], and VisualSummary to AnalysisOrchestrator
```

The visual module **never** approves, rejects, or computes overall review status on its own; every visual observation enters Shruti's central `mergeFindings` pipeline alongside text findings.

---

## 2. Configurable Defaults (`lib/visual/config.ts`)

All processing limits are centralized in `DEFAULT_VISUAL_PIPELINE_CONFIG` and may be overridden via `getVisualPipelineConfig()` or `VISUAL_*` environment variables:

| Setting | Default | Purpose |
| --- | --- | --- |
| `maxFileSizeBytes` (`VISUAL_MAX_FILE_SIZE_BYTES`) | `15 MB` (`15 * 1024 * 1024`) | Maximum upload payload accepted for creative validation |
| `maxPdfPages` (`VISUAL_MAX_PDF_PAGES`) | `10` pages | Maximum PDF pages processed per submission; excess pages emit a clear warning and yield `PARTIAL` status |
| `pdfRenderDpi` (`VISUAL_PDF_RENDER_DPI`) | `150` DPI | Balance between OCR legibility and server render speed |
| `maxRenderedDimensionPx` | `2048` px | Caps maximum width/height after rendering/auto-orientation |
| `previewMaxDimensionPx` | `1200` px | Bounds browser preview PNG size (`previewDataUrl`) |
| `minReadableWidthPx` / `HeightPx` | `300 × 200` px | Below this threshold, creatives emit a quality warning and findings are marked `uncertain` / `needs_human_review` |
| `ocrConfidenceThreshold` | `0.65` | OCR blocks below 65% confidence are retained with `uncertain: true` and `reviewStatus: "uncertain"` |
| `colorDeltaEPossible` / `Significant` | `10.0` / `18.0` | CIEDE2000 ΔE00 thresholds for `possible_mismatch` vs `objective_mismatch` |
| `geminiVisionTimeoutMs` | `45,000` ms | Per-page Gemini Vision request timeout |
| `geminiVisionMaxRetries` | `1` retry | Bounded retry only on retryable errors (`RATE_LIMITED`, `TIMEOUT`, `EMPTY_OUTPUT`, 5xx) |

---

## 3. Coordinate System & OCR Deduplication

- **Origin & Units**: All `boundingBox` objects (`{ x, y, width, height }`) use **top-left origin `(0, 0)`** and **normalized coordinates in `[0, 1]`** relative to the **upright rendered page image** (`imageWidth × imageHeight`).
- **Low-Confidence Handling**: Blocks with `confidence < 0.65` are flagged `uncertain: true` and `reviewStatus: "uncertain"`, and are never presented as verified violations.
- **PDF Dual-Layer Deduplication**: For PDFs containing an embedded text layer, `mergeAndDeduplicatePageTextBlocks` suppresses duplicate Tesseract OCR lines whose normalized text and spatial bounding box (IoU) overlap embedded spans, while preserving raster-only text (such as bottle labels or embedded promotional badges).

---

## 4. Deterministic Visual Checks & Uncertainty Discipline

- **Colour Check (`checks/colour-check.ts`)**: Uses Sharma (2005) **CIEDE2000** (`ΔE00`). A 6×6 tile local-gradient + colour-diversity filter excludes high-texture photographic tiles so natural product photography is not false-flagged as an unapproved brand colour.
- **Logo Check (`checks/logo-check.ts`)**: Supports multi-scale grayscale normalized cross-correlation (NCC) when reference logo bitmaps are supplied, plus wordmark-anchored lockup colour/edge-crop checks (ignoring URLs/long prose). Missing-logo findings only fire when `brandContext.logoRequired === true`.
- **Typography & Layout (`checks/typography-check.ts`, `checks/layout-check.ts`)**: Only asserts exact font-family mismatches when PDF embedded font metadata is present (never guesses fonts from flattened raster pixels). Measures WCAG luminance contrast (`IMG-08`) and outer edge / logo clear-space crowding (`LOG-03`), clearly categorizing findings as `objective_mismatch`, `possible_mismatch`, or `design_recommendation`.

---

## 5. Gemini Vision & Reliability Guarantees

- Runs strictly server-side using `@google/genai` (`SdkGeminiVisionAdapter`) with `GEMINI_API_KEY` and `GEMINI_MODEL` (default `gemini-4-hydrogen`), structured JSON schema output (`VISION_RESPONSE_SCHEMA`), and a `User-Agent: aistudio-build` header.
- **Anti-Fabrication**: `validateAndMapGeminiVisionResponse` drops any model candidate referencing a `sourceId` or `sourceVersion` not present in Aditi's approved `BrandVisualContext`.
- **No Silent Mock Fallback**: On `MISSING_CREDENTIALS`, `INVALID_CREDENTIALS`, `RATE_LIMITED`, `TIMEOUT`, `MALFORMED_JSON`, `EMPTY_OUTPUT`, or `PROVIDER_ERROR`, `analyzeCreativeVisually` records a clear error/warning, preserves OCR and deterministic findings, and sets `status: "PARTIAL"` (mapped to `analysisStatus: "PARTIAL"` in the orchestrator).
- **Safe Logging (`logger.ts`)**: Structured JSON logs correlate `analysisRunId`, `reviewId`, and `creativeId` while automatically redacting keys, tokens, base64 payloads, and raw buffers.

---

## 6. Cross-Owner Integration & Handover Notes

- **Aditi (Brand Context)**: `adaptBrandKnowledgeToVisualContext` consumes `BrandKnowledgeRecord` (approved `visualAssets`, `designGuidelines`, `usagePolicies`, `typographyReferences`, and real `source` provenance) and ignores unapproved records (`approved: false`). When dedicated vector/PNG logo assets are stored in the Brand Knowledge Hub, attach them via `referenceLogoBuffers` to unlock pixel-level NCC matching across every approved variant.
- **Shruti (Orchestration & Contracts)**:
  - `AnalysisRequestSchema` accepts optional `creativePayload`; `AnalysisResponseSchema` returns optional `ocrBlocks` and `visualSummary`, while `ReviewFindingSchema` supports optional `ruleId`, `detector`, and `location.boundingBox`.
  - `AnalysisOrchestrator` runs visual analysis first, merges unique OCR lines into `contentText`, and merges `visualResult.canonicalFindings` into the unified `findings` array. `VisualValidationError` maps to HTTP `400` (`visual-validation`) and fatal all-page failures map to HTTP `500` (`visual`).
- **Bhumi (Persistence & Storage)**: Creatives currently travel as base64 in `creativePayload` and return browser-safe `previewDataUrl` PNGs (`<= 1200px`). Local filesystem paths are never exposed to the browser. When Bhumi's Supabase Storage bucket upload is wired, `CreativeFileInput` can resolve buffers server-side from storage asset IDs and `previewDataUrl` can be replaced with signed storage URLs to eliminate `localStorage` quota pressure on large multi-page PDFs.
