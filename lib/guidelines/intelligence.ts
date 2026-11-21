import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import {
  type ManagedKnowledgeSection,
  type StructuredFactMetadata,
} from "@/lib/brand-context";
import {
  getVisualPipelineConfig,
  type VisualPipelineConfig,
} from "@/lib/visual/config";
import { extractPageTextWithOcr } from "@/lib/visual/ocr/extract-text";
import type { CustomOcrRunner } from "@/lib/visual/ocr/types";
import { processPdfCreative } from "@/lib/visual/pdf-processor";
import type { ValidatedCreativeFile } from "@/lib/visual/types";
import { MAX_GUIDELINE_PDF_SIZE_BYTES } from "./pdf-extraction";
import {
  type GuidelinePageExtractionDetail,
  type KnowledgeProposal,
} from "./document-repository";

export type GuidelinePdfIntakeErrorCode =
  | "INVALID_FILE_NAME"
  | "INVALID_FILE_TYPE"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "INVALID_PDF_SIGNATURE"
  | "ENCRYPTED_PDF"
  | "MALFORMED_PDF";

export class GuidelinePdfIntakeError extends Error {
  constructor(
    public readonly code: GuidelinePdfIntakeErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GuidelinePdfIntakeError";
  }
}

export interface OcrPageAdapterInput {
  pdfBuffer: Buffer;
  pageNumber: number;
  config: VisualPipelineConfig;
}

export interface OcrPageAdapterOutput {
  text: string;
  confidence?: number;
  warnings?: string[];
}

export type GuidelineOcrAdapter = (
  input: OcrPageAdapterInput,
) => Promise<OcrPageAdapterOutput>;

export interface ExtractGuidelineIntelligenceOptions {
  enableOcr?: boolean;
  referenceDate?: Date;
  ocrAdapter?: GuidelineOcrAdapter;
  ocrRunner?: CustomOcrRunner;
  pageRenderer?: (
    pdfBuffer: Buffer,
    pageNumber: number,
    dpi: number,
  ) => Promise<Buffer>;
}

export interface GuidelineExtractionIntelligenceResult {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256: string;
  totalPageCount: number;
  ocrUsed: boolean;
  ocrPageCount: number;
  failedPageCount: number;
  pages: GuidelinePageExtractionDetail[];
  warnings: string[];
}

let pdfWorkerReady = false;

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfWorkerReady) {
    const workerPath = path.join(
      process.cwd(),
      "node_modules",
      "pdfjs-dist",
      "legacy",
      "build",
      "pdf.worker.mjs",
    );
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    pdfWorkerReady = true;
  }
  return pdfjs;
}

function getStandardFontDataUrl(): string {
  const fontDir = path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "standard_fonts",
  );
  const href = pathToFileURL(fontDir).href;
  return href.endsWith("/") ? href : `${href}/`;
}

export async function validateGuidelinePdfBuffer(input: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ sha256: string; totalPageCount: number; sanitizedFileName: string }> {
  const sanitizedFileName = path.basename(input.fileName.trim());
  if (!sanitizedFileName) {
    throw new GuidelinePdfIntakeError(
      "INVALID_FILE_NAME",
      "A PDF file name is required.",
    );
  }

  const normalizedMime = input.mimeType.trim().toLowerCase().split(";")[0];
  const ext = path.extname(sanitizedFileName).toLowerCase();
  if (
    ext !== ".pdf" ||
    (normalizedMime &&
      normalizedMime !== "application/pdf" &&
      normalizedMime !== "application/octet-stream")
  ) {
    throw new GuidelinePdfIntakeError(
      "INVALID_FILE_TYPE",
      "Only PDF (.pdf / application/pdf) guideline documents are supported.",
    );
  }

  if (!input.buffer || input.buffer.length === 0) {
    throw new GuidelinePdfIntakeError(
      "EMPTY_FILE",
      "The uploaded guideline PDF file is empty.",
    );
  }

  if (input.buffer.length > MAX_GUIDELINE_PDF_SIZE_BYTES) {
    const maxMb = Math.round(MAX_GUIDELINE_PDF_SIZE_BYTES / (1024 * 1024));
    throw new GuidelinePdfIntakeError(
      "FILE_TOO_LARGE",
      `The guideline PDF exceeds the ${maxMb} MB maximum upload size.`,
    );
  }

  const header = input.buffer
    .subarray(0, Math.min(1024, input.buffer.length))
    .toString("latin1");
  if (!/%PDF-\d\.\d/u.test(header)) {
    throw new GuidelinePdfIntakeError(
      "INVALID_PDF_SIGNATURE",
      "The uploaded file does not contain a valid PDF header signature.",
    );
  }

  let totalPageCount = 0;
  try {
    const pdfDoc = await PDFDocument.load(input.buffer, {
      ignoreEncryption: false,
    });
    totalPageCount = pdfDoc.getPageCount();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/encrypt|password/i.test(msg)) {
      throw new GuidelinePdfIntakeError(
        "ENCRYPTED_PDF",
        "The uploaded PDF is encrypted or password-protected. Please upload an unencrypted guideline PDF.",
        error,
      );
    }
    throw new GuidelinePdfIntakeError(
      "MALFORMED_PDF",
      "The uploaded PDF could not be parsed and appears corrupted or malformed.",
      error,
    );
  }

  if (!Number.isInteger(totalPageCount) || totalPageCount < 1) {
    throw new GuidelinePdfIntakeError(
      "MALFORMED_PDF",
      "The uploaded PDF contains 0 pages.",
    );
  }

  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  return { sha256, totalPageCount, sanitizedFileName };
}

