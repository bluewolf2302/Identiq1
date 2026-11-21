import path from "node:path";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";
import { getVisualPipelineConfig, type VisualPipelineConfig } from "../config";
import type { EmbeddedTextSpan, OcrBlock } from "../types";
import type {
  CustomOcrRunner,
  OcrPageExtractionInput,
  OcrPageExtractionResult,
} from "./types";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getLocalLangPath(): string {
  return path.join(
    process.cwd(),
    "node_modules",
    "@tesseract.js-data",
    "eng",
    "4.0.0",
  );
}

/**
 * Runs Tesseract OCR on an upright PNG image buffer and returns normalized
 * text-line blocks in [0, 1] coordinates (origin top-left).
 */
export async function runTesseractOcrOnImage(
  pngBuffer: Buffer,
  pageNumber: number,
  config: VisualPipelineConfig,
): Promise<OcrBlock[]> {
  if (!pngBuffer || pngBuffer.length === 0) {
    return [];
  }

  const meta = await sharp(pngBuffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  if (imgW <= 0 || imgH <= 0) {
    return [];
  }

  const worker = await createWorker("eng", 1, {
    langPath: getLocalLangPath(),
    gzip: true,
    cacheMethod: "none",
    logger: () => undefined,
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
    });

    const result = await worker.recognize(
      pngBuffer,
      { rotateAuto: true },
      { blocks: true, text: true },
    );

    const blocks: OcrBlock[] = [];
    const tesseractBlocks = result.data.blocks ?? [];
    const rotationDeg =
      typeof result.data.rotateRadians === "number"
        ? Math.round((result.data.rotateRadians * 180) / Math.PI)
        : 0;

    for (const block of tesseractBlocks) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          const text = line.text.replace(/\s+/g, " ").trim();
          if (!text) continue;

          // Filter pure punctuation noise with extremely low confidence
          const rawConf =
            typeof line.confidence === "number" ? line.confidence / 100 : 0;
          const confidence = clamp01(Math.round(rawConf * 1000) / 1000);
          if (confidence < 0.15 && text.length <= 2 && !/[a-zA-Z0-9]/.test(text)) {
            continue;
          }

          const x = clamp01(line.bbox.x0 / imgW);
          const y = clamp01(line.bbox.y0 / imgH);
          const width = clamp01((line.bbox.x1 - line.bbox.x0) / imgW);
          const height = clamp01((line.bbox.y1 - line.bbox.y0) / imgH);

          if (width <= 0 || height <= 0) continue;

          const uncertain = confidence < config.ocrConfidenceThreshold;
          blocks.push({
            text,
            pageNumber,
            boundingBox: {
              x,
              y,
              width: Math.min(1 - x, width),
              height: Math.min(1 - y, height),
            },
            confidence,
            ...(rotationDeg !== 0 ? { rotation: rotationDeg } : {}),
            source: "ocr",
            uncertain,
            reviewStatus: uncertain ? "uncertain" : "candidate",
          });
        }
      }
    }

    // Fallback: if blocks were empty but result.data.text has text, emit one coarse block
    if (blocks.length === 0 && result.data.text.trim()) {
      const confidence = clamp01((result.data.confidence ?? 0) / 100);
      const uncertain = confidence < config.ocrConfidenceThreshold;
      blocks.push({
        text: result.data.text.replace(/\s+/g, " ").trim(),
        pageNumber,
        boundingBox: { x: 0, y: 0, width: 1, height: 1 },
        confidence,
        source: "ocr",
        uncertain,
        reviewStatus: uncertain ? "uncertain" : "candidate",
      });
    }

    return blocks;
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

