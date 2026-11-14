import type { BrandKnowledgeRecord } from "../brand-context/types";
import type { BrandContext } from "../contracts";
import {
  adaptBrandContextToVisualContext,
  adaptBrandKnowledgeToVisualContext,
} from "./brand-context-adapter";
import { runColourCheck } from "./checks/colour-check";
import { runLayoutCheck } from "./checks/layout-check";
import { runLogoCheck } from "./checks/logo-check";
import { runTypographyCheck } from "./checks/typography-check";
import { getVisualPipelineConfig } from "./config";
import { processCreativeFile } from "./creative-processor";
import {
  deduplicateVisualFindings,
  mapVisualFindingsToCanonical,
} from "./evidence/evidence-mapper";
import { VisualPipelineLogger } from "./logger";
import { extractPageTextWithOcr } from "./ocr";
import { VisualFindingSchema } from "./schemas";
import {
  type BrandVisualContext,
  type CreativeFileInput,
  type OcrBlock,
  type VisualAnalysisDependencies,
  type VisualAnalysisResult,
  type VisualFinding,
  type VisualObservation,
  VisualValidationError,
} from "./types";
import { GeminiVisionError } from "./vision/gemini-vision";
import {
  createResilientVisionAdapterFromEnvironment,
  ResilientVisionAdapter,
} from "./vision/resilient-vision";

export interface AnalyzeCreativeVisuallyInput {
  creative: CreativeFileInput;
  brandVisualContext?: BrandVisualContext;
  brandKnowledgeRecord?: BrandKnowledgeRecord;
  brandContext?: BrandContext;
  reviewId: string;
  analysisRunId: string;
  dependencies?: VisualAnalysisDependencies;
}