async function runDefaultSelectiveOcr(
  pdfBuffer: Buffer,
  pageNumbers: number[],
  options: ExtractGuidelineIntelligenceOptions,
): Promise<Map<number, OcrPageAdapterOutput>> {
  const results = new Map<number, OcrPageAdapterOutput>();
  if (pageNumbers.length === 0) {
    return results;
  }

  const config = getVisualPipelineConfig({
    maxPdfPages: Math.max(pageNumbers[pageNumbers.length - 1] ?? 1, 20),
  });

  if (options.ocrAdapter) {
    for (const pageNumber of pageNumbers) {
      const out = await options.ocrAdapter({ pdfBuffer, pageNumber, config });
      results.set(pageNumber, out);
    }
    return results;
  }

  const validatedFile: ValidatedCreativeFile = {
    assetId: "guideline-ocr-render",
    fileName: "guideline.pdf",
    format: "pdf",
    detectedMimeType: "application/pdf",
    sizeBytes: pdfBuffer.length,
    buffer: pdfBuffer,
    pdfPageCount: pageNumbers[pageNumbers.length - 1] ?? 1,
  };

  const rendered = await processPdfCreative(validatedFile, config, {
    pageRenderer: options.pageRenderer,
  });

  for (const pageNumber of pageNumbers) {
    const page = rendered.pages.find((p) => p.pageNumber === pageNumber);
    if (!page || page.status !== "ok" || page.pngBuffer.length === 0) {
      results.set(pageNumber, {
        text: "",
        warnings: [
          page?.error ||
            `Page ${pageNumber} could not be rendered for OCR text recovery.`,
        ],
      });
      continue;
    }

    const ocr = await extractPageTextWithOcr(
      {
        pngBuffer: page.pngBuffer,
        pageNumber,
        imageWidth: page.imageWidth,
        imageHeight: page.imageHeight,
        embeddedSpans: page.embeddedSpans,
      },
      {
        config,
        ocrRunner: options.ocrRunner,
      },
    );

    const confidences = ocr.blocks
      .map((b) => b.confidence)
      .filter((c) => typeof c === "number" && Number.isFinite(c));
    const avgConfidence =
      confidences.length > 0
        ? Math.round(
            (confidences.reduce((sum, c) => sum + c, 0) / confidences.length) *
              1000,
          ) / 1000
        : undefined;

    results.set(pageNumber, {
      text: ocr.combinedText,
      confidence: avgConfidence,
      warnings: ocr.warnings,
    });
  }

  return results;
}

