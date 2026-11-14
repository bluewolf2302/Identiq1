/**
 * Configurable defaults and limits for the IdentIQ visual-analysis pipeline.
 *
 * Defaults:
 * - MAX_FILE_SIZE_BYTES: 15 MiB (covers high-res ad creatives & multi-page PDFs)
 * - MAX_PDF_PAGES: 10 pages per creative PDF to prevent unbounded CPU/memory usage
 * - PDF_RENDER_DPI: 150 DPI (balances OCR legibility against memory/latency)
 * - MAX_RENDERED_DIMENSION_PX: 2048 px (caps huge camera photos before processing)
 * - MIN_READABLE_WIDTH_PX / MIN_READABLE_HEIGHT_PX: 300 x 200 px (below triggers low-res warning)
 * - OCR_CONFIDENCE_THRESHOLD: 0.65 (below marks OCR blocks uncertain)
 * - COLOR_DELTA_E_SIGNIFICANT / POSSIBLE: CIEDE2000 perceptual thresholds (18.0 / 10.0)
 */

export interface VisualPipelineConfig {
  maxFileSizeBytes: number;
  maxPdfPages: number;
  pdfRenderDpi: number;
  maxRenderedDimensionPx: number;
  minReadableWidthPx: number;
  minReadableHeightPx: number;
  ocrConfidenceThreshold: number;
  colorDeltaESignificant: number;
  colorDeltaEPossible: number;
  geminiVisionTimeoutMs: number;
  geminiVisionMaxRetries: number;
  previewMaxDimensionPx: number;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getVisualPipelineConfig(
  overrides: Partial<VisualPipelineConfig> = {},
): VisualPipelineConfig {
  const defaults: VisualPipelineConfig = {
    maxFileSizeBytes: readPositiveIntEnv(
      "VISUAL_MAX_FILE_SIZE_BYTES",
      15 * 1024 * 1024,
    ),
    maxPdfPages: readPositiveIntEnv("VISUAL_MAX_PDF_PAGES", 10),
    pdfRenderDpi: readPositiveIntEnv("VISUAL_PDF_RENDER_DPI", 150),
    maxRenderedDimensionPx: readPositiveIntEnv("VISUAL_MAX_DIMENSION_PX", 2048),
    minReadableWidthPx: readPositiveIntEnv("VISUAL_MIN_WIDTH_PX", 300),
    minReadableHeightPx: readPositiveIntEnv("VISUAL_MIN_HEIGHT_PX", 200),
    ocrConfidenceThreshold: readPositiveFloatEnv("VISUAL_OCR_CONFIDENCE_THRESHOLD", 0.65),
    colorDeltaESignificant: readPositiveFloatEnv("VISUAL_COLOR_DELTA_E_SIGNIFICANT", 18.0),
    colorDeltaEPossible: readPositiveFloatEnv("VISUAL_COLOR_DELTA_E_POSSIBLE", 10.0),
    geminiVisionTimeoutMs: readPositiveIntEnv("VISUAL_GEMINI_TIMEOUT_MS", 45_000),
    geminiVisionMaxRetries: readPositiveIntEnv("VISUAL_GEMINI_MAX_RETRIES", 1),
    previewMaxDimensionPx: 960,
  };

  return { ...defaults, ...overrides };
}

export const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".pdf"] as const;
export type SupportedCreativeExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export const SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type SupportedCreativeMimeType = (typeof SUPPORTED_MIME_TYPES)[number];
