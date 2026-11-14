import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import type { VisualPipelineConfig } from "./config";
import type {
  EmbeddedTextSpan,
  ProcessedPage,
  ValidatedCreativeFile,
} from "./types";

const execFileAsync = promisify(execFile);

let pdfWorkerConfigured = false;

async function getPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfWorkerConfigured) {
    const workerPath = path.join(
      process.cwd(),
      "node_modules",
      "pdfjs-dist",
      "legacy",
      "build",
      "pdf.worker.mjs",
    );
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    pdfWorkerConfigured = true;
  }
  return pdfjs;
}

function getStandardFontDataUrl(): string {
  const fontDir = path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts");
  const href = pathToFileURL(fontDir).href;
  return href.endsWith("/") ? href : `${href}/`;
}

class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(
      Math.max(1, Math.ceil(width)),
      Math.max(1, Math.ceil(height)),
    );
    return {
      canvas,
      context: canvas.getContext("2d"),
    };
  }

  reset(
    canvasAndContext: { canvas: { width: number; height: number }; context: unknown },
    width: number,
    height: number,
  ) {
    canvasAndContext.canvas.width = Math.max(1, Math.ceil(width));
    canvasAndContext.canvas.height = Math.max(1, Math.ceil(height));
  }

  destroy(canvasAndContext: { canvas: { width: number; height: number }; context: unknown }) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