export async function extractGuidelineDocumentPages(
  input: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
  },
  options: ExtractGuidelineIntelligenceOptions = {},
): Promise<GuidelineExtractionIntelligenceResult> {
  const { sha256, totalPageCount, sanitizedFileName } =
    await validateGuidelinePdfBuffer(input);

  const enableOcr = options.enableOcr ?? true;
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(input.buffer),
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
    standardFontDataUrl: getStandardFontDataUrl(),
  } as Parameters<typeof pdfjs.getDocument>[0]);

  const pages: GuidelinePageExtractionDetail[] = [];
  const docWarnings: string[] = [];
  const pagesNeedingOcr: number[] = [];

  try {
    const doc = await loadingTask.promise;
    const effectiveTotal = Math.max(totalPageCount, doc.numPages || 0);

    for (let pageNumber = 1; pageNumber <= effectiveTotal; pageNumber += 1) {
      try {
        const page = await doc.getPage(pageNumber);
        const textContent = await page.getTextContent({
          disableNormalization: true,
        });

        let text = "";
        for (const item of textContent.items) {
          if ("str" in item && typeof item.str === "string") {
            text += item.str;
            if (item.hasEOL) {
              text += "\n";
            }
          }
        }
        const trimmed = text.replace(/\r\n/g, "\n").trim();

        if (/\S/u.test(trimmed)) {
          pages.push({
            pageNumber,
            status: "TEXT_EXTRACTED",
            extractionSource: "embedded_text",
            text: trimmed,
            requiresHumanReview: false,
            warnings: [],
          });
        } else {
          pages.push({
            pageNumber,
            status: "NO_EXTRACTABLE_TEXT",
            extractionSource: "none",
            text: "",
            requiresHumanReview: true,
            warnings: [
              `Page ${pageNumber} contained no embedded text layer.`,
            ],
          });
          if (enableOcr) {
            pagesNeedingOcr.push(pageNumber);
          }
        }
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : "Failed to inspect page";
        pages.push({
          pageNumber,
          status: "PAGE_FAILED",
          extractionSource: "failed",
          text: "",
          requiresHumanReview: true,
          warnings: [`Embedded text extraction failed on page ${pageNumber}.`],
          error: errMsg,
        });
        if (enableOcr) {
          pagesNeedingOcr.push(pageNumber);
        }
      }
    }
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }

  let ocrUsed = false;
  let ocrPageCount = 0;

  if (enableOcr && pagesNeedingOcr.length > 0) {
    try {
      const ocrResults = await runDefaultSelectiveOcr(
        input.buffer,
        pagesNeedingOcr,
        options,
      );
      for (const pageNumber of pagesNeedingOcr) {
        const ocrOut = ocrResults.get(pageNumber);
        const idx = pages.findIndex((p) => p.pageNumber === pageNumber);
        if (idx < 0 || !ocrOut) continue;

        const prev = pages[idx]!;
        const cleanText = ocrOut.text.trim();
        if (/\S/u.test(cleanText)) {
          ocrUsed = true;
          ocrPageCount += 1;
          const lowConf =
            typeof ocrOut.confidence === "number" && ocrOut.confidence < 0.72;
          pages[idx] = {
            pageNumber,
            status: "OCR_EXTRACTED",
            extractionSource: "ocr",
            text: cleanText,
            ocrConfidence: ocrOut.confidence,
            requiresHumanReview: true,
            warnings: [
              ...(ocrOut.warnings ?? []),
              lowConf
                ? `Page ${pageNumber} was recovered via OCR with low confidence (${Math.round((ocrOut.confidence ?? 0) * 100)}%). Human verification is required before publishing.`
                : `Page ${pageNumber} text was recovered via OCR from an image/scanned page and requires human verification before publishing.`,
            ],
          };
        } else {
          pages[idx] = {
            ...prev,
            warnings: [
              ...prev.warnings,
              ...(ocrOut.warnings ?? []),
              `No readable text could be recovered on page ${pageNumber} even after OCR.`,
            ],
          };
        }
      }
    } catch (error) {
      docWarnings.push(
        `Selective OCR fallback could not complete for scanned page(s): ${
          error instanceof Error ? error.message : "unknown error"
        }.`,
      );
    }
  }

  const failedPageCount = pages.filter((p) => p.status === "PAGE_FAILED").length;
  const noTextCount = pages.filter(
    (p) => p.status === "NO_EXTRACTABLE_TEXT",
  ).length;

  if (failedPageCount > 0) {
    docWarnings.push(
      `${failedPageCount} page(s) failed extraction and require manual review or source PDF inspection.`,
    );
  }
  if (noTextCount > 0 && !enableOcr) {
    docWarnings.push(
      `${noTextCount} page(s) had no embedded text and OCR fallback was disabled.`,
    );
  }

  return {
    fileName: sanitizedFileName,
    mimeType: "application/pdf",
    fileSizeBytes: input.buffer.length,
    sha256,
    totalPageCount: pages.length,
    ocrUsed,
    ocrPageCount,
    failedPageCount,
    pages,
    warnings: docWarnings,
  };
}

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90 || trimmed.length < 3) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  if (/^(?:section|\d+(?:\.\d+)*)\s*[:.-]?\s+[A-Z]/i.test(trimmed)) return true;
  if (/^[A-Z0-9][A-Z0-9\s/&,-]{2,65}$/.test(trimmed)) return true;
  const words = trimmed.split(/\s+/);
  if (words.length <= 7 && /^[A-Z][a-zA-Z0-9/&,-]*(?:\s+[A-Z0-9][a-zA-Z0-9/&,-]*)*$/.test(trimmed)) {
    return true;
  }
  return false;
}

