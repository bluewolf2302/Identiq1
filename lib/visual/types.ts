import type {
  BoundingBox,
  FindingDetector,
  ReviewFinding as CanonicalReviewFinding,
} from "../contracts";
import type { VisualPipelineConfig } from "./config";

export type CreativeFormat = "jpg" | "jpeg" | "png" | "webp" | "pdf";

export interface CreativeFileInput {
  assetId: string;
  fileName: string;
  declaredMimeType?: string;
  buffer?: Buffer;
  base64Data?: string;
}

export interface ValidatedCreativeFile {
  assetId: string;
  fileName: string;
  format: CreativeFormat;
  detectedMimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  pdfPageCount?: number;
}

export interface EmbeddedTextSpan {
  text: string;
  pageNumber: number;
  boundingBox: BoundingBox;
  fontFamily?: string;
  fontSizePt?: number;
  isBold?: boolean;
}

export interface ProcessedPage {
  pageNumber: number;
  /** Original page width in points (PDF) or pixels (image) */
  width: number;
  /** Original page height in points (PDF) or pixels (image) */
  height: number;
  /** Rotation in degrees (0, 90, 180, 270) */
  rotation: number;
  /** Rendered upright image width in pixels */
  imageWidth: number;
  /** Rendered upright image height in pixels */
  imageHeight: number;
  /** Upright PNG buffer for OCR & visual checks */
  pngBuffer: Buffer;
  /** Safe downscaled PNG data URL for browser preview (never local filesystem paths) */
  previewDataUrl?: string;
  embeddedText: string;
  embeddedSpans: EmbeddedTextSpan[];
  status: "ok" | "failed";
  error?: string;
  warnings: string[];
  originalAssetId: string;
}

/**
 * Coordinate convention:
 * Normalized [0, 1] relative to the upright rendered page image,
 * with origin (0, 0) at top-left.
 */
export interface OcrBlock {
  text: string;
  pageNumber: number;
  boundingBox: BoundingBox;
  confidence: number;
  rotation?: number;
  source: "ocr" | "pdf_text_layer";
  uncertain: boolean;
  reviewStatus: "candidate" | "uncertain";
}

export interface ApprovedColorSpec {
  name: string;
  hex: string;
  rgb: { r: number; g: number; b: number };
  lab: { l: number; a: number; b: number };
  usage?: string;
  sourceId: string;
  sourceVersion: string;
  sourceTitle: string;
  pageNumber?: number;
  excerpt: string;
}

export interface ApprovedLogoRule {
  id: string;
  description: string;
  variantName: string;
  expectedColorsHex: string[];
  minWidthPx?: number;
  minWidthMm?: number;
  clearSpaceRule?: string;
  required: boolean;
  referencePngBuffer?: Buffer;
  sourceId: string;
  sourceVersion: string;
  sourceTitle: string;
  pageNumber?: number;
  excerpt: string;
}

export interface ApprovedVisualRule {
  ruleId: string;
  category: "logo" | "colour" | "typography" | "layout" | "visual_consistency";
  description: string;
  sourceId: string;
  sourceVersion: string;
  sourceTitle: string;
  pageNumber?: number;
  excerpt: string;
}

export interface BrandVisualContext {
  brandId: string;
  brandName: string;
  guidelineVersion: string;
  approved: boolean;
  approvedPalette: ApprovedColorSpec[];
  approvedLogos: ApprovedLogoRule[];
  logoRequired: boolean;
  typographyRequirements: string[];
  layoutRequirements: string[];
  requiredVisualElements: string[];
  prohibitedVisualStyles: string[];
  rules: ApprovedVisualRule[];
  validSourceIds: string[];
  validVersions: string[];
  hasVisualKnowledge: boolean;
  warnings: string[];
}

export type VisualFindingCategory =
  | "logo"
  | "colour"
  | "typography"
  | "layout"
  | "visual_consistency";

export type VisualFindingClassification =
  | "objective_mismatch"
  | "possible_mismatch"
  | "design_recommendation";

export type VisualReviewStatus =
  | "candidate"
  | "uncertain"
  | "needs_human_review";