export async function analyzeCreativeVisually(
  input: AnalyzeCreativeVisuallyInput,
): Promise<VisualAnalysisResult> {
  const deps = input.dependencies ?? {};
  const config = getVisualPipelineConfig(deps.config);
  const logger = new VisualPipelineLogger({
    analysisRunId: input.analysisRunId,
    reviewId: input.reviewId,
    creativeId: input.creative.assetId,
  });

  // 1. Resolve BrandVisualContext
  const brandVisualContext: BrandVisualContext =
    input.brandVisualContext ??
    (input.brandKnowledgeRecord
      ? adaptBrandKnowledgeToVisualContext(input.brandKnowledgeRecord)
      : input.brandContext
        ? adaptBrandContextToVisualContext(input.brandContext)
        : {
            brandId: "unknown",
            brandName: "Unknown",
            guidelineVersion: "1.0",
            approved: false,
            approvedPalette: [],
            approvedLogos: [],
            logoRequired: false,
            typographyRequirements: [],
            layoutRequirements: [],
            requiredVisualElements: [],
            prohibitedVisualStyles: [],
            rules: [],
            validSourceIds: [],
            validVersions: [],
            hasVisualKnowledge: false,
            warnings: ["NO_BRAND_VISUAL_CONTEXT"],
          });

  const warnings: string[] = [...brandVisualContext.warnings];
  const errors: string[] = [];

  logger.info("validate", "Starting visual creative validation", {
    metrics: { fileName: input.creative.fileName },
  });

  // 2. Validate & process creative pages
  let processingOutput;
  try {
    processingOutput = await processCreativeFile(input.creative, deps);
  } catch (error) {
    const message =
      error instanceof VisualValidationError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Creative file validation failed.";
    logger.error("validate", message);
    throw error;
  }

  warnings.push(...processingOutput.warnings);
  const { validatedFile, totalPageCount, pages } = processingOutput;

  logger.info("pages", "Processed creative pages", {
    metrics: {
      fileFormat: validatedFile.format,
      fileSizeBytes: validatedFile.sizeBytes,
      pageCount: totalPageCount,
      processedPageCount: pages.length,
    },
  });

  const allOcrBlocks: OcrBlock[] = [];
  const allObservations: VisualObservation[] = [];
  const rawVisualFindings: VisualFinding[] = [];

  let ocrDurationMs = 0;
  let deterministicDurationMs = 0;
  let geminiDurationMs = 0;
  let geminiRetryCount = 0;
  let validationFailureCount = 0;
  let partialPageFailureCount = 0;
  let visionStageFailed = false;
  let visionProviderUsed: string | undefined;

  const visionAdapter =
    deps.visionAdapter === undefined
      ? createResilientVisionAdapterFromEnvironment(validatedFile.assetId, {
          geminiTimeoutMs: config.geminiVisionTimeoutMs,
          geminiMaxRetries: config.geminiVisionMaxRetries,
          openrouterTimeoutMs: config.openrouterVisionTimeoutMs,
          onFallbackAttempt: ({ pageNumber, primaryProvider, fallbackProvider, reason }) => {
            logger.warn(
              "vision-fallback",
              `Primary vision provider (${primaryProvider}) failed on page ${pageNumber}; falling back to ${fallbackProvider}: ${reason}`,
              { pageNumber },
            );
            warnings.push(
              `Page ${pageNumber}: Primary vision provider (${primaryProvider}) failed (${reason}); recovered using fallback vision provider (${fallbackProvider}).`,
            );
          },
        })
      : deps.visionAdapter;

  if (
    visionAdapter &&
    "hasConfiguredProvider" in visionAdapter &&
    !(visionAdapter as ResilientVisionAdapter).hasConfiguredProvider
  ) {
    warnings.push(
      "Neither GEMINI_API_KEY nor OPENROUTER_API_KEY is configured for vision analysis; ran OCR and deterministic visual checks only.",
    );
  } else if (!visionAdapter) {
    warnings.push(
      "Vision model disabled; ran OCR and deterministic visual checks only.",
    );
  }

  // 3. Per-page OCR + deterministic visual checks + Gemini Vision
  for (const page of pages) {
    warnings.push(...page.warnings);

    if (page.status === "failed") {
      partialPageFailureCount++;
      const errMsg = page.error ?? `Page ${page.pageNumber} failed to render.`;
      errors.push(errMsg);
      logger.warn("page-render", errMsg, { pageNumber: page.pageNumber });
      continue;
    }

    // 3a. OCR + PDF embedded text deduplication
    const ocrResult = await extractPageTextWithOcr(
      {
        pageNumber: page.pageNumber,
        imageWidth: page.imageWidth,
        imageHeight: page.imageHeight,
        pngBuffer: page.pngBuffer,
        embeddedSpans: page.embeddedSpans,
        embeddedText: page.embeddedText,
      },
      { config, ocrRunner: deps.ocrRunner },
    );
    ocrDurationMs += ocrResult.durationMs;
    warnings.push(...ocrResult.warnings);
    allOcrBlocks.push(...ocrResult.blocks);

    logger.info("ocr", "Extracted page text blocks", {
      pageNumber: page.pageNumber,
      metrics: {
        ocrBlockCount: ocrResult.blocks.length,
        uncertainBlockCount: ocrResult.uncertainBlockCount,
        ocrDurationMs: ocrResult.durationMs,
      },
    });

    if (ocrResult.blocks.length === 0) {
      allObservations.push({
        pageNumber: page.pageNumber,
        detector: "ocr",
        summary: "No readable text detected on this page.",
      });
    }

    // 3b. Deterministic colour, logo, typography, and layout checks
    const detStart = Date.now();
    let pageDetObservations: string[] = [];

    if (brandVisualContext.hasVisualKnowledge && brandVisualContext.approved) {
      const colourRes = await runColourCheck(page, brandVisualContext, config);
      const logoRes = await runLogoCheck(
        page,
        ocrResult.blocks,
        brandVisualContext,
        config,
      );
      const typoRes = await runTypographyCheck(
        page,
        ocrResult.blocks,
        brandVisualContext,
        config,
      );
      const layoutRes = runLayoutCheck(
        page,
        ocrResult.blocks,
        logoRes.detectedLogoBoxes,
        brandVisualContext,
      );

      rawVisualFindings.push(
        ...colourRes.findings,
        ...logoRes.findings,
        ...typoRes.findings,
        ...layoutRes.findings,
      );
      const pageObs = [
        ...colourRes.observations,
        ...logoRes.observations,
        ...typoRes.observations,
        ...layoutRes.observations,
      ];
      allObservations.push(...pageObs);
      pageDetObservations = pageObs.map((o) => o.summary);
    } else {
      allObservations.push({
        pageNumber: page.pageNumber,
        detector: "deterministic-visual",
        summary: "Skipped brand visual checks: no approved brand visual knowledge supplied.",
      });
    }

    const pageDetMs = Date.now() - detStart;
    deterministicDurationMs += pageDetMs;

    logger.info("deterministic-checks", "Completed deterministic visual checks", {
      pageNumber: page.pageNumber,
      metrics: {
        deterministicDurationMs: pageDetMs,
        imageWidth: page.imageWidth,
        imageHeight: page.imageHeight,
      },
    });

    // 3c. Gemini Vision contextual interpretation
    if (visionAdapter && brandVisualContext.hasVisualKnowledge && brandVisualContext.approved) {
      const gemStart = Date.now();
      try {
        const visionOut = await visionAdapter.analyzePage({
          pageNumber: page.pageNumber,
          imageWidth: page.imageWidth,
          imageHeight: page.imageHeight,
          pngBuffer: page.pngBuffer,
          ocrBlocks: ocrResult.blocks,
          deterministicObservations: pageDetObservations,
          brandContext: brandVisualContext,
        });
        const elapsed = Date.now() - gemStart;
        geminiDurationMs += elapsed;
        geminiRetryCount += visionOut.retryCount;
        validationFailureCount += visionOut.validationFailures;
        const usedProvider =
          "providerUsed" in visionOut && typeof visionOut.providerUsed === "string"
            ? visionOut.providerUsed
            : `${visionAdapter.providerName}:${visionAdapter.modelName}`;
        visionProviderUsed = usedProvider;
        rawVisualFindings.push(...visionOut.findings);

        logger.info("gemini-vision", "Completed AI Vision page analysis", {
          pageNumber: page.pageNumber,
          metrics: {
            geminiProvider: visionAdapter.providerName,
            geminiModel: visionAdapter.modelName,
            geminiDurationMs: elapsed,
            retryCount: visionOut.retryCount,
            validationFailures: visionOut.validationFailures,
            candidateCount: visionOut.findings.length,
            providerUsed: usedProvider,
          },
        });
      } catch (error) {
        const elapsed = Date.now() - gemStart;
        geminiDurationMs += elapsed;
        visionStageFailed = true;
        const safeErr =
          error instanceof GeminiVisionError
            ? `AI visual interpretation unavailable (${error.code}): ${error.message}`
            : error instanceof Error
              ? `AI visual interpretation unavailable: ${error.message}`
              : "AI visual interpretation could not be completed.";
        errors.push(safeErr);
        warnings.push(
          `Page ${page.pageNumber}: ${safeErr} Deterministic visual checks and OCR results were preserved.`,
        );
        logger.warn("gemini-vision", safeErr, {
          pageNumber: page.pageNumber,
          metrics: {
            geminiProvider: visionAdapter.providerName,
            geminiModel: visionAdapter.modelName,
            geminiDurationMs: elapsed,
          },
        });
      }
    }
  }

  // 4. Validate & deduplicate findings
  const validatedFindings: VisualFinding[] = [];
  for (const finding of rawVisualFindings) {
    const parsed = VisualFindingSchema.safeParse(finding);
    if (parsed.success) {
      validatedFindings.push(parsed.data);
    } else {
      validationFailureCount++;
    }
  }

  const dedupedFindings = deduplicateVisualFindings(validatedFindings);
  const canonicalFindings = mapVisualFindingsToCanonical(dedupedFindings);

  const processedOkCount = pages.filter((p) => p.status === "ok").length;
  let finalStatus: VisualAnalysisResult["status"] = "COMPLETED";
  if (processedOkCount === 0 && pages.length > 0) {
    finalStatus = "FAILED";
  } else if (
    partialPageFailureCount > 0 ||
    visionStageFailed ||
    !brandVisualContext.hasVisualKnowledge ||
    totalPageCount > config.maxPdfPages
  ) {
    finalStatus = "PARTIAL";
  }

  const extractedText = allOcrBlocks
    .map((b) => b.text)
    .join("\n")
    .trim();

  const uncertainFindingCount = dedupedFindings.filter(
    (f) => f.reviewStatus !== "candidate",
  ).length;

  const diagnostics = {
    reviewId: input.reviewId,
    analysisRunId: input.analysisRunId,
    creativeId: validatedFile.assetId,
    fileFormat: validatedFile.format,
    fileSizeBytes: validatedFile.sizeBytes,
    pageCount: totalPageCount,
    processedPageCount: processedOkCount,
    ocrBlockCount: allOcrBlocks.length,
    ocrDurationMs,
    deterministicDurationMs,
    geminiProvider: visionAdapter?.providerName,
    geminiModel: visionAdapter?.modelName,
    geminiDurationMs,
    geminiRetryCount,
    candidateFindingCount: dedupedFindings.length,
    uncertainFindingCount,
    validationFailureCount,
    partialPageFailureCount,
    finalStatus,
  };

  logger.info("complete", "Visual analysis finished", {
    metrics: diagnostics as unknown as Record<string, unknown>,
  });

  return {
    status: finalStatus,
    creativeMetadata: {
      assetId: validatedFile.assetId,
      fileName: validatedFile.fileName,
      format: validatedFile.format,
      mimeType: validatedFile.detectedMimeType,
      sizeBytes: validatedFile.sizeBytes,
      pageCount: totalPageCount,
      processedPageCount: processedOkCount,
    },
    pages: pages.map((p) => ({
      pageNumber: p.pageNumber,
      width: p.width,
      height: p.height,
      rotation: p.rotation,
      imageWidth: p.imageWidth,
      imageHeight: p.imageHeight,
      status: p.status,
      ...(p.error ? { error: p.error } : {}),
      ...(p.previewDataUrl ? { previewDataUrl: p.previewDataUrl } : {}),
      originalAssetId: p.originalAssetId,
    })),
    ocrBlocks: allOcrBlocks,
    extractedText,
    observations: allObservations,
    visualFindings: dedupedFindings,
    canonicalFindings,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
    visionProviderUsed,
    diagnostics,
  };
}