function normalizeTextForDedup(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9₹%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function boxIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const xA = Math.max(a.x, b.x);
  const yA = Math.max(a.y, b.y);
  const xB = Math.min(a.x + a.width, b.x + b.width);
  const yB = Math.min(a.y + a.height, b.y + b.height);
  const interW = Math.max(0, xB - xA);
  const interH = Math.max(0, yB - yA);
  const interArea = interW * interH;
  if (interArea <= 0) return 0;
  const unionArea = a.width * a.height + b.width * b.height - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * Groups raw PDF embedded spans into line-level blocks so coordinates and text
 * align cleanly with OCR line blocks for deduplication.
 */
export function groupEmbeddedSpansToBlocks(
  spans: EmbeddedTextSpan[],
  pageNumber: number,
): OcrBlock[] {
  if (spans.length === 0) return [];

  const sorted = [...spans].sort((a, b) => {
    const dy = a.boundingBox.y - b.boundingBox.y;
    if (Math.abs(dy) > 0.012) return dy;
    return a.boundingBox.x - b.boundingBox.x;
  });

  const lines: EmbeddedTextSpan[][] = [];
  for (const span of sorted) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      lines.push([span]);
      continue;
    }
    const ref = lastLine[0]!;
    const sameRow =
      Math.abs(span.boundingBox.y - ref.boundingBox.y) <=
      Math.max(0.014, ref.boundingBox.height * 0.7);
    if (sameRow) {
      lastLine.push(span);
    } else {
      lines.push([span]);
    }
  }

  return lines.map((line) => {
    line.sort((a, b) => a.boundingBox.x - b.boundingBox.x);
    const text = line
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const minX = Math.min(...line.map((s) => s.boundingBox.x));
    const minY = Math.min(...line.map((s) => s.boundingBox.y));
    const maxX = Math.max(...line.map((s) => s.boundingBox.x + s.boundingBox.width));
    const maxY = Math.max(...line.map((s) => s.boundingBox.y + s.boundingBox.height));

    return {
      text,
      pageNumber,
      boundingBox: {
        x: clamp01(minX),
        y: clamp01(minY),
        width: clamp01(maxX - minX),
        height: clamp01(maxY - minY),
      },
      confidence: 1,
      source: "pdf_text_layer",
      uncertain: false,
      reviewStatus: "candidate",
    };
  });
}

/**
 * Deduplicates OCR blocks against PDF embedded text layer blocks so the same
 * copy is not fed twice to Shruti's text governance pipeline, while preserving
 * OCR-only text (e.g. text inside embedded raster images or bottle labels).
 */
export function mergeAndDeduplicatePageTextBlocks(
  embeddedBlocks: OcrBlock[],
  ocrBlocks: OcrBlock[],
): OcrBlock[] {
  if (embeddedBlocks.length === 0) return ocrBlocks;
  if (ocrBlocks.length === 0) return embeddedBlocks;

  const embeddedFullNorm = normalizeTextForDedup(
    embeddedBlocks.map((b) => b.text).join(" "),
  );

  const uniqueOcrBlocks = ocrBlocks.filter((ocr) => {
    const ocrNorm = normalizeTextForDedup(ocr.text);
    if (!ocrNorm) return false;

    for (const emb of embeddedBlocks) {
      const embNorm = normalizeTextForDedup(emb.text);
      if (!embNorm) continue;

      // Same text or containment with spatial overlap
      const iou = boxIoU(ocr.boundingBox, emb.boundingBox);
      if (ocrNorm === embNorm && (iou > 0.15 || embeddedBlocks.length <= 3)) {
        return false;
      }
      if (
        iou > 0.25 &&
        (embNorm.includes(ocrNorm) || ocrNorm.includes(embNorm))
      ) {
        return false;
      }
    }

    // If the whole OCR line is already contained verbatim inside the embedded text layer
    if (ocrNorm.length >= 8 && embeddedFullNorm.includes(ocrNorm)) {
      return false;
    }

    return true;
  });

  return [...embeddedBlocks, ...uniqueOcrBlocks];
}

export async function extractPageTextWithOcr(
  input: OcrPageExtractionInput,
  options: {
    config?: Partial<VisualPipelineConfig>;
    ocrRunner?: CustomOcrRunner;
  } = {},
): Promise<OcrPageExtractionResult> {
  const startedAt = Date.now();
  const config = getVisualPipelineConfig(options.config);
  const warnings: string[] = [];

  const embeddedBlocks = groupEmbeddedSpansToBlocks(
    input.embeddedSpans ?? [],
    input.pageNumber,
  );

  const runner = options.ocrRunner ?? runTesseractOcrOnImage;
  let ocrBlocks: OcrBlock[] = [];
  try {
    ocrBlocks = await runner(input.pngBuffer, input.pageNumber, config);
  } catch (error) {
    warnings.push(
      `OCR failed on page ${input.pageNumber}: ${
        error instanceof Error ? error.message : "unknown error"
      }.`,
    );
  }

  const merged = mergeAndDeduplicatePageTextBlocks(embeddedBlocks, ocrBlocks);
  const uncertainBlockCount = merged.filter((b) => b.uncertain).length;
  if (uncertainBlockCount > 0) {
    warnings.push(
      `${uncertainBlockCount} OCR text block(s) on page ${input.pageNumber} had low confidence (<${Math.round(
        config.ocrConfidenceThreshold * 100,
      )}%) and are marked uncertain.`,
    );
  }

  const combinedText = merged
    .filter((b) => b.text.trim().length > 0)
    .map((b) => b.text)
    .join("\n")
    .trim();

  return {
    blocks: merged,
    combinedText,
    uncertainBlockCount,
    warnings,
    durationMs: Date.now() - startedAt,
  };
}