export async function renderPdfPageWithGhostscript(
  pdfBuffer: Buffer,
  pageNumber: number,
  dpi: number,
): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "identiq-pdf-"));
  const inputPath = path.join(tmpDir, "input.pdf");
  const outputPath = path.join(tmpDir, `page-${pageNumber}.png`);
  try {
    await fs.writeFile(inputPath, pdfBuffer);
    await execFileAsync(
      "gs",
      [
        "-dSAFER",
        "-dNOPAUSE",
        "-dBATCH",
        "-sDEVICE=png16m",
        `-r${dpi}`,
        `-dFirstPage=${pageNumber}`,
        `-dLastPage=${pageNumber}`,
        "-dTextAlphaBits=4",
        "-dGraphicsAlphaBits=4",
        `-sOutputFile=${outputPath}`,
        inputPath,
      ],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
    );
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sanitizePdfText(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PdfProcessingOptions {
  pageRenderer?: (
    pdfBuffer: Buffer,
    pageNumber: number,
    dpi: number,
  ) => Promise<Buffer>;
}

export async function processPdfCreative(
  file: ValidatedCreativeFile,
  config: VisualPipelineConfig,
  options: PdfProcessingOptions = {},
): Promise<{
  totalPageCount: number;
  pages: ProcessedPage[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const pdfjs = await getPdfJs();
  const canvasFactory = new NodeCanvasFactory();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(file.buffer),
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
    standardFontDataUrl: getStandardFontDataUrl(),
  } as Parameters<typeof pdfjs.getDocument>[0]);

  const doc = await loadingTask.promise;
  const totalPageCount = doc.numPages;

  if (totalPageCount === 0) {
    await doc.cleanup();
    await loadingTask.destroy();
    return {
      totalPageCount: 0,
      pages: [],
      warnings: ["PDF has 0 pages."],
    };
  }

  const pagesToProcess = Math.min(totalPageCount, config.maxPdfPages);
  if (totalPageCount > config.maxPdfPages) {
    warnings.push(
      `PDF contains ${totalPageCount} pages, exceeding the configured limit of ${config.maxPdfPages} pages. Only the first ${pagesToProcess} pages were processed.`,
    );
  }

  const customRenderer = options.pageRenderer;
  const processedPages: ProcessedPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber++) {
      const pageWarnings: string[] = [];
      let pageWidth = 612;
      let pageHeight = 792;
      let rotation = 0;
      const embeddedSpans: EmbeddedTextSpan[] = [];
      let embeddedText = "";
      let loadedPage: Awaited<ReturnType<typeof doc.getPage>> | null = null;

      try {
        loadedPage = await doc.getPage(pageNumber);
        const viewport = loadedPage.getViewport({ scale: 1.0 });
        pageWidth = viewport.width;
        pageHeight = viewport.height;
        rotation = loadedPage.rotate ?? 0;

        if (rotation !== 0) {
          pageWarnings.push(
            `PDF page ${pageNumber} has native rotation ${rotation}°; normalized upright in rendered coordinates.`,
          );
        }

        const textContent = await loadedPage.getTextContent();
        const styles = textContent.styles ?? {};
        const lineTexts: string[] = [];

        for (const item of textContent.items) {
          if (!("str" in item)) continue;
          const text = sanitizePdfText(item.str);
          if (!text) continue;

          lineTexts.push(text);

          // Convert PDF transform into upright viewport pixel coordinates
          const tx = pdfjs.Util.transform(viewport.transform, item.transform);
          const fontHeightPx =
            Math.hypot(tx[2] ?? 0, tx[3] ?? 0) || Math.abs(item.height || 12);
          const spanWidthPx = Math.max(2, item.width || text.length * fontHeightPx * 0.5);
          const xPx = tx[4] ?? 0;
          const baselineYPx = tx[5] ?? 0;
          const topYPx = baselineYPx - fontHeightPx;

          const x = clamp01(xPx / Math.max(1, viewport.width));
          const y = clamp01(topYPx / Math.max(1, viewport.height));
          const width = clamp01(spanWidthPx / Math.max(1, viewport.width));
          const height = clamp01(fontHeightPx / Math.max(1, viewport.height));

          const styleInfo = item.fontName ? styles[item.fontName] : undefined;
          const rawFontFamily = styleInfo?.fontFamily ?? item.fontName ?? undefined;
          const isBold = rawFontFamily
            ? /bold|black|heavy|semibold/i.test(rawFontFamily)
            : undefined;

          embeddedSpans.push({
            text,
            pageNumber,
            boundingBox: {
              x,
              y,
              width: Math.max(0.005, Math.min(1 - x, width)),
              height: Math.max(0.005, Math.min(1 - y, height)),
            },
            fontFamily: rawFontFamily,
            fontSizePt: Math.round(fontHeightPx * 10) / 10,
            isBold,
          });
        }

        embeddedText = lineTexts.join(" ").replace(/\s+/g, " ").trim();
      } catch (error) {
        pageWarnings.push(
          `Embedded PDF text extraction failed on page ${pageNumber}: ${
            error instanceof Error ? error.message : "unknown error"
          }. Falling back to rendered-page OCR.`,
        );
      }

      try {
        let rawPng: Buffer;
        if (customRenderer) {
          rawPng = await customRenderer(file.buffer, pageNumber, config.pdfRenderDpi);
        } else {
          const page = loadedPage ?? (await doc.getPage(pageNumber));
          const renderScale = Math.max(0.5, config.pdfRenderDpi / 72);
          const renderViewport = page.getViewport({ scale: renderScale });
          const { canvas, context } = canvasFactory.create(
            renderViewport.width,
            renderViewport.height,
          );
          try {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({
              canvasContext: context,
              viewport: renderViewport,
              canvas,
            } as unknown as Parameters<typeof page.render>[0]).promise;
            rawPng = canvas.toBuffer("image/png");
          } finally {
            canvasFactory.destroy({ canvas, context });
          }
        }

        let pipeline = sharp(rawPng);
        const meta = await pipeline.metadata();
        const rawW = meta.width ?? 0;
        const rawH = meta.height ?? 0;

        if (!rawW || !rawH) {
          throw new Error("Rendered page image has zero dimensions.");
        }

        if (rawW > config.maxRenderedDimensionPx || rawH > config.maxRenderedDimensionPx) {
          pipeline = pipeline.resize({
            width: config.maxRenderedDimensionPx,
            height: config.maxRenderedDimensionPx,
            fit: "inside",
            withoutEnlargement: true,
          });
        }

        const { data: pngBuffer, info } = await pipeline
          .png()
          .toBuffer({ resolveWithObject: true });

        if (
          info.width < config.minReadableWidthPx ||
          info.height < config.minReadableHeightPx
        ) {
          pageWarnings.push(
            `Rendered page ${pageNumber} has low resolution (${info.width}×${info.height} px); findings may require human review.`,
          );
        }

        const previewBuffer = await sharp(pngBuffer)
          .resize({
            width: config.previewMaxDimensionPx,
            height: config.previewMaxDimensionPx,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png({ compressionLevel: 8 })
          .toBuffer();

        processedPages.push({
          pageNumber,
          width: pageWidth,
          height: pageHeight,
          rotation,
          imageWidth: info.width,
          imageHeight: info.height,
          pngBuffer,
          previewDataUrl: `data:image/png;base64,${previewBuffer.toString("base64")}`,
          embeddedText,
          embeddedSpans,
          status: "ok",
          warnings: pageWarnings,
          originalAssetId: file.assetId,
        });
      } catch (error) {
        processedPages.push({
          pageNumber,
          width: pageWidth,
          height: pageHeight,
          rotation,
          imageWidth: 0,
          imageHeight: 0,
          pngBuffer: Buffer.alloc(0),
          embeddedText,
          embeddedSpans,
          status: "failed",
          error:
            error instanceof Error
              ? `Failed to render PDF page ${pageNumber}: ${error.message}`
              : `Failed to render PDF page ${pageNumber}.`,
          warnings: pageWarnings,
          originalAssetId: file.assetId,
        });
      }
    }
  } finally {
    await doc.cleanup().catch(() => undefined);
    await loadingTask.destroy().catch(() => undefined);
  }

  return {
    totalPageCount,
    pages: processedPages,
    warnings,
  };
}