export interface VisualFinding {
  id: string;
  ruleId: string | null;
  category: VisualFindingCategory;
  title: string;
  explanation: string;
  expectedValue: string;
  observedValue: string;
  sourceReference: {
    sourceId: string | null;
    sourceVersion: string | null;
    sourceTitle?: string | null;
    pageNumber: number | null;
    excerpt: string | null;
  };
  creativeEvidence: {
    assetId: string;
    pageNumber: number;
    boundingBox: BoundingBox | null;
    description: string;
  };
  confidence: number;
  reviewStatus: VisualReviewStatus;
  severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  detector: Exclude<FindingDetector, "ai_semantic">;
  classification?: VisualFindingClassification;
  suggestedCorrection?: string;
}

export interface VisualObservation {
  pageNumber: number;
  detector: string;
  summary: string;
  metrics?: Record<string, string | number | boolean>;
}

export interface VisualPipelineDiagnostics {
  reviewId: string;
  analysisRunId: string;
  creativeId: string;
  fileFormat: string;
  fileSizeBytes: number;
  pageCount: number;
  processedPageCount: number;
  ocrBlockCount: number;
  ocrDurationMs: number;
  deterministicDurationMs: number;
  geminiProvider?: string;
  geminiModel?: string;
  geminiDurationMs: number;
  geminiRetryCount: number;
  candidateFindingCount: number;
  uncertainFindingCount: number;
  validationFailureCount: number;
  partialPageFailureCount: number;
  finalStatus: "COMPLETED" | "PARTIAL" | "FAILED" | "SKIPPED";
}

export interface VisualAnalysisResult {
  status: "COMPLETED" | "PARTIAL" | "FAILED" | "SKIPPED";
  creativeMetadata: {
    assetId: string;
    fileName: string;
    format: string;
    mimeType: string;
    sizeBytes: number;
    pageCount: number;
    processedPageCount: number;
  };
  pages: Array<{
    pageNumber: number;
    width: number;
    height: number;
    rotation: number;
    imageWidth: number;
    imageHeight: number;
    status: "ok" | "failed";
    error?: string;
    previewDataUrl?: string;
    originalAssetId: string;
  }>;
  ocrBlocks: OcrBlock[];
  extractedText: string;
  observations: VisualObservation[];
  visualFindings: VisualFinding[];
  canonicalFindings: CanonicalReviewFinding[];
  warnings: string[];
  errors: string[];
  visionProviderUsed?: string;
  diagnostics: VisualPipelineDiagnostics;
}

export class VisualValidationError extends Error {
  readonly code:
    | "EMPTY_FILE"
    | "OVERSIZED_FILE"
    | "UNSUPPORTED_FORMAT"
    | "MIME_SIGNATURE_MISMATCH"
    | "CORRUPT_IMAGE"
    | "CORRUPT_PDF"
    | "ENCRYPTED_PDF"
    | "EMPTY_PDF"
    | "PDF_PAGE_LIMIT_EXCEEDED";

  constructor(code: VisualValidationError["code"], message: string) {
    super(message);
    this.name = "VisualValidationError";
    this.code = code;
  }
}

export interface VisionPageInput {
  pageNumber: number;
  imageWidth: number;
  imageHeight: number;
  pngBuffer: Buffer;
  ocrBlocks: OcrBlock[];
  deterministicObservations: string[];
  brandContext: BrandVisualContext;
}

export interface GeminiVisionAdapter {
  readonly providerName: string;
  readonly modelName: string;
  analyzePage(input: VisionPageInput): Promise<{
    findings: VisualFinding[];
    retryCount: number;
    validationFailures: number;
    modelUsed?: string;
  }>;
}

export interface VisualAnalysisDependencies {
  config?: Partial<VisualPipelineConfig>;
  ocrRunner?: (
    pngBuffer: Buffer,
    pageNumber: number,
    config: VisualPipelineConfig,
  ) => Promise<OcrBlock[]>;
  pdfPageRenderer?: (
    pdfBuffer: Buffer,
    pageNumber: number,
    dpi: number,
  ) => Promise<Buffer>;
  visionAdapter?: GeminiVisionAdapter | null;
}
