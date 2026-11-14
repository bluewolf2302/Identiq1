import sharp from "sharp";
import { hexToRgb, rgbToLab } from "../brand-context-adapter";
import type { VisualPipelineConfig } from "../config";
import type {
  BrandVisualContext,
  OcrBlock,
  ProcessedPage,
  VisualFinding,
  VisualObservation,
} from "../types";
import { ciede2000, rgbToHex } from "./colour-check";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function relativeLuminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * Multi-scale normalized cross-correlation (grayscale) when a reference logo bitmap is supplied.
 */
async function matchReferenceLogoBitmap(
  pagePng: Buffer,
  pageW: number,
  pageH: number,
  refPng: Buffer,
): Promise<{
  score: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  aspectDiffRatio: number;
} | null> {
  const refMeta = await sharp(refPng).metadata();
  if (!refMeta.width || !refMeta.height) return null;

  const targetPageW = 240;
  const scaleToSample = targetPageW / pageW;
  const targetPageH = Math.max(24, Math.round(pageH * scaleToSample));

  const pageGray = await sharp(pagePng)
    .resize(targetPageW, targetPageH, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  let bestScore = -1;
  let bestBox = { x: 0, y: 0, width: 0.2, height: 0.1 };

  const scales = [0.12, 0.2, 0.3, 0.42];
  for (const widthRatio of scales) {
    const tplW = Math.max(16, Math.round(targetPageW * widthRatio));
    const tplH = Math.max(8, Math.round((tplW * refMeta.height) / refMeta.width));
    if (tplW >= targetPageW || tplH >= targetPageH) continue;

    const tplGray = await sharp(refPng)
      .resize(tplW, tplH, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer();

    let tplMean = 0;
    for (let i = 0; i < tplGray.length; i++) tplMean += tplGray[i]!;
    tplMean /= tplGray.length;

    let tplVar = 0;
    for (let i = 0; i < tplGray.length; i++) {
      const d = tplGray[i]! - tplMean;
      tplVar += d * d;
    }
    const tplStd = Math.sqrt(tplVar);
    if (tplStd < 1e-3) continue;

    const step = 4;
    for (let py = 0; py <= targetPageH - tplH; py += step) {
      for (let px = 0; px <= targetPageW - tplW; px += step) {
        let patchSum = 0;
        let patchSqSum = 0;
        let cross = 0;
        const n = tplW * tplH;

        for (let ty = 0; ty < tplH; ty++) {
          const pageRow = (py + ty) * targetPageW + px;
          const tplRow = ty * tplW;
          for (let tx = 0; tx < tplW; tx++) {
            const pVal = pageGray[pageRow + tx]!;
            const tVal = tplGray[tplRow + tx]! - tplMean;
            patchSum += pVal;
            patchSqSum += pVal * pVal;
            cross += pVal * tVal;
          }
        }

        const patchMean = patchSum / n;
        const patchVar = Math.max(0, patchSqSum - n * patchMean * patchMean);
        const patchStd = Math.sqrt(patchVar);
        if (patchStd < 1e-3) continue;

        const ncc = cross / (tplStd * patchStd);
        if (ncc > bestScore) {
          bestScore = ncc;
          bestBox = {
            x: px / targetPageW,
            y: py / targetPageH,
            width: tplW / targetPageW,
            height: tplH / targetPageH,
          };
        }
      }
    }
  }

  return bestScore > 0 ? { score: bestScore, boundingBox: bestBox, aspectDiffRatio: 0 } : null;
}

export async function runLogoCheck(
  page: ProcessedPage,
  pageOcrBlocks: OcrBlock[],
  brandContext: BrandVisualContext,
  config: VisualPipelineConfig,
): Promise<{
  findings: VisualFinding[];
  observations: VisualObservation[];
  detectedLogoBoxes: Array<{ x: number; y: number; width: number; height: number }>;
}> {
  if (page.status !== "ok" || page.pngBuffer.length === 0) {
    return { findings: [], observations: [], detectedLogoBoxes: [] };
  }

  if (brandContext.approvedLogos.length === 0) {
    return {
      findings: [],
      observations: [
        {
          pageNumber: page.pageNumber,
          detector: "image-matching-logo",
          summary: "Skipped logo check: no approved logo references provided in brand context.",
        },
      ],
      detectedLogoBoxes: [],
    };
  }

  const findings: VisualFinding[] = [];
  const observations: VisualObservation[] = [];
  const detectedLogoBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];

  const primaryLogo = brandContext.approvedLogos[0]!;
  const logRule01 = brandContext.rules.find((r) => r.ruleId === "LOG-01") ?? primaryLogo;
  const logRule02 = brandContext.rules.find((r) => r.ruleId === "LOG-02") ?? primaryLogo;
  const logRule04 = brandContext.rules.find((r) => r.ruleId === "LOG-04") ?? primaryLogo;
  const logRule05 = brandContext.rules.find((r) => r.ruleId === "LOG-05") ?? primaryLogo;

  const lowResolution =
    page.imageWidth < config.minReadableWidthPx ||
    page.imageHeight < config.minReadableHeightPx;

  // 1. Reference bitmap template match if a reference PNG buffer was provided
  for (const logoRule of brandContext.approvedLogos) {
    if (!logoRule.referencePngBuffer) continue;
    const match = await matchReferenceLogoBitmap(
      page.pngBuffer,
      page.imageWidth,
      page.imageHeight,
      logoRule.referencePngBuffer,
    );
    if (match) {
      observations.push({
        pageNumber: page.pageNumber,
        detector: "image-matching-logo",
        summary: `Template match for "${logoRule.variantName}" yielded NCC=${match.score.toFixed(2)}.`,
        metrics: { nccScore: Math.round(match.score * 100) / 100 },
      });
      if (match.score >= 0.65) {
        detectedLogoBoxes.push(match.boundingBox);
      } else if (match.score >= 0.35) {
        detectedLogoBoxes.push(match.boundingBox);
        findings.push({
          id: `vis-logo-sim-p${page.pageNumber}`,
          ruleId: "LOG-01",
          category: "logo",
          title: `Logo match uncertain or altered (${logoRule.variantName})`,
          explanation: `Detected candidate logo region achieved moderate structural similarity (NCC=${match.score.toFixed(
            2,
          )}) against approved reference "${logoRule.variantName}". Scaling, background contrast, or alteration may be affecting the mark.`,
          expectedValue: logoRule.description,
          observedValue: `Candidate logo region with similarity score ${match.score.toFixed(2)}`,
          sourceReference: {
            sourceId: logoRule.sourceId,
            sourceVersion: logoRule.sourceVersion,
            sourceTitle: logoRule.sourceTitle,
            pageNumber: logoRule.pageNumber ?? null,
            excerpt: logoRule.excerpt,
          },
          creativeEvidence: {
            assetId: page.originalAssetId,
            pageNumber: page.pageNumber,
            boundingBox: match.boundingBox,
            description: `Candidate logo region matched at NCC=${match.score.toFixed(2)} on page ${page.pageNumber}`,
          },
          confidence: Math.round(Math.min(0.69, Math.max(0.4, match.score)) * 100) / 100,
          reviewStatus: "needs_human_review",
          severity: "MEDIUM",
          detector: "image_matching",
          classification: "possible_mismatch",
          suggestedCorrection: `Verify visually that the "${logoRule.variantName}" artwork matches the approved unedited vector file.`,
        });
      }
    }
  }

  // 2. Brand wordmark anchor detection from OCR / embedded text blocks
  const brandToken = brandContext.brandName.trim().toLowerCase();
  const escapedToken = brandToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenRegex = brandToken ? new RegExp(`\\b${escapedToken}\\b`, "i") : null;
  const wordmarkBlocks = tokenRegex
    ? pageOcrBlocks.filter((b) => {
        const lower = b.text.toLowerCase();
        if (/(www\.|https?:|\.com\b|\.example\b|@)/i.test(lower)) return false;
        if (b.text.trim().split(/\s+/).length > 6) return false;
        return tokenRegex.test(b.text);
      })
    : [];

  for (const [idx, block] of wordmarkBlocks.entries()) {
    // Expand slightly leftward/upward to include adjacent symbol mark (common horizontal/stacked lockups)
    const expandLeft = Math.min(block.boundingBox.x, Math.max(0.06, block.boundingBox.height * 2.2));
    const logoBox = {
      x: clamp01(block.boundingBox.x - expandLeft),
      y: clamp01(block.boundingBox.y - 0.015),
      width: clamp01(block.boundingBox.width + expandLeft + 0.02),
      height: clamp01(block.boundingBox.height + 0.03),
    };
    logoBox.width = Math.min(1 - logoBox.x, logoBox.width);
    logoBox.height = Math.min(1 - logoBox.y, logoBox.height);

    detectedLogoBoxes.push(logoBox);

    const logoPixelWidth = Math.round(logoBox.width * page.imageWidth);
    const cropLeft = Math.max(0, Math.floor(logoBox.x * page.imageWidth));
    const cropTop = Math.max(0, Math.floor(logoBox.y * page.imageHeight));
    const cropWidth = Math.max(1, Math.min(page.imageWidth - cropLeft, Math.floor(logoBox.width * page.imageWidth)));
    const cropHeight = Math.max(1, Math.min(page.imageHeight - cropTop, Math.floor(logoBox.height * page.imageHeight)));

    // Inspect colours inside the logo lockup region
    const expectedSpecs = primaryLogo.expectedColorsHex
      .map((hex) => {
        const rgb = hexToRgb(hex);
        return rgb ? { hex: hex.toUpperCase(), lab: rgbToLab(rgb) } : null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    if (cropWidth >= 8 && cropHeight >= 8 && expectedSpecs.length > 0) {
      const { data: cropPixels, info: cropInfo } = await sharp(page.pngBuffer)
        .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
        .resize(Math.min(96, cropWidth), Math.min(48, cropHeight), { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const bgLuminances: number[] = [];
      const fgBuckets = new Map<string, { r: number; g: number; b: number; count: number }>();
      let chromaticCount = 0;

      for (let i = 0; i < cropPixels.length; i += 3) {
        const r = cropPixels[i]!;
        const g = cropPixels[i + 1]!;
        const b = cropPixels[i + 2]!;
        const lum = relativeLuminance(r, g, b);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const chroma = max - min;

        if (lum > 0.72 && chroma < 35) {
          bgLuminances.push(lum);
        }
        if (chroma >= 28 || lum < 0.25) {
          chromaticCount++;
          const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
          const existing = fgBuckets.get(key);
          if (existing) {
            existing.r += r;
            existing.g += g;
            existing.b += b;
            existing.count++;
          } else {
            fgBuckets.set(key, { r, g, b, count: 1 });
          }
        }
      }

      const topFg = [...fgBuckets.values()].sort((a, b) => b.count - a.count)[0];
      if (topFg && chromaticCount >= 12) {
        const avgRgb = {
          r: Math.round(topFg.r / topFg.count),
          g: Math.round(topFg.g / topFg.count),
          b: Math.round(topFg.b / topFg.count),
        };
        const obsHex = rgbToHex(avgRgb.r, avgRgb.g, avgRgb.b);
        const obsLab = rgbToLab(avgRgb);

        let minDelta = Number.POSITIVE_INFINITY;
        let closestHex = expectedSpecs[0]!.hex;
        for (const exp of expectedSpecs) {
          const d = ciede2000(obsLab, exp.lab);
          if (d < minDelta) {
            minDelta = d;
            closestHex = exp.hex;
          }
        }

        // Check if foreground is white reversed on dark background (allowed by Reversed logo rule)
        const isWhiteReversed = avgRgb.r > 230 && avgRgb.g > 230 && avgRgb.b > 230;

        if (!isWhiteReversed && minDelta >= config.colorDeltaESignificant && idx === 0) {
          findings.push({
            id: `vis-logo-colour-p${page.pageNumber}-${idx + 1}`,
            ruleId: "LOG-02",
            category: "logo",
            title: `Logo appears recoloured (${obsHex}) outside approved logo colours`,
            explanation: `The logo / brand wordmark region near "${block.text}" is rendered predominantly in ${obsHex}, which deviates from the approved logo colours (${expectedSpecs
              .map((e) => e.hex)
              .join(", ")}) by CIEDE2000 ΔE00 = ${minDelta.toFixed(1)} (closest: ${closestHex}).`,
            expectedValue: `Approved logo colours only (${expectedSpecs.map((e) => e.hex).join(", ")} or reversed white)`,
            observedValue: `Logo region colour ${obsHex} (ΔE00=${minDelta.toFixed(1)} vs ${closestHex})`,
            sourceReference: {
              sourceId: logRule02.sourceId,
              sourceVersion: logRule02.sourceVersion,
              sourceTitle: logRule02.sourceTitle,
              pageNumber: logRule02.pageNumber ?? null,
              excerpt: logRule02.excerpt,
            },
            creativeEvidence: {
              assetId: page.originalAssetId,
              pageNumber: page.pageNumber,
              boundingBox: logoBox,
              description: `Logo lockup region containing "${block.text}" on page ${page.pageNumber} (${cropInfo.width}×${cropInfo.height} sampled)`,
            },
            confidence: lowResolution ? 0.62 : 0.86,
            reviewStatus: lowResolution ? "uncertain" : "candidate",
            severity: lowResolution ? "MEDIUM" : "HIGH",
            detector: "image_matching",
            classification: lowResolution ? "possible_mismatch" : "objective_mismatch",
            suggestedCorrection: `Restore the approved brand logo colours (${expectedSpecs
              .map((e) => e.hex)
              .join(" / ")}) without recolouring.`,
          });
        }
      }

      // Check background busy-ness / contrast around logo (LOG-05)
      if (bgLuminances.length > 10) {
        const avgBg = bgLuminances.reduce((s, v) => s + v, 0) / bgLuminances.length;
        const variance =
          bgLuminances.reduce((s, v) => s + Math.pow(v - avgBg, 2), 0) /
          bgLuminances.length;
        if (variance > 0.04) {
          findings.push({
            id: `vis-logo-bg-p${page.pageNumber}-${idx + 1}`,
            ruleId: "LOG-05",
            category: "logo",
            title: "Logo placed on uneven or visually busy background",
            explanation: `Background luminance variance (${variance.toFixed(
              3,
            )}) behind the logo region suggests a patterned or non-plain backdrop.`,
            expectedValue: "Plain, high-contrast background behind logo",
            observedValue: `Uneven background luminance variance ${variance.toFixed(3)}`,
            sourceReference: {
              sourceId: logRule05.sourceId,
              sourceVersion: logRule05.sourceVersion,
              sourceTitle: logRule05.sourceTitle,
              pageNumber: logRule05.pageNumber ?? null,
              excerpt: logRule05.excerpt,
            },
            creativeEvidence: {
              assetId: page.originalAssetId,
              pageNumber: page.pageNumber,
              boundingBox: logoBox,
              description: `Background contrast check around "${block.text}" on page ${page.pageNumber}`,
            },
            confidence: 0.64,
            reviewStatus: "needs_human_review",
            severity: "MEDIUM",
            detector: "image_matching",
            classification: "possible_mismatch",
            suggestedCorrection: "Place the logo on a plain, high-contrast area.",
          });
        }
      }
    }

    // Check minimum digital size (LOG-04)
    if (
      primaryLogo.minWidthPx &&
      logoPixelWidth < primaryLogo.minWidthPx &&
      !lowResolution &&
      idx === 0
    ) {
      findings.push({
        id: `vis-logo-size-p${page.pageNumber}-${idx + 1}`,
        ruleId: "LOG-04",
        category: "logo",
        title: `Logo width (${logoPixelWidth} px) may be below minimum ${primaryLogo.minWidthPx} px`,
        explanation: `Detected logo region width is ~${logoPixelWidth} px at rendered scale, below the ${primaryLogo.minWidthPx} px minimum guideline.`,
        expectedValue: `Minimum complete logo width ${primaryLogo.minWidthPx} px`,
        observedValue: `~${logoPixelWidth} px wide`,
        sourceReference: {
          sourceId: logRule04.sourceId,
          sourceVersion: logRule04.sourceVersion,
          sourceTitle: logRule04.sourceTitle,
          pageNumber: logRule04.pageNumber ?? null,
          excerpt: logRule04.excerpt,
        },
        creativeEvidence: {
          assetId: page.originalAssetId,
          pageNumber: page.pageNumber,
          boundingBox: logoBox,
          description: `Measured logo lockup width ~${logoPixelWidth} px on page ${page.pageNumber}`,
        },
        confidence: 0.65,
        reviewStatus: "needs_human_review",
        severity: "LOW",
        detector: "image_matching",
        classification: "possible_mismatch",
        suggestedCorrection: `Increase logo width to at least ${primaryLogo.minWidthPx} px or use the symbol-only mark.`,
      });
    }

    // Check edge cropping (LOG-01) using actual text/mark bounds rather than synthetic padding
    if (
      block.boundingBox.x <= 0.004 ||
      block.boundingBox.y <= 0.004 ||
      block.boundingBox.x + block.boundingBox.width >= 0.996 ||
      block.boundingBox.y + block.boundingBox.height >= 0.996
    ) {
      findings.push({
        id: `vis-logo-crop-p${page.pageNumber}-${idx + 1}`,
        ruleId: "LOG-01",
        category: "logo",
        title: "Logo appears cropped or flush against creative edge",
        explanation: `Detected logo region touches the outer boundary of page ${page.pageNumber}, indicating potential cropping or missing clear space.`,
        expectedValue: "Uncropped logo with sufficient surrounding clear space",
        observedValue: `Logo bounding box reaches canvas boundary (${Math.round(logoBox.x * 100)}%, ${Math.round(logoBox.y * 100)}%)`,
        sourceReference: {
          sourceId: logRule01.sourceId,
          sourceVersion: logRule01.sourceVersion,
          sourceTitle: logRule01.sourceTitle,
          pageNumber: logRule01.pageNumber ?? null,
          excerpt: logRule01.excerpt,
        },
        creativeEvidence: {
          assetId: page.originalAssetId,
          pageNumber: page.pageNumber,
          boundingBox: logoBox,
          description: `Edge-touching logo region on page ${page.pageNumber}`,
        },
        confidence: 0.78,
        reviewStatus: "candidate",
        severity: "HIGH",
        detector: "image_matching",
        classification: "objective_mismatch",
        suggestedCorrection: "Ensure the full logo is uncropped with adequate margin around all sides.",
      });
    }
  }

  // 3. Missing logo check: ONLY when explicitly required by brand rules
  if (detectedLogoBoxes.length === 0 && wordmarkBlocks.length === 0) {
    if (brandContext.logoRequired) {
      findings.push({
        id: `vis-logo-missing-p${page.pageNumber}`,
        ruleId: "LOG-01",
        category: "logo",
        title: `Expected ${brandContext.brandName} logo not detected`,
        explanation: `Brand rules mark the ${brandContext.brandName} logo as required, but neither a logo reference match nor a brand wordmark anchor was detected on page ${page.pageNumber}.`,
        expectedValue: primaryLogo.description,
        observedValue: "No brand logo detected on page",
        sourceReference: {
          sourceId: primaryLogo.sourceId,
          sourceVersion: primaryLogo.sourceVersion,
          sourceTitle: primaryLogo.sourceTitle,
          pageNumber: primaryLogo.pageNumber ?? null,
          excerpt: primaryLogo.excerpt,
        },
        creativeEvidence: {
          assetId: page.originalAssetId,
          pageNumber: page.pageNumber,
          boundingBox: null,
          description: `Full page ${page.pageNumber} inspected for required brand logo`,
        },
        confidence: lowResolution ? 0.5 : 0.72,
        reviewStatus: "needs_human_review",
        severity: "MEDIUM",
        detector: "image_matching",
        classification: "possible_mismatch",
        suggestedCorrection: `Include the approved ${brandContext.brandName} logo with required clear space.`,
      });
    } else {
      observations.push({
        pageNumber: page.pageNumber,
        detector: "image-matching-logo",
        summary: "No explicit required-logo rule matched; skipped missing-logo violation.",
      });
    }
  }

  return { findings, observations, detectedLogoBoxes };
}