interface CandidatePassage {
  pageNumber: number;
  sectionRef?: string;
  extractedText: string;
  extractionSource: "embedded_text" | "ocr";
  ocrConfidence?: number;
  requiresHumanReview: boolean;
}

export function segmentPagesIntoCandidatePassages(
  pages: GuidelinePageExtractionDetail[],
): CandidatePassage[] {
  const passages: CandidatePassage[] = [];

  for (const page of pages) {
    if (
      (page.status !== "TEXT_EXTRACTED" && page.status !== "OCR_EXTRACTED") ||
      !page.text.trim()
    ) {
      continue;
    }

    const lines = page.text.replace(/\r\n/g, "\n").split("\n");
    let currentSectionRef: string | undefined;
    let buffer: string[] = [];

    const flush = () => {
      const joined = buffer.join(" ").replace(/\s+/g, " ").trim();
      buffer = [];
      if (joined.length < 12) return;
      passages.push({
        pageNumber: page.pageNumber,
        ...(currentSectionRef ? { sectionRef: currentSectionRef } : {}),
        extractedText: joined,
        extractionSource:
          page.extractionSource === "ocr" ? "ocr" : "embedded_text",
        ...(page.ocrConfidence === undefined
          ? {}
          : { ocrConfidence: page.ocrConfidence }),
        requiresHumanReview: page.requiresHumanReview,
      });
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        flush();
        continue;
      }

      if (isHeadingLine(line) && buffer.length === 0) {
        currentSectionRef = line.replace(/[:\-–]+$/, "").trim();
        continue;
      }

      if (isHeadingLine(line) && buffer.length > 0) {
        flush();
        currentSectionRef = line.replace(/[:\-–]+$/, "").trim();
        continue;
      }

      const isBullet = /^(?:[-•*●]|\d+\.)\s+/.test(line);
      if (isBullet && buffer.length > 0) {
        flush();
      }
      buffer.push(line.replace(/^(?:[-•*●]|\d+\.)\s+/, ""));
    }
    flush();

    // If a non-empty page produced 0 passages (e.g. single heading-like line), preserve it
    if (
      !passages.some((p) => p.pageNumber === page.pageNumber) &&
      page.text.trim().length >= 8
    ) {
      passages.push({
        pageNumber: page.pageNumber,
        extractedText: page.text.replace(/\s+/g, " ").trim(),
        extractionSource:
          page.extractionSource === "ocr" ? "ocr" : "embedded_text",
        ...(page.ocrConfidence === undefined
          ? {}
          : { ocrConfidence: page.ocrConfidence }),
        requiresHumanReview: page.requiresHumanReview,
      });
    }
  }

  return passages;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function parseLooseDate(raw: string): Date | null {
  const trimmed = raw.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const dt = new Date(
      Date.UTC(
        Number(isoMatch[1]),
        Number(isoMatch[2]) - 1,
        Number(isoMatch[3]),
      ),
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const namedMatch = trimmed.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
  );
  if (namedMatch) {
    const month = MONTH_INDEX[namedMatch[1]!.toLowerCase()];
    if (month !== undefined) {
      const dt = new Date(
        Date.UTC(Number(namedMatch[3]), month, Number(namedMatch[2])),
      );
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
  }

  return null;
}

function normalizePriceMatch(text: string): {
  price?: string;
  numericPrice?: number;
  currency?: string;
} {
  const symbolMatch = text.match(
    /(₹|\$|£|€|USD|EUR|GBP|INR)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  );
  if (!symbolMatch) return {};
  const rawSym = symbolMatch[1]!.toUpperCase();
  const currency =
    rawSym === "$"
      ? "USD"
      : rawSym === "£"
        ? "GBP"
        : rawSym === "€"
          ? "EUR"
          : rawSym === "₹"
            ? "INR"
            : rawSym;
  const numericPrice = Number(symbolMatch[2]!.replace(/,/g, ""));
  if (!Number.isFinite(numericPrice)) return {};
  return {
    price: `${symbolMatch[1]}${symbolMatch[2]}`,
    numericPrice,
    currency,
  };
}

export function extractStructuredMetadataFromPassage(
  text: string,
  referenceDate: Date = new Date(),
  sectionRef?: string,
): {
  structuredFacts?: StructuredFactMetadata;
  hexCodes?: string[];
  fontFamily?: string;
  preferredTerm?: string;
  avoidTerm?: string;
  supportingEvidence?: string;
  restrictions?: string[];
} {
  const facts: StructuredFactMetadata = {};

  const priceInfo = normalizePriceMatch(text);
  if (priceInfo.price) {
    facts.price = priceInfo.price;
    facts.numericPrice = priceInfo.numericPrice;
    facts.currency = priceInfo.currency;
  }

  const isoRange = text.match(
    /(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|–|-)\s*(\d{4}-\d{2}-\d{2})/i,
  );
  const namedRange = text.match(
    /([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\s*(?:to|through|until|–|-)\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
  );
  const validUntilOnly = text.match(
    /(?:valid\s+(?:until|through)|expires?\s+(?:on)?|ends?\s+(?:on)?)\s+(\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
  );
  const validFromOnly = text.match(
    /(?:valid\s+from|effective\s+(?:from)?|starts?\s+(?:on)?)\s+(\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
  );

  if (isoRange) {
    facts.validFrom = isoRange[1];
    facts.validUntil = isoRange[2];
    facts.promoPeriod = `${isoRange[1]} to ${isoRange[2]}`;
  } else if (namedRange) {
    facts.validFrom = namedRange[1];
    facts.validUntil = namedRange[2];
    facts.promoPeriod = `${namedRange[1]} to ${namedRange[2]}`;
  } else {
    if (validFromOnly) facts.validFrom = validFromOnly[1];
    if (validUntilOnly) facts.validUntil = validUntilOnly[1];
  }

  if (facts.validUntil) {
    const expiry = parseLooseDate(facts.validUntil);
    if (expiry && expiry.getTime() < referenceDate.getTime()) {
      facts.isExpiredPromo = true;
    }
  }

  const productQuoted = text.match(
    /(?:product|sku|launch|edition|item|plan)\s*(?:name)?\s*[:\-–]\s*([^.,;\n]{2,80})/i,
  );
  if (productQuoted) {
    facts.productName = productQuoted[1]!.trim();
  } else if (priceInfo.price) {
    const beforePrice = text.split(priceInfo.price)[0]?.trim() || "";
    const candidate = beforePrice
      .replace(/^(?:msrp|price|retail price|starting at|for)\s*/i, "")
      .replace(/[:\-–\s]+$/, "")
      .trim();
    if (candidate.length >= 3 && candidate.length <= 70) {
      facts.productName = candidate;
    } else if (sectionRef && sectionRef.length <= 70) {
      facts.productName = sectionRef;
    }
  }

  const disclaimerMatch = text.match(
    /(?:disclaimer|required disclosure|must include disclosure)\s*[:\-–]?\s*([^.\n]{8,240})/i,
  );
  if (disclaimerMatch) {
    facts.disclaimer = disclaimerMatch[1]!.trim();
  }

  const claimMatch = text.match(
    /(?:approved claim|permitted claim)\s*[:\-–]?\s*([^.\n]{6,220})/i,
  );
  if (claimMatch) {
    facts.approvedClaim = claimMatch[1]!.trim();
  }

  let preferredTerm: string | undefined;
  let avoidTerm: string | undefined;

  const preferInstead = text.match(
    /(?:use|say|prefer)\s+["'“]?([^"'”\n]{2,60})["'”]?\s+(?:instead of|rather than|not)\s+["'“]?([^"'”\n.]{2,60})["'”]?/i,
  );
  if (preferInstead) {
    preferredTerm = preferInstead[1]!.trim();
    avoidTerm = preferInstead[2]!.trim();
    facts.preferredTerm = preferredTerm;
    facts.restrictedTerm = avoidTerm;
  } else {
    const prohibitQuoted =
      text.match(
        /(?:never\s+(?:use|say|claim)|avoid|prohibited(?:\s+term|\s+phrase)?|do\s+not\s+(?:say|use|claim)|must\s+not\s+(?:say|use|claim)|ban(?:ned)?)\s*[:\-–]?\s*["'“]([^"'”\n]{2,80})["'”]/i,
      ) ??
      text.match(
        /(?:never\s+(?:use|say|claim)|avoid|prohibited(?:\s+term|\s+phrase)?|do\s+not\s+(?:say|use|claim)|must\s+not\s+(?:say|use|claim)|ban(?:ned)?)\s*[:\-–]\s*([^.\n]{2,80})/i,
      );
    if (prohibitQuoted) {
      avoidTerm = prohibitQuoted[1]!.trim();
      facts.restrictedTerm = avoidTerm;
    }
    const preferredQuoted =
      text.match(
        /(?:preferred(?:\s+term)?|always\s+(?:use|say)|approved\s+term)\s*[:\-–]?\s*["'“]([^"'”\n]{2,80})["'”]/i,
      ) ??
      text.match(
        /(?:preferred(?:\s+term)?|always\s+(?:use|say)|approved\s+term)\s*[:\-–]\s*([^.\n]{2,80})/i,
      );
    if (preferredQuoted) {
      preferredTerm = preferredQuoted[1]!.trim();
      facts.preferredTerm = preferredTerm;
    }
  }

  const hexMatches = [...new Set((text.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toUpperCase()))];
  let fontFamily: string | undefined;
  const fontMatch = text.match(
    /(?:typeface|font(?:\s+family)?|typography)\s*[:\-–]?\s*([A-Za-z0-9][A-Za-z0-9\s-]{2,40})/i,
  );
  if (fontMatch) {
    fontFamily = fontMatch[1]!.split(/[.,;\n]/)[0]?.trim();
  }

  let supportingEvidence: string | undefined;
  const evidenceMatch = text.match(
    /(?:evidence|study|source|basis|substantiated by)\s*[:\-–]\s*([^.\n]{6,220})/i,
  );
  if (evidenceMatch) {
    supportingEvidence = evidenceMatch[1]!.trim();
  }

  const restrictions: string[] = [];
  if (facts.isExpiredPromo) {
    restrictions.push(`Promotional window expired (${facts.validUntil}).`);
  }
  if (facts.disclaimer) {
    restrictions.push(`Requires disclaimer: ${facts.disclaimer}`);
  }

  const hasAnyFact = Object.keys(facts).length > 0;
  return {
    ...(hasAnyFact ? { structuredFacts: facts } : {}),
    ...(hexMatches.length > 0 ? { hexCodes: hexMatches } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(preferredTerm ? { preferredTerm } : {}),
    ...(avoidTerm ? { avoidTerm } : {}),
    ...(supportingEvidence ? { supportingEvidence } : {}),
    ...(restrictions.length > 0 ? { restrictions } : {}),
  };
}

export function classifyPassageIntoKnowledgeCategory(input: {
  text: string;
  sectionRef?: string;
  structured: ReturnType<typeof extractStructuredMetadataFromPassage>;
  ocrConfidence?: number;
  extractionSource: "embedded_text" | "ocr";
}): {
  suggestedCategory: ManagedKnowledgeSection;
  classificationUncertain: boolean;
  uncertaintyReason?: string;
  requiresHumanReview: boolean;
  severity: "high" | "medium" | "low";
} {
  const combined = `${input.sectionRef ?? ""} ${input.text}`.toLowerCase();
  const scores: Record<ManagedKnowledgeSection, number> = {
    guidelines: 0,
    facts: 0,
    terminology: 0,
    prohibited: 0,
    voice: 0,
    visual: 0,
    policies: 0,
  };

  if (
    (input.structured.hexCodes && input.structured.hexCodes.length > 0) ||
    input.structured.fontFamily ||
    /\b(?:hex|palette|colour|color|logo|clear\s*space|typography|typeface|aspect ratio|margin|watermark|lockup|visual)\b/i.test(
      combined,
    )
  ) {
    scores.visual += 3;
    if (input.structured.hexCodes?.length || input.structured.fontFamily) {
      scores.visual += 2;
    }
  }

  if (
    /\b(?:prohibited|forbidden|never say|never use|do not use|do not claim|banned|zero tolerance|unsubstantiated|cannot claim|must not)\b/i.test(
      combined,
    ) ||
    (input.structured.avoidTerm && !input.structured.preferredTerm)
  ) {
    scores.prohibited += 3;
    if (/\b(?:banned|prohibited|forbidden|never)\b/i.test(combined)) {
      scores.prohibited += 1;
    }
  }

  if (
    /\b(?:terminology|preferred term|spelling|capitali[sz]e|hyphen|instead of|glossary|naming|nomenclature)\b/i.test(
      combined,
    ) ||
    (input.structured.preferredTerm && input.structured.avoidTerm)
  ) {
    scores.terminology += 3;
    if (input.structured.preferredTerm && input.structured.avoidTerm) {
      scores.terminology += 2;
    }
  }

  if (
    input.structured.structuredFacts?.price ||
    input.structured.structuredFacts?.validUntil ||
    input.structured.structuredFacts?.validFrom ||
    input.structured.structuredFacts?.approvedClaim ||
    /\b(?:price|msrp|sku|specification|spec|launch date|valid until|promo|promotion|discount|retail|ingredients|calories|volume|ml|grams)\b/i.test(
      combined,
    )
  ) {
    scores.facts += 3;
    if (
      input.structured.structuredFacts?.price ||
      input.structured.structuredFacts?.validUntil
    ) {
      scores.facts += 2;
    }
  }

  if (
    /\b(?:voice|tone|warm|empathetic|conversational|formal|editorial|sentence length|active voice|reading level|brand personality)\b/i.test(
      combined,
    )
  ) {
    scores.voice += 3;
  }

  if (
    /\b(?:policy|legal|compliance|ftc|fda|gdpr|copyright|trademark|disclaimer|disclosure|privacy|terms and conditions|age gate)\b/i.test(
      combined,
    ) ||
    Boolean(input.structured.structuredFacts?.disclaimer)
  ) {
    scores.policies += 3;
  }

  if (
    /\b(?:guideline|rule|standard|recommendation|best practice|communication|must include|should always)\b/i.test(
      combined,
    )
  ) {
    scores.guidelines += 2;
  }

  const ranked = (Object.entries(scores) as Array<[ManagedKnowledgeSection, number]>)
    .sort((a, b) => b[1] - a[1]);
  const [topCategory, topScore] = ranked[0]!;
  const [secondCategory, secondScore] = ranked[1]!;

  let suggestedCategory: ManagedKnowledgeSection =
    topScore > 0 ? topCategory : "guidelines";
  let classificationUncertain = false;
  const reasons: string[] = [];

  if (topScore === 0) {
    classificationUncertain = true;
    suggestedCategory = "guidelines";
    reasons.push(
      "No unambiguous category keywords matched this passage; please verify the target category.",
    );
  } else if (secondScore > 0 && topScore - secondScore <= 1) {
    classificationUncertain = true;
    reasons.push(
      `Signals overlap between "${topCategory}" and "${secondCategory}"; confirm the primary category before publishing.`,
    );
  }

  if (input.extractionSource === "ocr") {
    if (typeof input.ocrConfidence === "number" && input.ocrConfidence < 0.72) {
      classificationUncertain = true;
      reasons.push(
        `Recovered from OCR with low confidence (${Math.round(input.ocrConfidence * 100)}%); inspect extracted wording closely.`,
      );
    } else {
      reasons.push(
        "Text was recovered via OCR from an image/scanned page; verify accuracy before publishing.",
      );
    }
  }

  const severity: "high" | "medium" | "low" =
    suggestedCategory === "prohibited" || suggestedCategory === "policies"
      ? "high"
      : suggestedCategory === "facts" || suggestedCategory === "visual"
        ? "medium"
        : "medium";

  return {
    suggestedCategory,
    classificationUncertain,
    ...(reasons.length > 0 ? { uncertaintyReason: reasons.join(" ") } : {}),
    requiresHumanReview:
      classificationUncertain || input.extractionSource === "ocr",
    severity,
  };
}

function deriveProposalTitle(
  text: string,
  sectionRef: string | undefined,
  category: ManagedKnowledgeSection,
  structured: ReturnType<typeof extractStructuredMetadataFromPassage>,
): string {
  if (structured.structuredFacts?.productName && structured.structuredFacts?.price) {
    return `${structured.structuredFacts.productName} (${structured.structuredFacts.price})`.slice(
      0,
      140,
    );
  }
  if (sectionRef && sectionRef.length >= 3) {
    const firstWords = text.split(/\s+/).slice(0, 8).join(" ");
    const candidate = `${sectionRef}: ${firstWords}`.replace(/[.,;:]+$/, "");
    return candidate.slice(0, 140);
  }
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  const compact = firstSentence.replace(/\s+/g, " ").trim();
  if (compact.length >= 4 && compact.length <= 95) {
    return compact.replace(/[.,;:]+$/, "");
  }
  return `${category.charAt(0).toUpperCase() + category.slice(1)} rule: ${compact.slice(0, 75)}...`;
}

export function buildKnowledgeProposalsFromPages(input: {
  documentId: string;
  brandId: string;
  organisationId: string;
  pages: GuidelinePageExtractionDetail[];
  referenceDate?: Date;
}): KnowledgeProposal[] {
  const passages = segmentPagesIntoCandidatePassages(input.pages);
  const now = new Date().toISOString();

  return passages.map((passage) => {
    const structured = extractStructuredMetadataFromPassage(
      passage.extractedText,
      input.referenceDate,
      passage.sectionRef,
    );
    const classification = classifyPassageIntoKnowledgeCategory({
      text: passage.extractedText,
      sectionRef: passage.sectionRef,
      structured,
      ocrConfidence: passage.ocrConfidence,
      extractionSource: passage.extractionSource,
    });
    const title = deriveProposalTitle(
      passage.extractedText,
      passage.sectionRef,
      classification.suggestedCategory,
      structured,
    );

    return {
      proposalId: `prop-${randomUUID()}`,
      documentId: input.documentId,
      brandId: input.brandId,
      organisationId: input.organisationId,
      extractedText: passage.extractedText,
      title,
      content: passage.extractedText,
      suggestedCategory: classification.suggestedCategory,
      category: classification.suggestedCategory,
      classificationUncertain: classification.classificationUncertain,
      ...(classification.uncertaintyReason
        ? { uncertaintyReason: classification.uncertaintyReason }
        : {}),
      requiresHumanReview:
        passage.requiresHumanReview || classification.requiresHumanReview,
      extractionSource: passage.extractionSource,
      ...(passage.ocrConfidence === undefined
        ? {}
        : { ocrConfidence: passage.ocrConfidence }),
      pageNumber: passage.pageNumber,
      ...(passage.sectionRef ? { sectionRef: passage.sectionRef } : {}),
      ...(structured.structuredFacts
        ? { structuredFacts: structured.structuredFacts }
        : {}),
      ...(structured.preferredTerm
        ? { preferredTerm: structured.preferredTerm }
        : {}),
      ...(structured.avoidTerm ? { avoidTerm: structured.avoidTerm } : {}),
      ...(structured.hexCodes ? { hexCodes: structured.hexCodes } : {}),
      ...(structured.fontFamily ? { fontFamily: structured.fontFamily } : {}),
      ...(structured.supportingEvidence
        ? { supportingEvidence: structured.supportingEvidence }
        : {}),
      ...(structured.restrictions
        ? { restrictions: structured.restrictions }
        : {}),
      severity: classification.severity,
      status: "pending_review",
      conflictStatus: "no_conflict",
      conflictResolution: "unresolved",
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function createManualProposalFromPassage(input: {
  documentId: string;
  brandId: string;
  organisationId: string;
  extractedText: string;
  pageNumber: number;
  sectionRef?: string;
  category?: ManagedKnowledgeSection;
  title?: string;
  referenceDate?: Date;
}): KnowledgeProposal {
  const cleanText = input.extractedText.trim();
  const structured = extractStructuredMetadataFromPassage(
    cleanText,
    input.referenceDate,
    input.sectionRef,
  );
  const classification = classifyPassageIntoKnowledgeCategory({
    text: cleanText,
    sectionRef: input.sectionRef,
    structured,
    extractionSource: "embedded_text",
  });
  const chosenCategory = input.category ?? classification.suggestedCategory;
  const now = new Date().toISOString();

  return {
    proposalId: `prop-${randomUUID()}`,
    documentId: input.documentId,
    brandId: input.brandId,
    organisationId: input.organisationId,
    extractedText: cleanText,
    title:
      input.title?.trim() ||
      deriveProposalTitle(cleanText, input.sectionRef, chosenCategory, structured),
    content: cleanText,
    suggestedCategory: classification.suggestedCategory,
    category: chosenCategory,
    classificationUncertain: classification.classificationUncertain,
    ...(classification.uncertaintyReason
      ? { uncertaintyReason: classification.uncertaintyReason }
      : {}),
    requiresHumanReview: false,
    extractionSource: "manual_selection",
    pageNumber: input.pageNumber,
    ...(input.sectionRef?.trim()
      ? { sectionRef: input.sectionRef.trim() }
      : {}),
    ...(structured.structuredFacts
      ? { structuredFacts: structured.structuredFacts }
      : {}),
    ...(structured.preferredTerm
      ? { preferredTerm: structured.preferredTerm }
      : {}),
    ...(structured.avoidTerm ? { avoidTerm: structured.avoidTerm } : {}),
    ...(structured.hexCodes ? { hexCodes: structured.hexCodes } : {}),
    ...(structured.fontFamily ? { fontFamily: structured.fontFamily } : {}),
    ...(structured.supportingEvidence
      ? { supportingEvidence: structured.supportingEvidence }
      : {}),
    ...(structured.restrictions
      ? { restrictions: structured.restrictions }
      : {}),
    severity: classification.severity,
    status: "pending_review",
    conflictStatus: "no_conflict",
    conflictResolution: "unresolved",
    createdAt: now,
    updatedAt: now,
  };
}
