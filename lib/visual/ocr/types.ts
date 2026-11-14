import type { VisualPipelineConfig } from "../config";
import type { EmbeddedTextSpan, OcrBlock } from "../types";

export interface OcrPageExtractionInput {
  pageNumber: number;
  imageWidth: number;
  imageHeight: number;
  pngBuffer: Buffer;
  embeddedSpans?: EmbeddedTextSpan[];
  embeddedText?: string;
}

export interface OcrPageExtractionResult {
  blocks: OcrBlock[];
  combinedText: string;
  uncertainBlockCount: number;
  warnings: string[];
  durationMs: number;
}

export type CustomOcrRunner = (
  pngBuffer: Buffer,
  pageNumber: number,
  config: VisualPipelineConfig,
) => Promise<OcrBlock[]>;
