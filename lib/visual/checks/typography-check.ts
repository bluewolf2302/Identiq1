import sharp from "sharp";
import type { VisualPipelineConfig } from "../config";
import type {
  BrandVisualContext,
  OcrBlock,
  ProcessedPage,
  VisualFinding,
  VisualObservation,
} from "../types";

function relativeLuminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function normalizeFontName(raw: string): string {
  return raw
    .replace(/^[A-Z]{6}\+/, "") // Strip PDF subset prefix like ABCDEF+Manrope-Bold
    .replace(/[-_,].*$/, "")
    .trim();
}

export async function runTypographyCheck(
  page: ProcessedPage,
  pageOcrBlocks: OcrBlock[],
  brandContext: BrandVisualContext,
  config: VisualPipelineConfig,
): Promise<{
  findings: VisualFinding[];
  observations: VisualObservation[];
}> {
  if (page.status !== "ok") {
    return { findings: [], observations: [] };
  }

  const findings: VisualFinding[] = [];
  const observations: VisualObservation[] = [];

  const typoRule =
    brandContext.rules.find((r) => r.category === "typography") ??
    brandContext.rules[0];
  const lowResolution =
    page.imageWidth < config.minReadableWidthPx ||
    page.imageHeight < config.minReadableHeightPx;

  // 1. Low-resolution / unreadable text warning (never pretend exact font ID on raster)
  if (lowResolution) {
    findings.push({
      id: `vis-typo-lowres-p${page.pageNumber}`,
      ruleId: "IMG-04",
      category: "typography",
      title: `Low-resolution creative (${page.imageWidth}×${page.imageHeight} px) limits text & font verification`,
      explanation: `Page ${page.pageNumber} resolution is below ${config.minReadableWidthPx}×${config.minReadableHeightPx} px. Font identification and fine typography legibility cannot be reliably verified automatically.`,
      expectedValue: "Sharp, high-resolution asset with readable typography",
      observedValue: `${page.imageWidth}×${page.imageHeight} px rendered creative`,
      sourceReference: {
        sourceId: typoRule?.sourceId ?? null,
        sourceVersion: typoRule?.sourceVersion ?? null,
        sourceTitle: typoRule?.sourceTitle ?? null,
        pageNumber: typoRule?.pageNumber ?? null,
        excerpt: typoRule?.excerpt ?? null,
      },
      creativeEvidence: {
        assetId: page.originalAssetId,
        pageNumber: page.pageNumber,
        boundingBox: null,
        description: `Low-resolution image dimensions (${page.imageWidth}×${page.imageHeight} px) on page ${page.pageNumber}`,
      },
      confidence: 0.9,
      reviewStatus: "needs_human_review",
      severity: "MEDIUM",
      detector: "deterministic",
      classification: "possible_mismatch",
      suggestedCorrection: "Supply a higher-resolution creative asset and inspect text legibility manually.",
    });
  }

  // 2. Embedded PDF font family check (ONLY when PDF embedded font metadata exists!)
  if (page.embeddedSpans.length > 0 && brandContext.typographyRequirements.length > 0) {
    const allowedFontKeywords = brandContext.typographyRequirements
      .flatMap((req) => req.match(/\b(Manrope|Inter|DM Sans|Plus Jakarta Sans|Helvetica|Arial|Roboto|Montserrat|Lato|Open Sans)\b/gi) ?? [])
      .map((f) => f.toLowerCase());

    const observedFonts = new Set<string>();
    const mismatchedSpans = [];

    for (const span of page.embeddedSpans) {
      if (!span.fontFamily) continue;
      const cleanFont = normalizeFontName(span.fontFamily);
      if (!cleanFont || /^g_d\d+_f\d+$/i.test(cleanFont)) continue; // skip generic PDF internal font IDs
      observedFonts.add(cleanFont);

      if (
        allowedFontKeywords.length > 0 &&
        !allowedFontKeywords.some((allowed) => cleanFont.toLowerCase().includes(allowed))
      ) {
        mismatchedSpans.push({ span, cleanFont });
      }
    }

    observations.push({
      pageNumber: page.pageNumber,
      detector: "deterministic-typography",
      summary: `Extracted ${observedFonts.size} named PDF font family/families: ${
        [...observedFonts].join(", ") || "generic/embedded outlines"
      }.`,
    });

    if (mismatchedSpans.length > 0) {
      const first = mismatchedSpans[0]!;
      const distinctMismatched = [...new Set(mismatchedSpans.map((m) => m.cleanFont))];
      findings.push({
        id: `vis-typo-font-p${page.pageNumber}`,
        ruleId: typoRule?.ruleId ?? "TYPOGRAPHY",
        category: "typography",
        title: `PDF text uses ${distinctMismatched.join(", ")} instead of approved brand typeface`,
        explanation: `PDF embedded font metadata reports ${distinctMismatched.join(
          ", ",
        )}, which differs from the approved typography guideline (${brandContext.typographyRequirements.join(
          "; ",
        )}).`,
        expectedValue: brandContext.typographyRequirements.join("; "),
        observedValue: `Embedded PDF font(s): ${distinctMismatched.join(", ")}`,
        sourceReference: {
          sourceId: typoRule?.sourceId ?? null,
          sourceVersion: typoRule?.sourceVersion ?? null,
          sourceTitle: typoRule?.sourceTitle ?? null,
          pageNumber: typoRule?.pageNumber ?? null,
          excerpt: typoRule?.excerpt ?? null,
        },
        creativeEvidence: {
          assetId: page.originalAssetId,
          pageNumber: page.pageNumber,
          boundingBox: first.span.boundingBox,
          description: `PDF text span "${first.span.text}" rendered with font "${first.cleanFont}" on page ${page.pageNumber}`,
        },
        confidence: 0.9,
        reviewStatus: "candidate",
        severity: "LOW",
        detector: "deterministic",
        classification: "objective_mismatch",
        suggestedCorrection: `Update typography to the approved brand fonts (${brandContext.typographyRequirements.join(
          " / ",
        )}).`,
      });
    }
  } else if (page.embeddedSpans.length === 0 && brandContext.typographyRequirements.length > 0) {
    observations.push({
      pageNumber: page.pageNumber,
      detector: "deterministic-typography",
      summary: "Raster/flattened page: skipped exact font-family assertion (requires human review if font verification is required).",
    });
  }

  // 3. Text contrast / readability check on prominent OCR text blocks (IMG-08)
  if (page.pngBuffer.length > 0 && pageOcrBlocks.length > 0 && !lowResolution) {
    let worstContrast: {
      block: OcrBlock;
      ratio: number;
    } | null = null;

    for (const block of pageOcrBlocks.slice(0, 12)) {
      if (block.uncertain || block.boundingBox.width < 0.03 || block.boundingBox.height < 0.012) {
        continue;
      }
      const left = Math.max(0, Math.floor(block.boundingBox.x * page.imageWidth));
      const top = Math.max(0, Math.floor(block.boundingBox.y * page.imageHeight));
      const width = Math.max(4, Math.min(page.imageWidth - left, Math.floor(block.boundingBox.width * page.imageWidth)));
      const height = Math.max(4, Math.min(page.imageHeight - top, Math.floor(block.boundingBox.height * page.imageHeight)));

      const { data } = await sharp(page.pngBuffer)
        .extract({ left, top, width, height })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const lums: number[] = [];
      for (let i = 0; i < data.length; i += 3) {
        lums.push(relativeLuminance(data[i]!, data[i + 1]!, data[i + 2]!));
      }
      if (lums.length < 16) continue;
      lums.sort((a, b) => a - b);
      // 10th percentile vs 90th percentile estimates text stroke vs background luminance
      const lowLum = lums[Math.floor(lums.length * 0.08)]!;
      const highLum = lums[Math.floor(lums.length * 0.92)]!;
      const ratio = contrastRatio(highLum, lowLum);

      const isLargeText = block.boundingBox.height >= 0.032;
      const minRequired = isLargeText ? 3.0 : 4.5;
      if (ratio < minRequired && (!worstContrast || ratio < worstContrast.ratio)) {
        worstContrast = { block, ratio };
      }
    }

    if (worstContrast) {
      const ratioStr = worstContrast.ratio.toFixed(2);
      findings.push({
        id: `vis-typo-contrast-p${page.pageNumber}`,
        ruleId: "IMG-08",
        category: "typography",
        title: `Low text contrast (${ratioStr}:1) may impair readability`,
        explanation: `Text region "${worstContrast.block.text.slice(
          0,
          48,
        )}" measured an estimated luminance contrast ratio of ${ratioStr}:1, below the WCAG accessibility target (4.5:1 normal / 3:1 large text).`,
        expectedValue: "At least 4.5:1 contrast for normal text and 3:1 for large text",
        observedValue: `Estimated contrast ratio ${ratioStr}:1`,
        sourceReference: {
          sourceId: typoRule?.sourceId ?? null,
          sourceVersion: typoRule?.sourceVersion ?? null,
          sourceTitle: typoRule?.sourceTitle ?? null,
          pageNumber: typoRule?.pageNumber ?? null,
          excerpt: typoRule?.excerpt ?? null,
        },
        creativeEvidence: {
          assetId: page.originalAssetId,
          pageNumber: page.pageNumber,
          boundingBox: worstContrast.block.boundingBox,
          description: `Text contrast measurement on "${worstContrast.block.text.slice(0, 40)}" (page ${page.pageNumber})`,
        },
        confidence: 0.72,
        reviewStatus: "needs_human_review",
        severity: "MEDIUM",
        detector: "deterministic",
        classification: "possible_mismatch",
        suggestedCorrection: "Increase contrast between text foreground and background colour.",
      });
    }
  }

  return { findings, observations };
}
